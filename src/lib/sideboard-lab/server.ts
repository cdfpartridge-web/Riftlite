import "server-only";

import { gunzipSync } from "node:zlib";

import {
  FieldPath,
  Timestamp,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { buildSideboardLabSnapshot } from "@/lib/sideboard-lab/aggregate";
import {
  DEFAULT_SIDEBOARD_LAB_MINIMUM_DECISIONS,
  DEFAULT_SIDEBOARD_LAB_MINIMUM_PLAYERS,
  SideboardLabResponseSchema,
  unavailableSideboardLabResponse,
  type SideboardLabResponse,
} from "@/lib/sideboard-lab/contracts";
import {
  buildStoredSideboardFactDocument,
  ineligibleSideboardFactMarker,
  isCurrentSideboardFact,
  SIDEBOARD_LAB_FACT_COLLECTION,
  SIDEBOARD_LAB_FACT_VERSION,
  storedSideboardFactCandidates,
} from "@/lib/sideboard-lab/facts";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";
import { readImmutableArtifact } from "@/lib/replay-v2-server/artifacts";
import { MAX_CANONICAL_JSON_BYTES, REPLAY_COLLECTION } from "@/lib/replay-v2-server/constants";
import type { ReplayArtifactPointer } from "@/lib/replay-v2-server/model";

const AGGREGATE_COLLECTION = "aggregates";
const AGGREGATE_DOCUMENT = "sideboard-lab-v1";
const DEFAULT_CORPUS_LIMIT = 1_500;
const MAX_CORPUS_LIMIT = 5_000;

type BackfillCursor = { replayId: string };

export type SideboardLabRefreshResult = {
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

export async function readSideboardLabResponse(): Promise<SideboardLabResponse> {
  const db = getFirestoreAdmin();
  if (!db) return unavailableSideboardLabResponse("snapshot_not_configured");
  try {
    const snapshot = await db.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOCUMENT).get();
    if (!snapshot.exists) return unavailableSideboardLabResponse("snapshot_not_configured");
    const parsed = SideboardLabResponseSchema.safeParse(snapshot.data()?.payload);
    if (!parsed.success) return unavailableSideboardLabResponse("snapshot_invalid");
    if (parsed.data.status !== "ready") return parsed.data;
    return Date.parse(parsed.data.expiresAt) <= Date.now()
      ? unavailableSideboardLabResponse("snapshot_expired")
      : parsed.data;
  } catch (error) {
    console.error("[sideboard-lab] Failed to read aggregate:", safeError(error));
    return unavailableSideboardLabResponse("data_unavailable");
  }
}

/**
 * Backfills anonymous exact Game 2 facts from ready canonical replays, then
 * rebuilds one public aggregate from every eligible fact. Replay visibility
 * is deliberately irrelevant: Admin reads private artifacts, while only
 * k-anonymized counts and a registry-bound deck surface leave this function.
 */
export async function refreshSideboardLabAggregate(
  requestedLimit = DEFAULT_CORPUS_LIMIT,
): Promise<SideboardLabRefreshResult> {
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
    const results = await Promise.all(replayDocuments.slice(offset, offset + 6).map(async (source) => {
      try {
        const existing = existingFacts.get(source.id);
        if (isCurrentSideboardFact(existing)) return "already-processed" as const;
        const record = source.data() ?? {};
        if (record.status !== "ready") return "rejected" as const;
        const pointer = replayArtifactPointer(record.canonicalArtifact);
        const ownerUid = typeof record.ownerUid === "string" ? record.ownerUid : "";
        if (!pointer || !ownerUid) {
          await writeIneligibleFactMarker(db, source.id);
          factsCreated += 1;
          return "rejected" as const;
        }
        artifactsOpened += 1;
        const compressed = await readImmutableArtifact(db, pointer);
        const json = gunzipSync(compressed, { maxOutputLength: MAX_CANONICAL_JSON_BYTES }).toString("utf8");
        const replay = parseCanonicalReplay(json);
        if (!replay) {
          await writeIneligibleFactMarker(db, source.id);
          factsCreated += 1;
          return "rejected" as const;
        }
        canonicalLoaded += 1;
        const fact = buildStoredSideboardFactDocument(replay, ownerUid);
        await db.collection(SIDEBOARD_LAB_FACT_COLLECTION).doc(source.id).set({
          ...(fact ?? ineligibleSideboardFactMarker()),
          updatedAt: Timestamp.now(),
        });
        factsCreated += 1;
        return fact ? "candidate" as const : "rejected" as const;
      } catch (error) {
        console.error("[sideboard-lab] Replay candidate failed:", source.id, safeError(error));
        return "failed" as const;
      }
    }));
    for (const result of results) {
      if (result === "rejected") rejected += 1;
      if (result === "failed") failed += 1;
    }
  }

  const nextBackfill = buildNextBackfillState(backfill, replayDocuments, limit, failed);
  const factCorpus = await readEligibleFactCandidates(db);
  const minimumDecisions = envPositiveInteger("SIDEBOARD_LAB_MINIMUM_DECISIONS")
    ?? DEFAULT_SIDEBOARD_LAB_MINIMUM_DECISIONS;
  const minimumPlayers = envPositiveInteger("SIDEBOARD_LAB_MINIMUM_PLAYERS")
    ?? DEFAULT_SIDEBOARD_LAB_MINIMUM_PLAYERS;
  const payload = buildSideboardLabSnapshot(factCorpus.candidates, {
    minimumDecisions,
    minimumPlayers,
    maxDrills: envPositiveInteger("SIDEBOARD_LAB_MAX_DRILLS") ?? 48,
    coverageTruncated: false,
    backfillComplete: nextBackfill.complete,
  });
  const result: SideboardLabRefreshResult = {
    published: Boolean(payload),
    scanned: replayDocuments.length,
    canonicalLoaded,
    artifactsOpened,
    factsCreated,
    factsRead: factCorpus.read,
    factCoverageTruncated: false,
    backfillComplete: nextBackfill.complete,
    strictCandidates: factCorpus.candidates.length,
    drills: payload?.drills.length ?? 0,
    rejected,
    failed,
  };
  await aggregateRef.set({
    ...(payload ? { payload } : {}),
    lastAttemptAt: Timestamp.now(),
    lastAttempt: result,
    backfill: nextBackfill,
  }, { merge: true });
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
    let query = db.collection(REPLAY_COLLECTION).orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    else if (initialCursor) query = query.startAfter(initialCursor.replayId);
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
    const refs = replayDocuments.slice(offset, offset + 250)
      .map((document) => db.collection(SIDEBOARD_LAB_FACT_COLLECTION).doc(document.id));
    if (!refs.length) continue;
    for (const snapshot of await db.getAll(...refs)) {
      if (snapshot.exists) facts.set(snapshot.id, snapshot.data());
    }
  }
  return facts;
}

async function readEligibleFactCandidates(db: Firestore) {
  const candidates = [];
  let read = 0;
  let cursor: QueryDocumentSnapshot | undefined;
  while (true) {
    // Page by document id only so deployment never depends on a custom
    // Firestore composite index. Eligibility is checked by the strict fact
    // adapter below.
    let query = db.collection(SIDEBOARD_LAB_FACT_COLLECTION)
      .orderBy(FieldPath.documentId())
      .limit(500);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const document of snapshot.docs) {
      read += 1;
      candidates.push(...storedSideboardFactCandidates(document.data()));
    }
    cursor = snapshot.docs.at(-1);
    if (snapshot.empty || snapshot.docs.length < 500) break;
  }
  return { candidates, read };
}

async function writeIneligibleFactMarker(db: Firestore, replayId: string) {
  await db.collection(SIDEBOARD_LAB_FACT_COLLECTION).doc(replayId).set({
    ...ineligibleSideboardFactMarker(),
    updatedAt: Timestamp.now(),
  });
}

function readBackfillState(value: unknown): { complete: boolean; cursor: BackfillCursor | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { complete: false, cursor: null };
  const state = value as { factVersion?: unknown; complete?: unknown; cursor?: { replayId?: unknown } | null };
  if (state.factVersion !== SIDEBOARD_LAB_FACT_VERSION) return { complete: false, cursor: null };
  if (state.complete === true) return { complete: true, cursor: null };
  const replayId = state.cursor?.replayId;
  return typeof replayId === "string" && replayId
    ? { complete: false, cursor: { replayId } }
    : { complete: false, cursor: null };
}

function buildNextBackfillState(
  previous: { complete: boolean; cursor: BackfillCursor | null },
  replayDocuments: QueryDocumentSnapshot[],
  limit: number,
  failed: number,
) {
  if (previous.complete) return { factVersion: SIDEBOARD_LAB_FACT_VERSION, complete: true, cursor: null };
  if (failed > 0) return {
    factVersion: SIDEBOARD_LAB_FACT_VERSION,
    complete: false,
    cursor: previous.cursor ? { replayId: previous.cursor.replayId } : null,
  };
  if (replayDocuments.length < limit) {
    return { factVersion: SIDEBOARD_LAB_FACT_VERSION, complete: true, cursor: null };
  }
  const last = replayDocuments.at(-1);
  return {
    factVersion: SIDEBOARD_LAB_FACT_VERSION,
    complete: false,
    cursor: last ? { replayId: last.id } : previous.cursor,
  };
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
