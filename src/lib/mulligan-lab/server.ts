import "server-only";

import { createHash } from "node:crypto";
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
  canSkipLabRefresh,
  labRefreshState,
  readLabFactCorpusWatermark,
  type LabFactCorpusWatermark,
} from "@/lib/lab-refresh-state";
import {
  buildMulliganLabSnapshot,
  buildMulliganLabPack,
  type ObservedMulliganCandidate,
} from "@/lib/mulligan-lab/aggregate";
import {
  DEFAULT_MULLIGAN_LAB_MINIMUM_HANDS,
  DEFAULT_MULLIGAN_LAB_MINIMUM_PLAYERS,
  MulliganLabPackResponseSchema,
  MulliganLabResponseSchema,
  unavailableMulliganLabResponse,
  type MulliganLabPackResponse,
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
import { mulliganCardIdentity } from "@/lib/mulligan-lab/registry";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";
import { readImmutableArtifact } from "@/lib/replay-v2-server/artifacts";
import {
  MAX_CANONICAL_JSON_BYTES,
  REPLAY_COLLECTION,
} from "@/lib/replay-v2-server/constants";
import type { ReplayArtifactPointer } from "@/lib/replay-v2-server/model";

const AGGREGATE_COLLECTION = "aggregates";
const AGGREGATE_DOCUMENT = "mulligan-lab-v1";
const PACK_DOCUMENT_PREFIX = "mulligan-lab-pack-v1";
const DEFAULT_CORPUS_LIMIT = 1_500;
const MAX_CORPUS_LIMIT = 5_000;
const FACT_REFRESH_STATE_FIELD = "factRefreshState";
const REFRESH_ALGORITHM_VERSION = 1;

type BackfillCursor = {
  replayId: string;
};

export type MulliganLabRefreshResult = {
  published: boolean;
  skipped: boolean;
  skipReason?: "source-unchanged-today";
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
  packs: number;
};

export type MulliganLabRefreshOptions = {
  force?: boolean;
};

export type MulliganLabPackReadQuery = {
  playerLegendIdentityCode: string;
  opponentLegendIdentityCode?: string;
  deckFingerprint?: string;
  initiative?: "first" | "second";
  limit?: number;
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

export async function readMulliganLabPack(
  query: MulliganLabPackReadQuery,
): Promise<MulliganLabPackResponse> {
  const db = getFirestoreAdmin();
  if (!db) return unavailableMulliganPack(query, "snapshot_not_configured");
  const documentIds = [
    ...(query.deckFingerprint && query.opponentLegendIdentityCode
      ? [mulliganPackDocumentId(
        query.playerLegendIdentityCode,
        query.opponentLegendIdentityCode,
        query.deckFingerprint,
        query.initiative,
      )]
      : []),
    ...(query.opponentLegendIdentityCode
      ? [mulliganPackDocumentId(
        query.playerLegendIdentityCode,
        query.opponentLegendIdentityCode,
        undefined,
        query.initiative,
      )]
      : []),
    mulliganPackDocumentId(query.playerLegendIdentityCode, undefined, undefined, query.initiative),
  ];
  let sawExpired = false;
  try {
    for (const documentId of documentIds) {
      const snapshot = await db.collection(AGGREGATE_COLLECTION).doc(documentId).get();
      if (!snapshot.exists) continue;
      const parsed = MulliganLabPackResponseSchema.safeParse(snapshot.data()?.payload);
      if (!parsed.success || parsed.data.status !== "ready") continue;
      if (Date.parse(parsed.data.expiresAt) <= Date.now()) {
        sawExpired = true;
        continue;
      }
      const initiativeDrills = query.initiative
        ? parsed.data.drills.filter((drill) => drill.initiative === query.initiative)
        : parsed.data.drills;
      if (query.initiative && initiativeDrills.length === 0) continue;
      const selected = initiativeDrills
        .slice(0, Math.max(1, Math.min(24, Math.trunc(query.limit ?? 24))));
      const exactDeck = query.deckFingerprint && parsed.data.query.resolved.scope === "exact-deck" && selected.some((drill) => (
        drill.deck.fingerprint === query.deckFingerprint
      ));
      const exactMatchup = query.opponentLegendIdentityCode &&
        parsed.data.query.resolved.scope !== "player-legend" && selected.some((drill) => (
        cardIdentity(drill.matchup.opponentLegend.cardCode) === query.opponentLegendIdentityCode
      ));
      return MulliganLabPackResponseSchema.parse({
        ...parsed.data,
        query: {
          requested: {
            playerLegend: query.playerLegendIdentityCode,
            opponentLegend: query.opponentLegendIdentityCode ?? null,
            deckFingerprint: query.deckFingerprint ?? null,
            initiative: query.initiative ?? null,
          },
          resolved: {
            scope: exactDeck ? "exact-deck" : exactMatchup ? "matchup" : "player-legend",
            deckFingerprint: exactDeck ? query.deckFingerprint! : null,
            sharedCards: exactDeck ? 40 : null,
            totalCards: exactDeck ? 40 : null,
          },
          fallbackReason: query.deckFingerprint && !exactDeck
            ? "deck-not-observed"
            : query.opponentLegendIdentityCode && !exactMatchup ? "matchup-not-observed" : null,
        },
        drills: selected,
      });
    }
    return unavailableMulliganPack(query, sawExpired ? "snapshot_expired" : "matchup_not_observed");
  } catch (error) {
    console.error("[mulligan-lab] Failed to read targeted pack:", safeError(error));
    return unavailableMulliganPack(query, "data_unavailable");
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
  options: MulliganLabRefreshOptions = {},
): Promise<MulliganLabRefreshResult> {
  const db = getFirestoreAdmin();
  if (!db) throw new Error("Firebase Admin is not configured.");
  const limit = Math.max(1, Math.min(MAX_CORPUS_LIMIT, Math.trunc(requestedLimit)));
  const aggregateRef = db.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOCUMENT);
  const aggregateSnapshot = await aggregateRef.get();
  const aggregateData = aggregateSnapshot.data() ?? {};
  const backfill = readBackfillState(aggregateData.backfill);
  const minimumHands = envPositiveInteger("MULLIGAN_LAB_MINIMUM_HANDS")
    ?? DEFAULT_MULLIGAN_LAB_MINIMUM_HANDS;
  const minimumPlayers = envPositiveInteger("MULLIGAN_LAB_MINIMUM_PLAYERS")
    ?? DEFAULT_MULLIGAN_LAB_MINIMUM_PLAYERS;
  const maxDrills = envPositiveInteger("MULLIGAN_LAB_MAX_DRILLS") ?? 64;
  const configFingerprint = createHash("sha256").update(JSON.stringify({
    refreshAlgorithmVersion: REFRESH_ALGORITHM_VERSION,
    factVersion: MULLIGAN_LAB_FACT_VERSION,
    minimumHands,
    minimumPlayers,
    maxDrills,
  })).digest("hex");
  const attemptedAt = new Date();
  let factWatermark = backfill.complete
    ? await readMulliganFactWatermark(db)
    : null;
  if (
    !options.force &&
    backfill.complete &&
    factWatermark &&
    canSkipLabRefresh(
      aggregateData[FACT_REFRESH_STATE_FIELD],
      attemptedAt,
      configFingerprint,
      factWatermark,
    )
  ) {
    return skippedMulliganRefreshResult(aggregateData);
  }
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

  const nextBackfill = buildNextBackfillState(backfill, replayDocuments, limit, failed);
  // Backfill writes happen above, so take the watermark afterwards. If a fact
  // changes during the following all-history scan, this older marker is kept;
  // the next invocation will see the mismatch and rebuild again.
  factWatermark ??= await readMulliganFactWatermark(db);
  // Read every eligible fact. The corpus intentionally spans all available
  // history; document-id order is pagination only and never a selection cap.
  const factCorpus = await readEligibleFactCandidates(db);
  const candidates = factCorpus.candidates;

  const generatedAt = new Date();
  const aggregateOptions = {
    minimumHands,
    minimumPlayers,
    maxDrills,
    coverageTruncated: factCorpus.truncated,
    backfillComplete: nextBackfill.complete,
    generatedAt,
  };
  const payload = buildMulliganLabSnapshot(candidates, aggregateOptions);
  const packs = payload
    ? buildMulliganPackDocuments(candidates, aggregateOptions)
    : [];
  const result: MulliganLabRefreshResult = {
    published: Boolean(payload),
    skipped: false,
    scanned: replayDocuments.length,
    canonicalLoaded,
    artifactsOpened,
    factsCreated,
    factsRead: factCorpus.read,
    factCoverageTruncated: factCorpus.truncated,
    backfillComplete: nextBackfill.complete,
    strictCandidates: candidates.length,
    drills: payload?.drills.length ?? 0,
    rejected,
    failed,
    packs: packs.length,
  };

  if (payload) {
    // Invalidate any prior same-day marker before touching packs. A forced
    // rebuild can have the same source watermark as the prior successful run;
    // leaving that marker in place would let a retry skip after a partial pack
    // failure. Publish the completion marker only after every pack write wins.
    await aggregateRef.set({
      payload,
      lastAttemptAt: new Date(),
      lastAttempt: result,
      backfill: nextBackfill,
      [FACT_REFRESH_STATE_FIELD]: null,
    }, { merge: true });
    await writeMulliganPackDocuments(db, packs);
    if (factWatermark) {
      await aggregateRef.set({
        [FACT_REFRESH_STATE_FIELD]: labRefreshState(generatedAt, configFingerprint, factWatermark),
      }, { merge: true });
    }
  } else {
    // Preserve a still-valid previous snapshot during a transient empty run,
    // but record the truthful coverage result for operations. A missing or
    // expired payload remains unavailable to clients.
    await aggregateRef.set({
      lastAttemptAt: new Date(),
      lastAttempt: result,
      backfill: nextBackfill,
      ...(factWatermark
        ? { [FACT_REFRESH_STATE_FIELD]: labRefreshState(generatedAt, configFingerprint, factWatermark) }
        : {}),
    }, { merge: true });
  }
  return result;
}

function buildMulliganPackDocuments(
  candidates: ObservedMulliganCandidate[],
  options: Parameters<typeof buildMulliganLabPack>[2],
): Array<{ id: string; payload: Exclude<MulliganLabPackResponse, { status: "unavailable" }> }> {
  const pairs = new Map<string, {
    player: string;
    opponent: string;
    hands: number;
    players: Set<string>;
  }>();
  const legends = new Map<string, { hands: number; players: Set<string> }>();
  const pairInitiatives = new Map<string, {
    player: string;
    opponent: string;
    initiative: "first" | "second";
    hands: number;
    players: Set<string>;
  }>();
  const legendInitiatives = new Map<string, {
    player: string;
    initiative: "first" | "second";
    hands: number;
    players: Set<string>;
  }>();
  const decks = new Map<string, {
    player: string;
    opponent: string;
    fingerprint: string;
    hands: number;
    players: Set<string>;
  }>();
  const deckInitiatives = new Map<string, {
    player: string;
    opponent: string;
    fingerprint: string;
    initiative: "first" | "second";
    hands: number;
    players: Set<string>;
  }>();
  const candidatesByPlayer = new Map<string, ObservedMulliganCandidate[]>();
  for (const candidate of candidates) {
    const player = cardIdentity(candidate.matchup.playerLegend.cardCode);
    const opponent = cardIdentity(candidate.matchup.opponentLegend.cardCode);
    candidatesByPlayer.set(player, [...(candidatesByPlayer.get(player) ?? []), candidate]);
    const legend = legends.get(player) ?? { hands: 0, players: new Set<string>() };
    legend.hands += 1;
    legend.players.add(candidate.contributorKey);
    legends.set(player, legend);
    const pair = pairs.get(`${player}|${opponent}`) ?? {
      player,
      opponent,
      hands: 0,
      players: new Set<string>(),
    };
    pair.hands += 1;
    pair.players.add(candidate.contributorKey);
    pairs.set(`${player}|${opponent}`, pair);
    const pairInitiativeKey = `${player}|${opponent}|${candidate.initiative}`;
    const pairInitiative = pairInitiatives.get(pairInitiativeKey) ?? {
      player,
      opponent,
      initiative: candidate.initiative,
      hands: 0,
      players: new Set<string>(),
    };
    pairInitiative.hands += 1;
    pairInitiative.players.add(candidate.contributorKey);
    pairInitiatives.set(pairInitiativeKey, pairInitiative);
    const legendInitiativeKey = `${player}|${candidate.initiative}`;
    const legendInitiative = legendInitiatives.get(legendInitiativeKey) ?? {
      player,
      initiative: candidate.initiative,
      hands: 0,
      players: new Set<string>(),
    };
    legendInitiative.hands += 1;
    legendInitiative.players.add(candidate.contributorKey);
    legendInitiatives.set(legendInitiativeKey, legendInitiative);
    const key = `${player}|${opponent}|${candidate.deck.fingerprint}`;
    const cohort = decks.get(key) ?? {
      player,
      opponent,
      fingerprint: candidate.deck.fingerprint,
      hands: 0,
      players: new Set<string>(),
    };
    cohort.hands += 1;
    cohort.players.add(candidate.contributorKey);
    decks.set(key, cohort);
    const deckInitiativeKey = `${key}|${candidate.initiative}`;
    const deckInitiative = deckInitiatives.get(deckInitiativeKey) ?? {
      player,
      opponent,
      fingerprint: candidate.deck.fingerprint,
      initiative: candidate.initiative,
      hands: 0,
      players: new Set<string>(),
    };
    deckInitiative.hands += 1;
    deckInitiative.players.add(candidate.contributorKey);
    deckInitiatives.set(deckInitiativeKey, deckInitiative);
  }
  const result: Array<{ id: string; payload: Exclude<MulliganLabPackResponse, { status: "unavailable" }> }> = [];
  for (const { player, opponent, hands, players } of pairs.values()) {
    if (hands < 8 || players.size < 4) continue;
    const payload = buildMulliganLabPack(candidatesByPlayer.get(player) ?? [], {
      playerLegendIdentityCode: player,
      opponentLegendIdentityCode: opponent,
    }, { ...options, maxDrills: 24 });
    if (payload) result.push({ id: mulliganPackDocumentId(player, opponent), payload });
  }
  for (const [player, cohort] of legends) {
    if (cohort.hands < 8 || cohort.players.size < 4) continue;
    const payload = buildMulliganLabPack(candidatesByPlayer.get(player) ?? [], { playerLegendIdentityCode: player }, {
      ...options,
      maxDrills: 24,
    });
    if (payload) result.push({ id: mulliganPackDocumentId(player), payload });
  }
  for (const { player, opponent, initiative, hands, players } of pairInitiatives.values()) {
    if (hands < 8 || players.size < 4) continue;
    const payload = buildMulliganLabPack(candidatesByPlayer.get(player) ?? [], {
      playerLegendIdentityCode: player,
      opponentLegendIdentityCode: opponent,
      initiative,
    }, { ...options, maxDrills: 24 });
    if (payload) result.push({
      id: mulliganPackDocumentId(player, opponent, undefined, initiative),
      payload,
    });
  }
  for (const { player, initiative, hands, players } of legendInitiatives.values()) {
    if (hands < 8 || players.size < 4) continue;
    const payload = buildMulliganLabPack(candidatesByPlayer.get(player) ?? [], {
      playerLegendIdentityCode: player,
      initiative,
    }, { ...options, maxDrills: 24 });
    if (payload) result.push({
      id: mulliganPackDocumentId(player, undefined, undefined, initiative),
      payload,
    });
  }
  for (const cohort of decks.values()) {
    if (cohort.hands < 8 || cohort.players.size < 4) continue;
    const payload = buildMulliganLabPack(candidatesByPlayer.get(cohort.player) ?? [], {
      playerLegendIdentityCode: cohort.player,
      opponentLegendIdentityCode: cohort.opponent,
      deckFingerprint: cohort.fingerprint,
    }, { ...options, maxDrills: 24 });
    if (payload) {
      result.push({
        id: mulliganPackDocumentId(cohort.player, cohort.opponent, cohort.fingerprint),
        payload,
      });
    }
  }
  for (const cohort of deckInitiatives.values()) {
    if (cohort.hands < 8 || cohort.players.size < 4) continue;
    const payload = buildMulliganLabPack(candidatesByPlayer.get(cohort.player) ?? [], {
      playerLegendIdentityCode: cohort.player,
      opponentLegendIdentityCode: cohort.opponent,
      deckFingerprint: cohort.fingerprint,
      initiative: cohort.initiative,
    }, { ...options, maxDrills: 24 });
    if (payload) result.push({
      id: mulliganPackDocumentId(
        cohort.player,
        cohort.opponent,
        cohort.fingerprint,
        cohort.initiative,
      ),
      payload,
    });
  }
  return result;
}

async function writeMulliganPackDocuments(
  db: Firestore,
  packs: Array<{ id: string; payload: Exclude<MulliganLabPackResponse, { status: "unavailable" }> }>,
): Promise<void> {
  for (let offset = 0; offset < packs.length; offset += 12) {
    await Promise.all(packs.slice(offset, offset + 12).map(({ id, payload }) => (
      db.collection(AGGREGATE_COLLECTION).doc(id).set({ payload, updatedAt: new Date() }, { merge: true })
    )));
  }
}

export function mulliganPackDocumentId(
  playerLegendIdentityCode: string,
  opponentLegendIdentityCode?: string,
  deckFingerprint?: string,
  initiative?: "first" | "second",
): string {
  return `${PACK_DOCUMENT_PREFIX}-${createHash("sha256").update(JSON.stringify([
    playerLegendIdentityCode,
    opponentLegendIdentityCode ?? null,
    deckFingerprint ?? null,
    initiative ?? null,
  ])).digest("hex").slice(0, 32)}`;
}

function unavailableMulliganPack(
  query: MulliganLabPackReadQuery,
  reason: Extract<MulliganLabPackResponse, { status: "unavailable" }>["reason"],
): MulliganLabPackResponse {
  return {
    schema: "riftlite-mulligan-lab-pack",
    version: 1,
    status: "unavailable",
    generatedAt: null,
    expiresAt: null,
    query: {
      requested: {
        playerLegend: query.playerLegendIdentityCode,
        opponentLegend: query.opponentLegendIdentityCode ?? null,
        deckFingerprint: query.deckFingerprint ?? null,
        initiative: query.initiative ?? null,
      },
      resolved: {
        scope: query.opponentLegendIdentityCode ? "matchup" : "player-legend",
        deckFingerprint: null,
        sharedCards: null,
        totalCards: null,
      },
      fallbackReason: reason === "matchup_not_observed" ? "matchup-not-observed" : null,
    },
    source: null,
    drills: [],
    reason,
  };
}

function cardIdentity(cardCode: string): string {
  return mulliganCardIdentity(cardCode) ?? cardCode;
}

function skippedMulliganRefreshResult(
  aggregateData: Record<string, unknown>,
): MulliganLabRefreshResult {
  const lastAttempt = objectRecord(aggregateData.lastAttempt);
  const payload = objectRecord(aggregateData.payload);
  return {
    published: false,
    skipped: true,
    skipReason: "source-unchanged-today",
    scanned: 0,
    canonicalLoaded: 0,
    artifactsOpened: 0,
    factsCreated: 0,
    factsRead: 0,
    factCoverageTruncated: lastAttempt?.factCoverageTruncated === true,
    backfillComplete: true,
    strictCandidates: nonNegativeInteger(lastAttempt?.strictCandidates),
    drills: Array.isArray(payload?.drills)
      ? payload.drills.length
      : nonNegativeInteger(lastAttempt?.drills),
    rejected: 0,
    failed: 0,
    packs: nonNegativeInteger(lastAttempt?.packs),
  };
}

async function readMulliganFactWatermark(
  db: Firestore,
): Promise<LabFactCorpusWatermark | null> {
  try {
    return await readLabFactCorpusWatermark(db, MULLIGAN_LAB_FACT_COLLECTION);
  } catch (error) {
    // Fail open: a missing index or transient aggregation failure must never
    // prevent the proven all-history rebuild path from running.
    console.error("[mulligan-lab] Fact watermark failed:", safeError(error));
    return null;
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
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
): Promise<{ candidates: ObservedMulliganCandidate[]; read: number; truncated: boolean }> {
  const candidates: ObservedMulliganCandidate[] = [];
  let read = 0;
  let cursor: QueryDocumentSnapshot | undefined;
  while (true) {
    const pageSize = 500;
    let query = db.collection(MULLIGAN_LAB_FACT_COLLECTION)
      .where("status", "==", "eligible")
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const document of snapshot.docs) {
      read += 1;
      const candidate = storedMulliganFactCandidate(document.data());
      if (candidate) candidates.push(candidate);
    }
    cursor = snapshot.docs.at(-1);
    if (snapshot.empty || snapshot.docs.length < pageSize) break;
  }
  return { candidates, read, truncated: false };
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
