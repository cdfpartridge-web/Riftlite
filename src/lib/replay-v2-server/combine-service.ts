import "server-only";

import { gzipSync, gunzipSync } from "node:zlib";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import {
  combineCanonicalReplays,
  ReplayCombinationError,
  type ReplayCombinePrivateIdentity,
} from "@/lib/replay-v2/combine-replays";
import type { CanonicalReplayV2, ReplayCollaborationDiagnostics } from "@/lib/replay-v2/types";
import { summarizeReplayForListing } from "@/lib/replay-v2/replay-listing";
import { storeImmutableArtifact } from "@/lib/replay-v2-server/artifacts";
import {
  MAX_CANONICAL_GZIP_BYTES,
  MAX_CANONICAL_JSON_BYTES,
  REPLAY_COLLECTION,
  REPLAY_OWNER_COLLECTION,
} from "@/lib/replay-v2-server/constants";
import { ReplayV2Error } from "@/lib/replay-v2-server/errors";
import {
  createArtifactGeneration,
  deterministicReplayId,
  sha256Hex,
} from "@/lib/replay-v2-server/ids";
import type { ReplayRecord } from "@/lib/replay-v2-server/model";
import {
  projectReplaySummaryRecord,
  sanitizeCanonicalReplay,
} from "@/lib/replay-v2-server/projection";
import { readCanonicalReplay } from "@/lib/replay-v2-server/service";

export const REPLAY_COMBINATION_SCHEMA = "riftlite-dual-perspective-combination";
export const REPLAY_COMBINATION_VERSION = 2;

type CombinedSourceFingerprint = {
  replayId: string;
  canonicalSha256: string;
};

export type CombinedReplayProvenance = {
  schema: typeof REPLAY_COMBINATION_SCHEMA;
  version: typeof REPLAY_COMBINATION_VERSION;
  sourceReplayIds: [string, string];
  sourceCanonicalSha256s: [string, string];
  permissionConfirmed: true;
  permissionConfirmedAt: unknown;
};

export type CombinedReplayRecord = ReplayRecord & {
  combination: CombinedReplayProvenance;
};

export type CreateCombinedReplayResult = {
  record: CombinedReplayRecord;
  created: boolean;
  confidence: "exact" | "strong" | "review";
  diagnostics: ReplayCollaborationDiagnostics;
};

type LoadedSource = {
  replayId: string;
  record: ReplayRecord;
  canonicalSha256: string;
  replay: CanonicalReplayV2;
};

export async function createCombinedReplay(
  ownerUid: string,
  leftReplayId: string,
  rightReplayId: string,
): Promise<CreateCombinedReplayResult> {
  const sources = (await Promise.all([
    loadReadableCanonicalSource(ownerUid, leftReplayId),
    loadReadableCanonicalSource(ownerUid, rightReplayId),
  ])).sort((left, right) => left.replayId.localeCompare(right.replayId)) as [LoadedSource, LoadedSource];

  const fingerprints = sourceFingerprints(sources);
  const captureId = deterministicCombinedCaptureId(fingerprints);
  const replayId = deterministicReplayId(ownerUid, captureId);
  const db = replayDb();
  const replayRef = db.collection(REPLAY_COLLECTION).doc(replayId);

  const existingSnapshot = await replayRef.get();
  if (existingSnapshot.exists) {
    const record = assertExistingCombinedReplay(
      existingSnapshot.data(),
      ownerUid,
      replayId,
      captureId,
      fingerprints,
    );
    const collaboration = requireCollaboration(sources, replayId);
    return {
      record,
      created: false,
      confidence: collaboration.confidence,
      diagnostics: collaboration.diagnostics,
    };
  }

  const canonical = combineSources(sources, replayId);
  const collaboration = canonical.collaboration!;
  const canonicalJson = Buffer.from(JSON.stringify(canonical), "utf8");
  if (!canonicalJson.length || canonicalJson.length > MAX_CANONICAL_JSON_BYTES) {
    throw new ReplayV2Error(413, "combined_replay_too_large", "The combined replay is too large.");
  }
  const canonicalGzip = gzipSync(canonicalJson, { level: 9 });
  if (canonicalGzip.length > MAX_CANONICAL_GZIP_BYTES) {
    throw new ReplayV2Error(413, "combined_replay_too_large", "The compressed combined replay is too large.");
  }

  const generation = createArtifactGeneration("canonical");
  const canonicalArtifact = await storeImmutableArtifact(db, {
    replayId,
    kind: "canonical",
    generation,
    bytes: canonicalGzip,
  });

  const createdAt = Timestamp.now();
  const record = buildCombinedReplayRecord({
    ownerUid,
    replayId,
    captureId,
    canonical,
    canonicalArtifact,
    fingerprints,
    sources,
    createdAt,
  });

  const stored = await db.runTransaction(async (transaction) => {
    const concurrentSnapshot = await transaction.get(replayRef);
    if (concurrentSnapshot.exists) {
      return {
        record: assertExistingCombinedReplay(
          concurrentSnapshot.data(),
          ownerUid,
          replayId,
          captureId,
          fingerprints,
        ),
        created: false,
      };
    }
    transaction.create(replayRef, record);
    transaction.set(ownerReplayRef(db, ownerUid, replayId), projectReplaySummaryRecord(record, true));
    return { record, created: true };
  });

  return {
    ...stored,
    confidence: collaboration.confidence,
    diagnostics: collaboration.diagnostics,
  };
}

export function deterministicCombinedCaptureId(
  sources: readonly CombinedSourceFingerprint[],
): string {
  const sorted = [...sources].sort((left, right) => left.replayId.localeCompare(right.replayId));
  const digest = sha256Hex(JSON.stringify({
    schema: REPLAY_COMBINATION_SCHEMA,
    version: REPLAY_COMBINATION_VERSION,
    sources: sorted,
  }));
  return `combine-v${REPLAY_COMBINATION_VERSION}-${digest}`;
}

export function buildCombinedReplayRecord(input: {
  ownerUid: string;
  replayId: string;
  captureId: string;
  canonical: CanonicalReplayV2;
  canonicalArtifact: NonNullable<ReplayRecord["canonicalArtifact"]>;
  fingerprints: readonly [CombinedSourceFingerprint, CombinedSourceFingerprint];
  sources: readonly [LoadedSource, LoadedSource];
  createdAt: unknown;
}): CombinedReplayRecord {
  const names = input.canonical.series.participants
    .map((participant) => participant.name.trim())
    .filter(Boolean)
    .slice(0, 2);
  const title = (names.length === 2 ? `Combined: ${names[0]} vs ${names[1]}` : "Combined Atlas replay").slice(0, 180);
  const capturedAt = earliestCapturedAt(input.sources);
  const sourceDigest = sha256Hex(JSON.stringify(input.fingerprints));
  return {
    schema: "riftlite-replay-record",
    version: 2,
    replayId: input.replayId,
    ownerUid: input.ownerUid,
    captureId: input.captureId,
    visibility: "unlisted",
    status: "ready",
    title,
    platform: "atlas",
    localReplayId: "",
    matchId: commonIdentity(input.sources, "matchId"),
    seriesId: commonIdentity(input.sources, "seriesId"),
    roomCode: commonIdentity(input.sources, "roomCode"),
    messageCount: input.canonical.source.messageCount,
    listing: summarizeReplayForListing(input.canonical),
    expectedRaw: {
      sha256: sourceDigest,
      bytes: 0,
    },
    canonicalArtifact: input.canonicalArtifact,
    failure: null,
    ...(capturedAt ? { capturedAt } : {}),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    processedAt: input.createdAt,
    combination: {
      schema: REPLAY_COMBINATION_SCHEMA,
      version: REPLAY_COMBINATION_VERSION,
      sourceReplayIds: [input.fingerprints[0].replayId, input.fingerprints[1].replayId],
      sourceCanonicalSha256s: [
        input.fingerprints[0].canonicalSha256,
        input.fingerprints[1].canonicalSha256,
      ],
      permissionConfirmed: true,
      permissionConfirmedAt: input.createdAt,
    },
  };
}

export function assertExistingCombinedReplay(
  value: unknown,
  ownerUid: string,
  replayId: string,
  captureId: string,
  fingerprints: readonly [CombinedSourceFingerprint, CombinedSourceFingerprint],
): CombinedReplayRecord {
  const record = isRecord(value) ? value : {};
  const combination = isRecord(record.combination) ? record.combination : {};
  const expectedReplayIds = fingerprints.map((source) => source.replayId);
  const expectedSha256s = fingerprints.map((source) => source.canonicalSha256);
  if (
    record.schema !== "riftlite-replay-record" ||
    record.version !== 2 ||
    record.replayId !== replayId ||
    record.ownerUid !== ownerUid ||
    record.captureId !== captureId ||
    combination.schema !== REPLAY_COMBINATION_SCHEMA ||
    combination.version !== REPLAY_COMBINATION_VERSION ||
    !sameStringArray(combination.sourceReplayIds, expectedReplayIds) ||
    !sameStringArray(combination.sourceCanonicalSha256s, expectedSha256s)
  ) {
    throw new ReplayV2Error(
      409,
      "combined_replay_conflict",
      "The deterministic combined replay ID conflicts with different source provenance.",
    );
  }
  if (record.status !== "ready" || !isRecord(record.canonicalArtifact) || record.rawArtifact) {
    throw new ReplayV2Error(
      409,
      "combined_replay_incomplete",
      "The existing combined replay is incomplete. Contact RiftLite support before retrying.",
    );
  }
  return record as CombinedReplayRecord;
}

async function loadReadableCanonicalSource(ownerUid: string, replayId: string): Promise<LoadedSource> {
  const { record, bytes } = await readCanonicalReplay(replayId, ownerUid);
  if (record.platform !== "atlas") {
    throw new ReplayV2Error(
      422,
      "source_replay_provider_unsupported",
      "Only RiftAtlas replays can currently be combined.",
    );
  }
  if (record.status !== "ready" || !record.canonicalArtifact || !bytes) {
    throw new ReplayV2Error(
      409,
      "source_replay_not_ready",
      "Both source replays must finish processing before they can be combined.",
    );
  }
  return {
    replayId,
    record,
    canonicalSha256: record.canonicalArtifact.sha256,
    replay: decodeCanonicalReplay(bytes),
  };
}

function decodeCanonicalReplay(compressed: Buffer): CanonicalReplayV2 {
  try {
    const json = gunzipSync(compressed, { maxOutputLength: MAX_CANONICAL_JSON_BYTES });
    const replay = JSON.parse(json.toString("utf8")) as unknown;
    if (
      !isRecord(replay) ||
      replay.schema !== "riftlite-canonical-replay" ||
      replay.version !== 2 ||
      !Array.isArray(replay.events) ||
      !isRecord(replay.series)
    ) {
      throw new Error("invalid canonical replay");
    }
    return replay as CanonicalReplayV2;
  } catch {
    throw new ReplayV2Error(
      422,
      "source_canonical_invalid",
      "A source replay artifact is malformed and cannot be combined.",
    );
  }
}

function combineSources(
  sources: readonly [LoadedSource, LoadedSource],
  replayId: string,
): CanonicalReplayV2 {
  try {
    return sanitizeCanonicalReplay(combineCanonicalReplays({
      replayId,
      sources: [
        combineSource(sources[0]),
        combineSource(sources[1]),
      ],
    }));
  } catch (error) {
    if (error instanceof ReplayCombinationError) {
      throw new ReplayV2Error(
        error.code === "material_conflict" ? 409 : 422,
        `combine_${error.code}`,
        error.message,
      );
    }
    throw error;
  }
}

function requireCollaboration(
  sources: readonly [LoadedSource, LoadedSource],
  replayId: string,
) {
  const collaboration = combineSources(sources, replayId).collaboration;
  if (!collaboration) {
    throw new ReplayV2Error(500, "combined_replay_invalid", "Combined replay diagnostics are missing.");
  }
  return collaboration;
}

function combineSource(source: LoadedSource) {
  return {
    replayId: source.replayId,
    canonicalSha256: source.canonicalSha256,
    replay: source.replay,
    identity: sourcePrivateIdentity(source),
  };
}

function sourcePrivateIdentity(source: LoadedSource): ReplayCombinePrivateIdentity {
  const identity: ReplayCombinePrivateIdentity = {};
  if (source.record.seriesId) identity.seriesId = source.record.seriesId;
  if (source.record.matchId) identity.matchId = source.record.matchId;
  if (source.record.roomCode) identity.roomCode = source.record.roomCode;
  const capturedAt = timestampMillis(source.record.capturedAt);
  if (capturedAt) identity.capturedAt = capturedAt;
  return identity;
}

function sourceFingerprints(
  sources: readonly [LoadedSource, LoadedSource],
): [CombinedSourceFingerprint, CombinedSourceFingerprint] {
  return [
    { replayId: sources[0].replayId, canonicalSha256: sources[0].canonicalSha256 },
    { replayId: sources[1].replayId, canonicalSha256: sources[1].canonicalSha256 },
  ];
}

function commonIdentity(
  sources: readonly [LoadedSource, LoadedSource],
  key: "matchId" | "seriesId" | "roomCode",
): string {
  const left = sources[0].record[key];
  return left && left === sources[1].record[key] ? left : "";
}

function earliestCapturedAt(sources: readonly [LoadedSource, LoadedSource]): unknown | undefined {
  const candidates = sources
    .map((source) => ({ value: source.record.capturedAt, millis: timestampMillis(source.record.capturedAt) }))
    .filter((candidate) => candidate.millis > 0)
    .sort((left, right) => left.millis - right.millis);
  return candidates[0]?.value;
}

function timestampMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    const result = value.toMillis();
    return Number.isFinite(result) ? result : 0;
  }
  if (value instanceof Date) return value.getTime();
  return 0;
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

function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
