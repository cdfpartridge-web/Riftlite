import "server-only";

import { createHash } from "node:crypto";
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
import { buildSideboardLabPack, buildSideboardLabSnapshot } from "@/lib/sideboard-lab/aggregate";
import {
  DEFAULT_SIDEBOARD_LAB_MINIMUM_DECISIONS,
  DEFAULT_SIDEBOARD_LAB_MINIMUM_PLAYERS,
  SideboardLabPackResponseSchema,
  SideboardLabResponseSchema,
  unavailableSideboardLabResponse,
  type SideboardLabPackResponse,
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
import { mulliganCardIdentity } from "@/lib/mulligan-lab/registry";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";
import { readImmutableArtifact } from "@/lib/replay-v2-server/artifacts";
import { MAX_CANONICAL_JSON_BYTES, REPLAY_COLLECTION } from "@/lib/replay-v2-server/constants";
import type { ReplayArtifactPointer } from "@/lib/replay-v2-server/model";

const AGGREGATE_COLLECTION = "aggregates";
const AGGREGATE_DOCUMENT = "sideboard-lab-v1";
const PACK_DOCUMENT_PREFIX = "sideboard-lab-pack-v1";
const PACK_DOCUMENT_ID_PREFIX = `${PACK_DOCUMENT_PREFIX}-`;
const PACK_QUERY_PAGE_SIZE = 250;
const PACK_DELETE_BATCH_SIZE = 50;
const DEFAULT_CORPUS_LIMIT = 1_500;
const MAX_CORPUS_LIMIT = 5_000;
const FACT_REFRESH_STATE_FIELD = "factRefreshState";
const REFRESH_ALGORITHM_VERSION = 1;

type BackfillCursor = { replayId: string };

type SideboardPackDocument = {
  id: string;
  payload: Exclude<SideboardLabPackResponse, { status: "unavailable" }>;
};

export type SideboardLabRefreshResult = {
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

export type SideboardLabRefreshOptions = {
  force?: boolean;
};

export type SideboardLabPackReadQuery = {
  playerLegendIdentityCode: string;
  opponentLegendIdentityCode?: string;
  deckFingerprint?: string;
  priorGameResult?: "win" | "loss";
  targetGameNumber?: 2 | 3;
  limit?: number;
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

export async function readSideboardLabPack(
  query: SideboardLabPackReadQuery,
): Promise<SideboardLabPackResponse> {
  const db = getFirestoreAdmin();
  if (!db) return unavailableSideboardPack(query, "snapshot_not_configured");
  // Result-specific shards are privacy-gated before they are written. Never
  // answer a result selector from a broader shard filtered at request time,
  // because its matching result stratum may be smaller than the public gate.
  const targetGameNumber = query.targetGameNumber ?? 2;
  const candidates = query.priorGameResult
    ? [
      ...(query.deckFingerprint && query.opponentLegendIdentityCode
        ? [sideboardPackDocumentId(
          query.playerLegendIdentityCode,
          query.opponentLegendIdentityCode,
          query.deckFingerprint,
          query.priorGameResult,
          targetGameNumber,
        )]
        : []),
      ...(query.opponentLegendIdentityCode
        ? [sideboardPackDocumentId(
          query.playerLegendIdentityCode,
          query.opponentLegendIdentityCode,
          undefined,
          query.priorGameResult,
          targetGameNumber,
        )]
        : []),
      sideboardPackDocumentId(
        query.playerLegendIdentityCode,
        undefined,
        undefined,
        query.priorGameResult,
        targetGameNumber,
      ),
    ]
    : [
      ...(query.deckFingerprint && query.opponentLegendIdentityCode
        ? [sideboardPackDocumentId(
          query.playerLegendIdentityCode,
          query.opponentLegendIdentityCode,
          query.deckFingerprint,
          undefined,
          targetGameNumber,
        )]
        : []),
      ...(query.opponentLegendIdentityCode
        ? [sideboardPackDocumentId(
          query.playerLegendIdentityCode,
          query.opponentLegendIdentityCode,
          undefined,
          undefined,
          targetGameNumber,
        )]
        : []),
      sideboardPackDocumentId(query.playerLegendIdentityCode, undefined, undefined, undefined, targetGameNumber),
    ];
  let sawExpired = false;
  try {
    for (const documentId of [...new Set(candidates)]) {
      const snapshot = await db.collection(AGGREGATE_COLLECTION).doc(documentId).get();
      if (!snapshot.exists) continue;
      const parsed = SideboardLabPackResponseSchema.safeParse(snapshot.data()?.payload);
      if (!parsed.success || parsed.data.status !== "ready") continue;
      if (Date.parse(parsed.data.expiresAt) <= Date.now()) {
        sawExpired = true;
        continue;
      }
      const priorDrills = query.priorGameResult
        ? parsed.data.drills.filter((drill) => drill.priorGameResult === query.priorGameResult)
        : parsed.data.drills;
      if (query.priorGameResult && priorDrills.length === 0) continue;
      const drills = priorDrills
        .slice(0, Math.max(1, Math.min(24, Math.trunc(query.limit ?? 12))));
      const exactDeck = query.deckFingerprint && parsed.data.query.resolved.scope === "exact-deck" && drills.some((drill) => (
        drill.deck.fingerprint === query.deckFingerprint
      ));
      const exactMatchup = query.opponentLegendIdentityCode &&
        parsed.data.query.resolved.scope !== "player-legend" && drills.some((drill) => (
        cardIdentity(drill.matchup.opponentLegend.cardCode) === query.opponentLegendIdentityCode
      ));
      return SideboardLabPackResponseSchema.parse({
        ...parsed.data,
        query: {
          requested: {
            playerLegend: query.playerLegendIdentityCode,
            opponentLegend: query.opponentLegendIdentityCode ?? null,
            deckFingerprint: query.deckFingerprint ?? null,
            priorGameResult: query.priorGameResult ?? null,
            targetGameNumber,
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
        drills,
      });
    }
    return unavailableSideboardPack(query, sawExpired ? "snapshot_expired" : "matchup_not_observed");
  } catch (error) {
    console.error("[sideboard-lab] Failed to read targeted pack:", safeError(error));
    return unavailableSideboardPack(query, "data_unavailable");
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
  options: SideboardLabRefreshOptions = {},
): Promise<SideboardLabRefreshResult> {
  const db = getFirestoreAdmin();
  if (!db) throw new Error("Firebase Admin is not configured.");
  const limit = Math.max(1, Math.min(MAX_CORPUS_LIMIT, Math.trunc(requestedLimit)));
  const aggregateRef = db.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOCUMENT);
  const aggregateSnapshot = await aggregateRef.get();
  const aggregateData = aggregateSnapshot.data() ?? {};
  const backfill = readBackfillState(aggregateData.backfill);
  const minimumDecisions = envPositiveInteger("SIDEBOARD_LAB_MINIMUM_DECISIONS")
    ?? DEFAULT_SIDEBOARD_LAB_MINIMUM_DECISIONS;
  const minimumPlayers = envPositiveInteger("SIDEBOARD_LAB_MINIMUM_PLAYERS")
    ?? DEFAULT_SIDEBOARD_LAB_MINIMUM_PLAYERS;
  const maxDrills = envPositiveInteger("SIDEBOARD_LAB_MAX_DRILLS") ?? 48;
  const configFingerprint = createHash("sha256").update(JSON.stringify({
    refreshAlgorithmVersion: REFRESH_ALGORITHM_VERSION,
    factVersion: SIDEBOARD_LAB_FACT_VERSION,
    minimumDecisions,
    minimumPlayers,
    maxDrills,
  })).digest("hex");
  const attemptedAt = new Date();
  let factWatermark = backfill.complete
    ? await readSideboardFactWatermark(db)
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
    return skippedSideboardRefreshResult(aggregateData);
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
  factWatermark ??= await readSideboardFactWatermark(db);
  const factCorpus = await readEligibleFactCandidates(db);
  const generatedAt = new Date();
  const aggregateOptions = {
    minimumDecisions,
    minimumPlayers,
    maxDrills,
    coverageTruncated: false,
    backfillComplete: nextBackfill.complete,
    generatedAt,
  };
  const payload = buildSideboardLabSnapshot(factCorpus.candidates, aggregateOptions);
  const packs = payload ? buildSideboardPackDocuments(factCorpus.candidates, aggregateOptions) : [];
  const result: SideboardLabRefreshResult = {
    published: Boolean(payload),
    skipped: false,
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
    packs: packs.length,
  };
  if (payload) {
    await aggregateRef.set({
      payload,
      lastAttemptAt: Timestamp.now(),
      lastAttempt: result,
      backfill: nextBackfill,
      // See Mulligan: an old equal watermark must not survive a forced pack
      // rebuild, otherwise a partial sync failure can make its retry skip.
      [FACT_REFRESH_STATE_FIELD]: null,
    }, { merge: true });
    await syncSideboardPackDocuments(db, packs);
    if (factWatermark) {
      await aggregateRef.set({
        [FACT_REFRESH_STATE_FIELD]: labRefreshState(generatedAt, configFingerprint, factWatermark),
      }, { merge: true });
    }
  } else {
    await aggregateRef.set({
      lastAttemptAt: Timestamp.now(),
      lastAttempt: result,
      backfill: nextBackfill,
      ...(factWatermark
        ? { [FACT_REFRESH_STATE_FIELD]: labRefreshState(generatedAt, configFingerprint, factWatermark) }
        : {}),
    }, { merge: true });
  }
  return result;
}

function buildSideboardPackDocuments(
  candidates: ReturnType<typeof storedSideboardFactCandidates>,
  options: Parameters<typeof buildSideboardLabPack>[2],
): SideboardPackDocument[] {
  return ([2, 3] as const).flatMap((targetGameNumber) => buildSideboardPackDocumentsForGame(
    candidates.filter((candidate) => candidate.observation.targetGameNumber === targetGameNumber),
    options,
    targetGameNumber,
  ));
}

function buildSideboardPackDocumentsForGame(
  candidates: ReturnType<typeof storedSideboardFactCandidates>,
  options: Parameters<typeof buildSideboardLabPack>[2],
  targetGameNumber: 2 | 3,
): SideboardPackDocument[] {
  const pairs = new Map<string, {
    player: string;
    opponent: string;
    decisions: number;
    players: Set<string>;
  }>();
  const pairResults = new Map<string, {
    player: string;
    opponent: string;
    result: "win" | "loss";
    decisions: number;
    players: Set<string>;
  }>();
  const legends = new Map<string, { decisions: number; players: Set<string> }>();
  const legendResults = new Map<string, {
    player: string;
    result: "win" | "loss";
    decisions: number;
    players: Set<string>;
  }>();
  const decks = new Map<string, {
    player: string;
    opponent: string;
    fingerprint: string;
    result: "win" | "loss";
    decisions: number;
    players: Set<string>;
  }>();
  const allResultDecks = new Map<string, {
    player: string;
    opponent: string;
    fingerprint: string;
    decisions: number;
    players: Set<string>;
  }>();
  const candidatesByPlayer = new Map<string, ReturnType<typeof storedSideboardFactCandidates>>();
  for (const candidate of candidates) {
    const player = cardIdentity(candidate.matchup.playerLegend.cardCode);
    const opponent = cardIdentity(candidate.matchup.opponentLegend.cardCode);
    const result = candidate.observation.priorGameWon ? "win" as const : "loss" as const;
    candidatesByPlayer.set(player, [...(candidatesByPlayer.get(player) ?? []), candidate]);
    const legend = legends.get(player) ?? { decisions: 0, players: new Set<string>() };
    legend.decisions += 1;
    legend.players.add(candidate.contributorKey);
    legends.set(player, legend);
    const pair = pairs.get(`${player}|${opponent}`) ?? {
      player,
      opponent,
      decisions: 0,
      players: new Set<string>(),
    };
    pair.decisions += 1;
    pair.players.add(candidate.contributorKey);
    pairs.set(`${player}|${opponent}`, pair);
    const pairResult = pairResults.get(`${player}|${opponent}|${result}`) ?? {
      player,
      opponent,
      result,
      decisions: 0,
      players: new Set<string>(),
    };
    pairResult.decisions += 1;
    pairResult.players.add(candidate.contributorKey);
    pairResults.set(`${player}|${opponent}|${result}`, pairResult);
    const legendResult = legendResults.get(`${player}|${result}`) ?? {
      player,
      result,
      decisions: 0,
      players: new Set<string>(),
    };
    legendResult.decisions += 1;
    legendResult.players.add(candidate.contributorKey);
    legendResults.set(`${player}|${result}`, legendResult);
    const key = `${player}|${opponent}|${candidate.deck.fingerprint}|${result}`;
    const cohort = decks.get(key) ?? {
      player,
      opponent,
      fingerprint: candidate.deck.fingerprint,
      result,
      decisions: 0,
      players: new Set<string>(),
    };
    cohort.decisions += 1;
    cohort.players.add(candidate.contributorKey);
    decks.set(key, cohort);
    const allKey = `${player}|${opponent}|${candidate.deck.fingerprint}`;
    const allCohort = allResultDecks.get(allKey) ?? {
      player,
      opponent,
      fingerprint: candidate.deck.fingerprint,
      decisions: 0,
      players: new Set<string>(),
    };
    allCohort.decisions += 1;
    allCohort.players.add(candidate.contributorKey);
    allResultDecks.set(allKey, allCohort);
  }
  const output = new Map<string, Exclude<SideboardLabPackResponse, { status: "unavailable" }>>();
  const add = (id: string, payload: Exclude<SideboardLabPackResponse, { status: "unavailable" }> | null) => {
    if (payload) output.set(id, payload);
  };
  for (const { player, opponent, decisions, players } of pairs.values()) {
    if (decisions < 8 || players.size < 4) continue;
    add(sideboardPackDocumentId(player, opponent, undefined, undefined, targetGameNumber), buildSideboardLabPack(candidatesByPlayer.get(player) ?? [], {
      playerLegendIdentityCode: player,
      opponentLegendIdentityCode: opponent,
      targetGameNumber,
    }, { ...options, maxDrills: 12 }));
  }
  for (const { player, opponent, result, decisions, players } of pairResults.values()) {
    if (decisions < 8 || players.size < 4) continue;
    add(sideboardPackDocumentId(player, opponent, undefined, result, targetGameNumber), buildSideboardLabPack(candidatesByPlayer.get(player) ?? [], {
      playerLegendIdentityCode: player,
      opponentLegendIdentityCode: opponent,
      priorGameResult: result,
      targetGameNumber,
    }, { ...options, maxDrills: 12 }));
  }
  for (const [player, cohort] of legends) {
    if (cohort.decisions < 8 || cohort.players.size < 4) continue;
    add(sideboardPackDocumentId(player, undefined, undefined, undefined, targetGameNumber), buildSideboardLabPack(candidatesByPlayer.get(player) ?? [], {
      playerLegendIdentityCode: player,
      targetGameNumber,
    }, { ...options, maxDrills: 12 }));
  }
  for (const { player, result, decisions, players } of legendResults.values()) {
    if (decisions < 8 || players.size < 4) continue;
    add(sideboardPackDocumentId(player, undefined, undefined, result, targetGameNumber), buildSideboardLabPack(candidatesByPlayer.get(player) ?? [], {
      playerLegendIdentityCode: player,
      priorGameResult: result,
      targetGameNumber,
    }, { ...options, maxDrills: 12 }));
  }
  for (const cohort of decks.values()) {
    if (cohort.decisions < 8 || cohort.players.size < 4) continue;
    add(
      sideboardPackDocumentId(cohort.player, cohort.opponent, cohort.fingerprint, cohort.result, targetGameNumber),
      buildSideboardLabPack(candidatesByPlayer.get(cohort.player) ?? [], {
        playerLegendIdentityCode: cohort.player,
        opponentLegendIdentityCode: cohort.opponent,
        deckFingerprint: cohort.fingerprint,
        priorGameResult: cohort.result,
        targetGameNumber,
      }, { ...options, maxDrills: 12 }),
    );
  }
  for (const cohort of allResultDecks.values()) {
    if (cohort.decisions < 8 || cohort.players.size < 4) continue;
    add(
      sideboardPackDocumentId(cohort.player, cohort.opponent, cohort.fingerprint, undefined, targetGameNumber),
      buildSideboardLabPack(candidatesByPlayer.get(cohort.player) ?? [], {
        playerLegendIdentityCode: cohort.player,
        opponentLegendIdentityCode: cohort.opponent,
        deckFingerprint: cohort.fingerprint,
        targetGameNumber,
      }, { ...options, maxDrills: 12 }),
    );
  }
  return [...output].map(([id, payload]) => ({ id, payload }));
}

/**
 * Replaces the precomputed Sideboard v2 pack set without touching the daily
 * Sideboard snapshot, Mulligan packs, or any other aggregate document.
 * Writes finish first; only then are obsolete IDs inside this exact prefix
 * removed in bounded, document-id-only pages.
 */
export async function syncSideboardPackDocuments(
  db: Firestore,
  packs: SideboardPackDocument[],
): Promise<void> {
  for (let offset = 0; offset < packs.length; offset += 12) {
    await Promise.all(packs.slice(offset, offset + 12).map(({ id, payload }) => (
      db.collection(AGGREGATE_COLLECTION).doc(id).set({ payload, updatedAt: new Date() }, { merge: true })
    )));
  }

  const currentIds = new Set(packs.map(({ id }) => id));
  const collection = db.collection(AGGREGATE_COLLECTION);
  let cursor: string | null = null;
  while (true) {
    let query = collection.orderBy(FieldPath.documentId());
    query = cursor ? query.startAfter(cursor) : query.startAt(PACK_DOCUMENT_ID_PREFIX);
    const snapshot = await query
      .endBefore(`${PACK_DOCUMENT_ID_PREFIX}\uf8ff`)
      .limit(PACK_QUERY_PAGE_SIZE)
      .get();
    if (snapshot.empty) break;

    const staleIds = snapshot.docs
      .map((document) => document.id)
      .filter((id) => id.startsWith(PACK_DOCUMENT_ID_PREFIX) && !currentIds.has(id));
    for (let offset = 0; offset < staleIds.length; offset += PACK_DELETE_BATCH_SIZE) {
      await Promise.all(staleIds.slice(offset, offset + PACK_DELETE_BATCH_SIZE).map((id) => (
        collection.doc(id).delete()
      )));
    }

    cursor = snapshot.docs.at(-1)?.id ?? null;
    if (!cursor || snapshot.docs.length < PACK_QUERY_PAGE_SIZE) break;
  }
}

export function sideboardPackDocumentId(
  playerLegendIdentityCode: string,
  opponentLegendIdentityCode?: string,
  deckFingerprint?: string,
  priorGameResult?: "win" | "loss",
  targetGameNumber: 2 | 3 = 2,
): string {
  return `${PACK_DOCUMENT_PREFIX}-${createHash("sha256").update(JSON.stringify([
    playerLegendIdentityCode,
    opponentLegendIdentityCode ?? null,
    deckFingerprint ?? null,
    priorGameResult ?? null,
    targetGameNumber,
  ])).digest("hex").slice(0, 32)}`;
}

function unavailableSideboardPack(
  query: SideboardLabPackReadQuery,
  reason: Extract<SideboardLabPackResponse, { status: "unavailable" }>["reason"],
): SideboardLabPackResponse {
  return {
    schema: "riftlite-sideboard-lab-pack",
    version: 1,
    status: "unavailable",
    generatedAt: null,
    expiresAt: null,
    query: {
      requested: {
        playerLegend: query.playerLegendIdentityCode,
        opponentLegend: query.opponentLegendIdentityCode ?? null,
        deckFingerprint: query.deckFingerprint ?? null,
        priorGameResult: query.priorGameResult ?? null,
        targetGameNumber: query.targetGameNumber ?? 2,
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

function skippedSideboardRefreshResult(
  aggregateData: Record<string, unknown>,
): SideboardLabRefreshResult {
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

async function readSideboardFactWatermark(
  db: Firestore,
): Promise<LabFactCorpusWatermark | null> {
  try {
    return await readLabFactCorpusWatermark(db, SIDEBOARD_LAB_FACT_COLLECTION);
  } catch (error) {
    console.error("[sideboard-lab] Fact watermark failed:", safeError(error));
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
