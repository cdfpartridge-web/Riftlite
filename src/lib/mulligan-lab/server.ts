import "server-only";

import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

import {
  FieldPath,
  Timestamp,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import {
  buildMulliganLabSnapshot,
  type ObservedMulliganCandidate,
} from "@/lib/mulligan-lab/aggregate";
import {
  DEFAULT_MULLIGAN_LAB_MINIMUM_HANDS,
  DEFAULT_MULLIGAN_LAB_MINIMUM_PLAYERS,
  MulliganLabResponseSchema,
  unavailableMulliganLabResponse,
  type MulliganLabResponse,
} from "@/lib/mulligan-lab/contracts";
import {
  buildStoredMulliganFact,
  ineligibleMulliganFactMarker,
  isCurrentMulliganFact,
  MULLIGAN_LAB_FACT_COLLECTION,
  MULLIGAN_LAB_FACT_VERSION,
  storedMulliganFactCandidate,
} from "@/lib/mulligan-lab/facts";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";
import { readImmutableArtifact } from "@/lib/replay-v2-server/artifacts";
import {
  MAX_CANONICAL_JSON_BYTES,
  REPLAY_COLLECTION,
} from "@/lib/replay-v2-server/constants";
import type { ReplayArtifactPointer } from "@/lib/replay-v2-server/model";

const AGGREGATE_COLLECTION = "aggregates";
const AGGREGATE_DOCUMENT = "mulligan-lab-v1";
const DEFAULT_CORPUS_LIMIT = 1_500;
const MAX_CORPUS_LIMIT = 5_000;
const MAX_ELIGIBLE_FACTS = 50_000;

type BackfillCursor = {
  replayId: string;
};

export type MulliganLabRefreshResult = {
  published: boolean;
  scanned: number;
  canonicalLoaded: number;
  artifactsOpened: number;
  factsCreated: number;
  factsRead: number;
  factCoverageTruncated: boolean;
  backfillComplete: boolean;
  strictCandidates: number;
  drills: number;
  rejected: number;
  failed: number;
};

export async function readMulliganLabResponse(): Promise<MulliganLabResponse> {
  const fixture = await readDevelopmentFixture();
  if (fixture) return fixture;

  const db = getFirestoreAdmin();
  if (!db) return unavailableMulliganLabResponse("snapshot_not_configured");
  try {
    const snapshot = await db.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOCUMENT).get();
    if (!snapshot.exists) return unavailableMulliganLabResponse("snapshot_not_configured");
    const parsed = MulliganLabResponseSchema.safeParse(snapshot.data()?.payload);
    if (!parsed.success) return unavailableMulliganLabResponse("snapshot_invalid");
    if (parsed.data.status !== "ready") return parsed.data;
    if (Date.parse(parsed.data.expiresAt) <= Date.now()) {
      return unavailableMulliganLabResponse("snapshot_expired");
    }
    return parsed.data;
  } catch (error) {
    console.error("[mulligan-lab] Failed to read aggregate:", safeError(error));
    return unavailableMulliganLabResponse("data_unavailable");
  }
}

/**
 * Builds the daily anonymous snapshot from ready canonical Web Replays. The
 * owner uid is used in-memory solely for a contributor denominator and is not
 * written into the aggregate. Visibility, names, raw ids, room codes, replay
 * links, and exact timestamps never enter the published payload.
 */
export async function refreshMulliganLabAggregate(
  requestedLimit = DEFAULT_CORPUS_LIMIT,
): Promise<MulliganLabRefreshResult> {
  const db = getFirestoreAdmin();
  if (!db) throw new Error("Firebase Admin is not configured.");
  const limit = Math.max(1, Math.min(MAX_CORPUS_LIMIT, Math.trunc(requestedLimit)));
  const aggregateRef = db.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOCUMENT);
  const aggregateSnapshot = await aggregateRef.get();
  const backfill = readBackfillState(aggregateSnapshot.data()?.backfill);
  const replayDocuments = backfill.complete
    ? []
    : await readCanonicalReplayPageWindow(db, limit, backfill.cursor);
  const existingFacts = await readExistingFactDocuments(db, replayDocuments);

  let artifactsOpened = 0;
  let canonicalLoaded = 0;
  let factsCreated = 0;
  let rejected = 0;
  let failed = 0;

  for (let offset = 0; offset < replayDocuments.length; offset += 6) {
    const page = replayDocuments.slice(offset, offset + 6);
    const results = await Promise.all(page.map(async (source) => {
      try {
        const existing = existingFacts.get(source.id);
        if (isCurrentMulliganFact(existing)) return { kind: "already-processed" as const };

        const record = source.data() ?? {};
        if (record.status !== "ready") return { kind: "rejected" as const };
        const pointer = replayArtifactPointer(record.canonicalArtifact);
        const ownerUid = typeof record.ownerUid === "string" ? record.ownerUid : "";
        if (!pointer || !ownerUid) {
          await writeIneligibleFactMarker(db, source.id);
          return { kind: "rejected" as const };
        }

        artifactsOpened += 1;
        const compressed = await readImmutableArtifact(db, pointer);
        const json = gunzipSync(compressed, { maxOutputLength: MAX_CANONICAL_JSON_BYTES }).toString("utf8");
        const replay = parseCanonicalReplay(json);
        if (!replay) {
          await writeIneligibleFactMarker(db, source.id);
          return { kind: "rejected" as const };
        }
        canonicalLoaded += 1;
        const fact = buildStoredMulliganFact(replay, ownerUid);
        await db.collection(MULLIGAN_LAB_FACT_COLLECTION).doc(source.id).set({
          ...(fact ?? ineligibleMulliganFactMarker()),
          updatedAt: Timestamp.now(),
        });
        factsCreated += 1;
        return fact ? { kind: "candidate" as const } : { kind: "rejected" as const };
      } catch (error) {
        console.error("[mulligan-lab] Replay candidate failed:", source.id, safeError(error));
        return { kind: "failed" as const };
      }
    }));
    for (const result of results) {
      if (result.kind === "rejected") {
        rejected += 1;
      } else if (result.kind === "failed") {
        failed += 1;
      }
    }
  }

  const factCorpus = await readEligibleFactCandidates(db, MAX_ELIGIBLE_FACTS);
  const candidates = factCorpus.candidates;

  const minimumHands = envPositiveInteger("MULLIGAN_LAB_MINIMUM_HANDS")
    ?? DEFAULT_MULLIGAN_LAB_MINIMUM_HANDS;
  const minimumPlayers = envPositiveInteger("MULLIGAN_LAB_MINIMUM_PLAYERS")
    ?? DEFAULT_MULLIGAN_LAB_MINIMUM_PLAYERS;
  const payload = buildMulliganLabSnapshot(candidates, {
    minimumHands,
    minimumPlayers,
    maxDrills: envPositiveInteger("MULLIGAN_LAB_MAX_DRILLS") ?? 64,
    coverageTruncated: factCorpus.truncated,
  });
  const result: MulliganLabRefreshResult = {
    published: Boolean(payload),
    scanned: replayDocuments.length,
    canonicalLoaded,
    artifactsOpened,
    factsCreated,
    factsRead: factCorpus.read,
    factCoverageTruncated: factCorpus.truncated,
    backfillComplete: backfill.complete || (failed === 0 && replayDocuments.length < limit),
    strictCandidates: candidates.length,
    drills: payload?.drills.length ?? 0,
    rejected,
    failed,
  };

  const nextBackfill = buildNextBackfillState(backfill, replayDocuments, limit, failed);
  if (payload) {
    await aggregateRef.set({
      payload,
      lastAttemptAt: new Date(),
      lastAttempt: result,
      backfill: nextBackfill,
    }, { merge: true });
  } else {
    // Preserve a still-valid previous snapshot during a transient empty run,
    // but record the truthful coverage result for operations. A missing or
    // expired payload remains unavailable to clients.
    await aggregateRef.set({
      lastAttemptAt: new Date(),
      lastAttempt: result,
      backfill: nextBackfill,
    }, { merge: true });
  }
  return result;
}

async function readCanonicalReplayPageWindow(
  db: Firestore,
  limit: number,
  initialCursor: BackfillCursor | null,
) {
  const documents: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  while (documents.length < limit) {
    const pageSize = Math.min(250, limit - documents.length);
    let query = db.collection(REPLAY_COLLECTION)
      // A document-id walk needs no custom Firestore composite index. Ready
      // status is checked after the read so this works in the deployed schema.
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor) {
      query = query.startAfter(cursor);
    } else if (initialCursor) {
      query = query.startAfter(initialCursor.replayId);
    }
    const snapshot = await query.get();
    documents.push(...snapshot.docs);
    cursor = snapshot.docs.at(-1);
    if (snapshot.empty || snapshot.docs.length < pageSize) break;
  }
  return documents;
}

async function readExistingFactDocuments(
  db: Firestore,
  replayDocuments: QueryDocumentSnapshot[],
): Promise<Map<string, unknown>> {
  const facts = new Map<string, unknown>();
  for (let offset = 0; offset < replayDocuments.length; offset += 250) {
    const references = replayDocuments.slice(offset, offset + 250)
      .map((document) => db.collection(MULLIGAN_LAB_FACT_COLLECTION).doc(document.id));
    if (!references.length) continue;
    const snapshots = await db.getAll(...references);
    for (const snapshot of snapshots) {
      if (snapshot.exists) facts.set(snapshot.id, snapshot.data());
    }
  }
  return facts;
}

async function readEligibleFactCandidates(
  db: Firestore,
  limit: number,
): Promise<{ candidates: ObservedMulliganCandidate[]; read: number; truncated: boolean }> {
  const candidates: ObservedMulliganCandidate[] = [];
  let read = 0;
  let cursor: QueryDocumentSnapshot | undefined;
  while (read <= limit) {
    const pageSize = Math.min(500, limit + 1 - read);
    let query = db.collection(MULLIGAN_LAB_FACT_COLLECTION)
      .where("status", "==", "eligible")
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const document of snapshot.docs) {
      read += 1;
      if (read > limit) break;
      const candidate = storedMulliganFactCandidate(document.data());
      if (candidate) candidates.push(candidate);
    }
    cursor = snapshot.docs.at(-1);
    if (snapshot.empty || snapshot.docs.length < pageSize || read > limit) break;
  }
  return { candidates, read: Math.min(read, limit), truncated: read > limit };
}

async function writeIneligibleFactMarker(db: Firestore, replayId: string): Promise<void> {
  await db.collection(MULLIGAN_LAB_FACT_COLLECTION).doc(replayId).set({
    ...ineligibleMulliganFactMarker(),
    updatedAt: Timestamp.now(),
  });
}

function readBackfillState(value: unknown): { complete: boolean; cursor: BackfillCursor | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { complete: false, cursor: null };
  }
  const state = value as {
    factVersion?: unknown;
    complete?: unknown;
    cursor?: { replayId?: unknown } | null;
  };
  if (state.factVersion !== MULLIGAN_LAB_FACT_VERSION) {
    return { complete: false, cursor: null };
  }
  if (state.complete === true) return { complete: true, cursor: null };
  const replayId = state.cursor?.replayId;
  return typeof replayId === "string" && replayId.length > 0
    ? {
      complete: false,
      cursor: { replayId },
    }
    : { complete: false, cursor: null };
}

function buildNextBackfillState(
  previous: { complete: boolean; cursor: BackfillCursor | null },
  replayDocuments: QueryDocumentSnapshot[],
  limit: number,
  failed: number,
) {
  if (previous.complete) {
    return { factVersion: MULLIGAN_LAB_FACT_VERSION, complete: true, cursor: null };
  }
  if (failed > 0) {
    return {
      factVersion: MULLIGAN_LAB_FACT_VERSION,
      complete: false,
      cursor: previous.cursor ? { replayId: previous.cursor.replayId } : null,
    };
  }
  if (replayDocuments.length < limit) {
    return { factVersion: MULLIGAN_LAB_FACT_VERSION, complete: true, cursor: null };
  }
  const last = replayDocuments.at(-1);
  return last
    ? {
      factVersion: MULLIGAN_LAB_FACT_VERSION,
      complete: false,
      cursor: { replayId: last.id },
    }
    : {
      factVersion: MULLIGAN_LAB_FACT_VERSION,
      complete: false,
      cursor: previous.cursor ? { replayId: previous.cursor.replayId } : null,
    };
}

async function readDevelopmentFixture(): Promise<MulliganLabResponse | null> {
  const path = process.env.RIFTLITE_MULLIGAN_LAB_FIXTURE_PATH?.trim();
  if (!path || process.env.NODE_ENV === "production") return null;
  try {
    return MulliganLabResponseSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    console.error("[mulligan-lab] Invalid local fixture:", safeError(error));
    return unavailableMulliganLabResponse("snapshot_invalid");
  }
}

function parseCanonicalReplay(json: string): CanonicalReplayV2 | null {
  try {
    const replay = JSON.parse(json) as Partial<CanonicalReplayV2>;
    return replay.schema === "riftlite-canonical-replay" && replay.version === 2
      ? replay as CanonicalReplayV2
      : null;
  } catch {
    return null;
  }
}

function replayArtifactPointer(value: unknown): ReplayArtifactPointer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pointer = value as Partial<ReplayArtifactPointer>;
  if (
    pointer.kind !== "canonical" ||
    (pointer.provider !== "vercel-blob" && pointer.provider !== "firestore-chunks") ||
    typeof pointer.generation !== "string" ||
    typeof pointer.sha256 !== "string" ||
    typeof pointer.bytes !== "number" ||
    pointer.contentType !== "application/gzip"
  ) return null;
  return pointer as ReplayArtifactPointer;
}

function envPositiveInteger(key: string): number | undefined {
  const value = Number(process.env[key] ?? "");
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
