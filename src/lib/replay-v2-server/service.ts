import "server-only";

import { gzipSync, gunzipSync } from "node:zlib";

import { Timestamp, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { normalizeRawCaptureV1, parseRawCaptureV1 } from "@/lib/replay-v2";
import { readImmutableArtifact, storeImmutableArtifact } from "@/lib/replay-v2-server/artifacts";
import {
  MAX_CANONICAL_GZIP_BYTES,
  MAX_CANONICAL_JSON_BYTES,
  MAX_RAW_JSON_BYTES,
  REPLAY_COLLECTION,
  REPLAY_OWNER_COLLECTION,
  REPLAY_PUBLIC_COLLECTION,
} from "@/lib/replay-v2-server/constants";
import {
  ReplayStatusSchema,
  ReplayVisibilitySchema,
  type InitReplayInput,
  type ReplayVisibility,
} from "@/lib/replay-v2-server/contracts";
import { replayProcessingClaimIsActive } from "@/lib/replay-v2-server/completion-claim";
import { ReplayV2Error, replayFailure } from "@/lib/replay-v2-server/errors";
import { createArtifactGeneration, deterministicReplayId, sha256Hex } from "@/lib/replay-v2-server/ids";
import type { ReplayRecord, ReplaySummary } from "@/lib/replay-v2-server/model";
import { projectReplaySummaryRecord, sanitizeCanonicalReplay } from "@/lib/replay-v2-server/projection";

export type InitReplayResult = {
  record: ReplayRecord;
  created: boolean;
  uploadRequired: boolean;
};

export async function initReplay(ownerUid: string, input: InitReplayInput): Promise<InitReplayResult> {
  const db = replayDb();
  const replayId = deterministicReplayId(ownerUid, input.captureId);
  const replayRef = db.collection(REPLAY_COLLECTION).doc(replayId);
  const ownerRef = ownerReplayRef(db, ownerUid, replayId);

  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(replayRef);
    if (snapshot.exists) {
      const existing = replayRecord(snapshot);
      if (existing.ownerUid !== ownerUid || existing.captureId !== input.captureId) {
        throw new ReplayV2Error(409, "replay_id_conflict", "Replay identity conflicts with an existing replay.");
      }
      if (existing.expectedRaw.sha256 !== input.sha256 || existing.expectedRaw.bytes !== input.bytes) {
        throw new ReplayV2Error(
          409,
          "capture_content_conflict",
          "This capture id is already registered with different replay content.",
        );
      }
      return { record: existing, created: false };
    }

    const now = Timestamp.now();
    const created: ReplayRecord = {
      schema: "riftlite-replay-record",
      version: 2,
      replayId,
      ownerUid,
      captureId: input.captureId,
      visibility: input.visibility,
      status: "uploading",
      title: input.title ?? "RiftLite Atlas replay",
      platform: input.platform,
      localReplayId: input.localReplayId ?? "",
      matchId: input.matchId ?? "",
      seriesId: input.seriesId ?? "",
      roomCode: input.roomCode ?? "",
      messageCount: input.messageCount ?? null,
      expectedRaw: {
        sha256: input.sha256,
        bytes: input.bytes,
      },
      failure: null,
      createdAt: now,
      updatedAt: now,
    };
    transaction.create(replayRef, created);
    transaction.set(ownerRef, projectReplaySummaryRecord(created, true));
    return { record: created, created: true };
  });

  return { ...result, uploadRequired: !result.record.rawArtifact };
}

export async function uploadRawReplay(
  ownerUid: string,
  replayId: string,
  bytesInput: Uint8Array,
  declaration: { sha256: string; bytes: number },
): Promise<ReplayRecord> {
  const db = replayDb();
  const bytes = Buffer.from(bytesInput);
  const before = await ownedReplay(db, ownerUid, replayId);
  assertExpectedUpload(before, declaration);
  if (before.rawArtifact) return before;

  if (bytes.length !== declaration.bytes || sha256Hex(bytes) !== declaration.sha256) {
    throw new ReplayV2Error(422, "upload_checksum_mismatch", "Uploaded replay does not match its declared checksum.");
  }

  const generation = createArtifactGeneration("raw");
  const pointer = await storeImmutableArtifact(db, {
    replayId,
    kind: "raw",
    generation,
    bytes,
  });

  const replayRef = db.collection(REPLAY_COLLECTION).doc(replayId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(replayRef);
    const current = replayRecord(snapshot);
    assertOwner(current, ownerUid);
    assertExpectedUpload(current, declaration);
    if (current.rawArtifact) return current;

    const now = Timestamp.now();
    const updated: ReplayRecord = {
      ...current,
      status: "uploading",
      rawArtifact: pointer,
      rawUploadedAt: now,
      updatedAt: now,
      failure: null,
    };
    transaction.update(replayRef, {
      status: updated.status,
      rawArtifact: pointer,
      rawUploadedAt: now,
      updatedAt: now,
      failure: null,
    });
    transaction.set(ownerReplayRef(db, ownerUid, replayId), projectReplaySummaryRecord(updated, true));
    return updated;
  });
}

export async function completeReplay(ownerUid: string, replayId: string): Promise<ReplayRecord> {
  const db = replayDb();
  const replayRef = db.collection(REPLAY_COLLECTION).doc(replayId);
  const generation = createArtifactGeneration("canonical");

  const claim = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(replayRef);
    const current = replayRecord(snapshot);
    assertOwner(current, ownerUid);
    if (current.status === "ready" && current.canonicalArtifact) {
      return { record: current, outcome: "ready" as const };
    }
    if (!current.rawArtifact) {
      throw new ReplayV2Error(409, "raw_upload_required", "Upload the raw replay before completing it.");
    }

    const now = Timestamp.now();
    if (replayProcessingClaimIsActive(current, now.toMillis())) {
      return {
        record: current,
        outcome: "processing" as const,
        generation: current.processingGeneration!,
      };
    }
    const updated: ReplayRecord = {
      ...current,
      status: "processing",
      processingGeneration: generation,
      failure: null,
      updatedAt: now,
    };
    transaction.update(replayRef, {
      status: updated.status,
      processingGeneration: generation,
      failure: null,
      updatedAt: now,
    });
    transaction.set(ownerReplayRef(db, ownerUid, replayId), projectReplaySummaryRecord(updated, true));
    return { record: updated, outcome: "claimed" as const };
  });
  if (claim.outcome === "ready") return claim.record;
  if (claim.outcome === "processing") {
    return waitForExistingCompletion(db, ownerUid, replayId, claim.generation);
  }

  try {
    const rawBytes = await readImmutableArtifact(db, claim.record.rawArtifact!);
    const rawPayload = decodeRawCapture(rawBytes);
    const canonical = normalizeCapture(rawPayload, claim.record.captureId, replayId);
    const canonicalJson = Buffer.from(JSON.stringify(canonical), "utf8");
    if (!canonicalJson.length || canonicalJson.length > MAX_CANONICAL_JSON_BYTES) {
      throw new ReplayV2Error(413, "canonical_too_large", "Normalized replay is too large.");
    }
    const canonicalGzip = gzipSync(canonicalJson, { level: 9 });
    if (canonicalGzip.length > MAX_CANONICAL_GZIP_BYTES) {
      throw new ReplayV2Error(413, "canonical_too_large", "Compressed normalized replay is too large.");
    }

    const pointer = await storeImmutableArtifact(db, {
      replayId,
      kind: "canonical",
      generation,
      bytes: canonicalGzip,
    });
    return await finalizeCanonicalGeneration(
      db,
      ownerUid,
      replayId,
      generation,
      pointer,
      canonical.source.messageCount,
    );
  } catch (error) {
    await markProcessingFailed(db, ownerUid, replayId, generation, error);
    throw error instanceof ReplayV2Error
      ? error
      : new ReplayV2Error(500, "processing_failed", "Replay processing failed.");
  }
}

async function waitForExistingCompletion(
  db: Firestore,
  ownerUid: string,
  replayId: string,
  generation: string,
): Promise<ReplayRecord> {
  for (const delayMs of [200, 400, 800, 1_200, 1_600]) {
    await delay(delayMs);
    const snapshot = await db.collection(REPLAY_COLLECTION).doc(replayId).get();
    const current = replayRecord(snapshot);
    assertOwner(current, ownerUid);
    if (current.status === "ready" && current.canonicalArtifact) return current;
    if (current.status === "failed") {
      throw new ReplayV2Error(
        409,
        current.failure?.code || "processing_failed",
        current.failure?.message || "Replay processing failed.",
      );
    }
    if (current.status !== "processing" || current.processingGeneration !== generation) {
      throw new ReplayV2Error(409, "processing_superseded", "Replay processing changed. Retry shortly.");
    }
  }
  throw new ReplayV2Error(409, "replay_processing", "Replay processing is already in progress. Retry shortly.");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function readCanonicalReplay(
  replayId: string,
  viewerUid: string,
): Promise<{ record: ReplayRecord; bytes?: Buffer }> {
  const db = replayDb();
  const record = await readableReplay(db, replayId, viewerUid);
  if (record.status !== "ready" || !record.canonicalArtifact) return { record };
  return {
    record,
    bytes: await readImmutableArtifact(db, record.canonicalArtifact),
  };
}

export async function readOwnerRawReplay(ownerUid: string, replayId: string): Promise<{ record: ReplayRecord; bytes: Buffer }> {
  const db = replayDb();
  const record = await ownedReplay(db, ownerUid, replayId);
  if (!record.rawArtifact) {
    throw new ReplayV2Error(404, "raw_replay_missing", "Raw replay has not been uploaded.");
  }
  return {
    record,
    bytes: await readImmutableArtifact(db, record.rawArtifact),
  };
}

export async function updateReplayVisibility(
  ownerUid: string,
  replayId: string,
  visibility: ReplayVisibility,
): Promise<ReplayRecord> {
  const db = replayDb();
  const replayRef = db.collection(REPLAY_COLLECTION).doc(replayId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(replayRef);
    const current = replayRecord(snapshot);
    assertOwner(current, ownerUid);
    const now = Timestamp.now();
    const updated: ReplayRecord = { ...current, visibility, updatedAt: now };
    transaction.update(replayRef, { visibility, updatedAt: now });
    transaction.set(ownerReplayRef(db, ownerUid, replayId), projectReplaySummaryRecord(updated, true));
    const publicRef = db.collection(REPLAY_PUBLIC_COLLECTION).doc(replayId);
    if (visibility === "public" && updated.status === "ready") {
      transaction.set(publicRef, projectReplaySummaryRecord(updated, false));
    } else {
      transaction.delete(publicRef);
    }
    return updated;
  });
}

export async function listOwnerReplays(ownerUid: string, limit: number): Promise<ReplaySummary[]> {
  const db = replayDb();
  const snapshot = await db
    .collection(REPLAY_OWNER_COLLECTION)
    .doc(ownerUid)
    .collection("items")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snapshot.docs.map((document) => serializeSummary(document.data(), true));
}

export async function listPublicReplays(limit: number): Promise<ReplaySummary[]> {
  const db = replayDb();
  const snapshot = await db.collection(REPLAY_PUBLIC_COLLECTION).orderBy("createdAt", "desc").limit(limit).get();
  return snapshot.docs.map((document) => serializeSummary(document.data(), false));
}

export function serializeReplay(record: ReplayRecord, ownerView: boolean): ReplaySummary {
  return serializeSummary(projectReplaySummaryRecord(record, ownerView), ownerView);
}

async function finalizeCanonicalGeneration(
  db: Firestore,
  ownerUid: string,
  replayId: string,
  generation: string,
  canonicalArtifact: NonNullable<ReplayRecord["canonicalArtifact"]>,
  messageCount: number,
): Promise<ReplayRecord> {
  const replayRef = db.collection(REPLAY_COLLECTION).doc(replayId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(replayRef);
    const current = replayRecord(snapshot);
    assertOwner(current, ownerUid);
    if (current.processingGeneration !== generation) {
      if (current.status === "ready" && current.canonicalArtifact) return current;
      throw new ReplayV2Error(409, "processing_superseded", "Replay processing was superseded by a newer attempt.");
    }

    const now = Timestamp.now();
    const updated: ReplayRecord = {
      ...current,
      status: "ready",
      canonicalArtifact,
      messageCount,
      processingGeneration: "",
      failure: null,
      processedAt: now,
      updatedAt: now,
    };
    transaction.update(replayRef, {
      status: updated.status,
      canonicalArtifact,
      messageCount,
      processingGeneration: "",
      failure: null,
      processedAt: now,
      updatedAt: now,
    });
    transaction.set(ownerReplayRef(db, ownerUid, replayId), projectReplaySummaryRecord(updated, true));
    const publicRef = db.collection(REPLAY_PUBLIC_COLLECTION).doc(replayId);
    if (updated.visibility === "public") {
      transaction.set(publicRef, projectReplaySummaryRecord(updated, false));
    } else {
      transaction.delete(publicRef);
    }
    return updated;
  });
}

async function markProcessingFailed(
  db: Firestore,
  ownerUid: string,
  replayId: string,
  generation: string,
  error: unknown,
): Promise<void> {
  const replayRef = db.collection(REPLAY_COLLECTION).doc(replayId);
  const failure = replayFailure(error);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(replayRef);
    if (!snapshot.exists) return;
    const current = replayRecord(snapshot);
    if (current.ownerUid !== ownerUid || current.processingGeneration !== generation) return;
    const now = Timestamp.now();
    const updated: ReplayRecord = {
      ...current,
      status: "failed",
      processingGeneration: "",
      failure,
      updatedAt: now,
    };
    transaction.update(replayRef, {
      status: updated.status,
      processingGeneration: "",
      failure,
      updatedAt: now,
    });
    transaction.set(ownerReplayRef(db, ownerUid, replayId), projectReplaySummaryRecord(updated, true));
    transaction.delete(db.collection(REPLAY_PUBLIC_COLLECTION).doc(replayId));
  }).catch(() => undefined);
}

function decodeRawCapture(compressed: Buffer): unknown {
  try {
    const raw = gunzipSync(compressed, { maxOutputLength: MAX_RAW_JSON_BYTES });
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    throw new ReplayV2Error(422, "raw_capture_invalid", "Replay upload must be bounded gzip JSON.");
  }
}

function normalizeCapture(rawPayload: unknown, captureId: string, replayId: string) {
  try {
    const parsed = parseRawCaptureV1(rawPayload);
    if (parsed.captureId !== captureId) {
      throw new ReplayV2Error(
        422,
        "capture_id_mismatch",
        "Raw replay capture id does not match the initialized replay.",
      );
    }
    const normalized = normalizeRawCaptureV1(rawPayload);
    return sanitizeCanonicalReplay({ ...normalized, id: replayId });
  } catch (error) {
    if (error instanceof ReplayV2Error) throw error;
    throw new ReplayV2Error(422, "normalization_failed", "Raw replay could not be normalized.");
  }
}

async function ownedReplay(db: Firestore, ownerUid: string, replayId: string): Promise<ReplayRecord> {
  const snapshot = await db.collection(REPLAY_COLLECTION).doc(replayId).get();
  const record = replayRecord(snapshot);
  assertOwner(record, ownerUid);
  return record;
}

async function readableReplay(db: Firestore, replayId: string, viewerUid: string): Promise<ReplayRecord> {
  const snapshot = await db.collection(REPLAY_COLLECTION).doc(replayId).get();
  const record = replayRecord(snapshot);
  if (record.visibility === "private" && record.ownerUid !== viewerUid) {
    throw new ReplayV2Error(403, "replay_private", "Replay is private.");
  }
  return record;
}

function replayRecord(snapshot: DocumentSnapshot): ReplayRecord {
  if (!snapshot.exists) {
    throw new ReplayV2Error(404, "replay_not_found", "Replay not found.");
  }
  const data = snapshot.data();
  if (
    !data ||
    data.schema !== "riftlite-replay-record" ||
    data.version !== 2 ||
    typeof data.replayId !== "string" ||
    typeof data.ownerUid !== "string" ||
    typeof data.captureId !== "string" ||
    !ReplayVisibilitySchema.safeParse(data.visibility).success ||
    !ReplayStatusSchema.safeParse(data.status).success
  ) {
    throw new ReplayV2Error(500, "replay_record_invalid", "Replay metadata is invalid.");
  }
  return data as ReplayRecord;
}

function assertOwner(record: ReplayRecord, ownerUid: string): void {
  if (record.ownerUid !== ownerUid) {
    throw new ReplayV2Error(403, "replay_owner_required", "Only the replay owner may perform this action.");
  }
}

function assertExpectedUpload(record: ReplayRecord, declaration: { sha256: string; bytes: number }): void {
  if (record.expectedRaw.sha256 !== declaration.sha256 || record.expectedRaw.bytes !== declaration.bytes) {
    throw new ReplayV2Error(409, "upload_declaration_conflict", "Upload declaration does not match replay init.");
  }
}

function replayDb(): Firestore {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new ReplayV2Error(503, "firebase_unavailable", "Firebase admin is not configured.");
  }
  return db;
}

function ownerReplayRef(db: Firestore, ownerUid: string, replayId: string) {
  return db.collection(REPLAY_OWNER_COLLECTION).doc(ownerUid).collection("items").doc(replayId);
}

function serializeSummary(data: Record<string, unknown>, ownerView: boolean): ReplaySummary {
  const visibility = ReplayVisibilitySchema.safeParse(data.visibility);
  const status = ReplayStatusSchema.safeParse(data.status);
  const failure = isRecord(data.failure)
    ? {
        code: stringValue(data.failure.code),
        message: stringValue(data.failure.message),
      }
    : undefined;
  return {
    replayId: stringValue(data.replayId),
    ...(ownerView ? { captureId: stringValue(data.captureId) } : {}),
    visibility: visibility.success ? visibility.data : "private",
    status: status.success ? status.data : "failed",
    title: stringValue(data.title) || "RiftLite Atlas replay",
    platform: stringValue(data.platform) || "atlas",
    ...(ownerView ? { roomCode: stringValue(data.roomCode) } : {}),
    messageCount: typeof data.messageCount === "number" ? data.messageCount : null,
    createdAt: timestampIso(data.createdAt),
    updatedAt: timestampIso(data.updatedAt),
    ...(ownerView && failure?.code ? { failure } : {}),
  };
}

function timestampIso(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
