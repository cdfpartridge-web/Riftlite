import "server-only";

import { gzipSync, gunzipSync } from "node:zlib";

import { Timestamp, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { normalizeRawCaptureV1, parseRawCaptureV1 } from "@/lib/replay-v2";
import { assessReplayPublicationQuality } from "@/lib/replay-v2/replay-quality";
import { summarizeReplayForListing, type ReplayListingMetadata } from "@/lib/replay-v2/replay-listing";
import type { CanonicalReplayV2 } from "@/lib/replay-v2/types";
import { readImmutableArtifact, storeImmutableArtifact } from "@/lib/replay-v2-server/artifacts";
import {
  MAX_CANONICAL_GZIP_BYTES,
  MAX_CANONICAL_JSON_BYTES,
  MAX_RAW_JSON_BYTES,
  MAX_REPLAY_LIST_LIMIT,
  REPLAY_COLLECTION,
  REPLAY_OWNER_COLLECTION,
  REPLAY_PUBLIC_COLLECTION,
} from "@/lib/replay-v2-server/constants";
import {
  ReplayStatusSchema,
  ReplayVisibilitySchema,
  replayVisibilityAllowsViewer,
  type InitReplayInput,
  type ReplayVisibility,
} from "@/lib/replay-v2-server/contracts";
import { replayProcessingClaimIsActive } from "@/lib/replay-v2-server/completion-claim";
import { ReplayV2Error, replayFailure } from "@/lib/replay-v2-server/errors";
import { createArtifactGeneration, deterministicReplayId, sha256Hex } from "@/lib/replay-v2-server/ids";
import type { ReplayRecord, ReplaySummary } from "@/lib/replay-v2-server/model";
import {
  projectReplaySummaryRecord,
  sanitizeCanonicalReplay,
  sortReplaySummariesByCapturedAt,
} from "@/lib/replay-v2-server/projection";

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
      if (input.capturedAt && !timestampIso(existing.capturedAt)) {
        const capturedAt = replayCapturedAtTimestamp(input.capturedAt);
        const backfilled: ReplayRecord = { ...existing, capturedAt };
        transaction.update(replayRef, { capturedAt });
        transaction.set(ownerRef, projectReplaySummaryRecord(backfilled, true));
        if (backfilled.visibility === "public" && backfilled.status === "ready") {
          transaction.set(
            db.collection(REPLAY_PUBLIC_COLLECTION).doc(replayId),
            projectReplaySummaryRecord(backfilled, false),
          );
        }
        return { record: backfilled, created: false };
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
      ...(input.capturedAt ? { capturedAt: replayCapturedAtTimestamp(input.capturedAt) } : {}),
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
    const quality = assessReplayPublicationQuality(canonical);
    if (!quality.publishable) {
      throw new ReplayV2Error(
        422,
        "replay_capture_incomplete",
        `Replay capture is incomplete: ${quality.issues.map((issue) => issue.message).join(" ")}`,
      );
    }
    const listing = summarizeReplayForListing(canonical);
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
      listing,
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
    .limit(MAX_REPLAY_LIST_LIMIT)
    .get();
  const summaries = snapshot.docs.map((document) => serializeSummary(document.data(), true));
  return sortReplaySummariesByCapturedAt(
    await hydrateReplayListings(db, summaries, true),
  ).slice(0, limit);
}

export async function listPublicReplays(limit: number): Promise<ReplaySummary[]> {
  const db = replayDb();
  const snapshot = await db
    .collection(REPLAY_PUBLIC_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(MAX_REPLAY_LIST_LIMIT)
    .get();
  const summaries = snapshot.docs.map((document) => serializeSummary(document.data(), false));
  return sortReplaySummariesByCapturedAt(
    await hydrateReplayListings(db, summaries, false),
  ).slice(0, limit);
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
  listing: ReplayListingMetadata,
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
      listing,
      processingGeneration: "",
      failure: null,
      processedAt: now,
      updatedAt: now,
    };
    transaction.update(replayRef, {
      status: updated.status,
      canonicalArtifact,
      messageCount,
      listing,
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
  if (!replayVisibilityAllowsViewer(record.visibility, record.ownerUid, viewerUid)) {
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
  const capturedAt = timestampIso(data.capturedAt);
  const listing = parseListingMetadata(data.listing);
  return {
    replayId: stringValue(data.replayId),
    ...(ownerView ? { captureId: stringValue(data.captureId) } : {}),
    visibility: visibility.success ? visibility.data : "private",
    status: status.success ? status.data : "failed",
    title: stringValue(data.title) || "RiftLite Atlas replay",
    platform: stringValue(data.platform) || "atlas",
    ...(ownerView ? { roomCode: stringValue(data.roomCode) } : {}),
    messageCount: typeof data.messageCount === "number" ? data.messageCount : null,
    ...(listing ? { listing } : {}),
    ...(capturedAt ? { capturedAt } : {}),
    createdAt: timestampIso(data.createdAt),
    updatedAt: timestampIso(data.updatedAt),
    ...(ownerView && failure?.code ? { failure } : {}),
  };
}

async function hydrateReplayListings(
  db: Firestore,
  summaries: ReplaySummary[],
  ownerView: boolean,
): Promise<ReplaySummary[]> {
  const results: ReplaySummary[] = [];
  for (let offset = 0; offset < summaries.length; offset += 4) {
    const group = summaries.slice(offset, offset + 4);
    results.push(...await Promise.all(group.map((summary) => hydrateReplayListing(db, summary, ownerView))));
  }
  return results;
}

async function hydrateReplayListing(
  db: Firestore,
  summary: ReplaySummary,
  ownerView: boolean,
): Promise<ReplaySummary> {
  if (summary.listing || summary.status !== "ready") return summary;
  try {
    const replayRef = db.collection(REPLAY_COLLECTION).doc(summary.replayId);
    const snapshot = await replayRef.get();
    const record = replayRecord(snapshot);
    let listing = record.listing;
    if (!listing && record.canonicalArtifact) {
      const compressed = await readImmutableArtifact(db, record.canonicalArtifact);
      const json = gunzipSync(compressed, { maxOutputLength: MAX_CANONICAL_JSON_BYTES }).toString("utf8");
      listing = summarizeReplayForListing(JSON.parse(json) as CanonicalReplayV2);
    }
    if (!listing) return summary;

    const updated = await db.runTransaction(async (transaction) => {
      const current = replayRecord(await transaction.get(replayRef));
      const next: ReplayRecord = { ...current, listing: current.listing ?? listing };
      if (!current.listing) transaction.update(replayRef, { listing });
      transaction.set(ownerReplayRef(db, current.ownerUid, current.replayId), projectReplaySummaryRecord(next, true));
      const publicRef = db.collection(REPLAY_PUBLIC_COLLECTION).doc(current.replayId);
      if (current.visibility === "public" && current.status === "ready") {
        transaction.set(publicRef, projectReplaySummaryRecord(next, false));
      }
      return next;
    });
    return serializeReplay(updated, ownerView);
  } catch {
    return summary;
  }
}

function parseListingMetadata(value: unknown): ReplayListingMetadata | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined;
  const format = value.format;
  const result = value.result;
  if (
    typeof value.playerName !== "string" ||
    typeof value.opponentName !== "string" ||
    typeof value.playerLegend !== "string" ||
    typeof value.opponentLegend !== "string" ||
    (format !== "bo1" && format !== "bo3" && format !== "unknown") ||
    (result !== "win" && result !== "loss" && result !== "draw" && result !== "unknown")
  ) return undefined;
  return {
    version: 1,
    playerName: value.playerName,
    opponentName: value.opponentName,
    playerLegend: value.playerLegend,
    opponentLegend: value.opponentLegend,
    format,
    result,
  };
}

function replayCapturedAtTimestamp(value: string): Timestamp {
  return Timestamp.fromDate(new Date(value));
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
