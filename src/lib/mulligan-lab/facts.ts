import "server-only";

import { createHash } from "node:crypto";

import { Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";

import {
  extractObservedMulligan,
  mulliganDeckFingerprint,
  type ObservedMulliganCandidate,
} from "@/lib/mulligan-lab/aggregate";
import {
  MulliganLabCardSchema,
  MulliganLabDeckSchema,
  MulliganLabObservationSchema,
} from "@/lib/mulligan-lab/contracts";
import { canonicalizeCandidateWithPackagedRegistry } from "@/lib/mulligan-lab/registry";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";

export const MULLIGAN_LAB_FACT_COLLECTION = "mulliganLabFactsV1";
export const MULLIGAN_LAB_FACT_VERSION = 3;

export type StoredMulliganFact = Omit<ObservedMulliganCandidate, "contributorKey"> & {
  schema: "riftlite-mulligan-fact";
  version: 1 | 2 | 3;
  status: "eligible";
  contributorHash: string;
};

export type StoredMulliganFactMarker = {
  schema: "riftlite-mulligan-fact";
  version: 3;
  status: "ineligible";
};

export function buildStoredMulliganFact(
  replay: CanonicalReplayV2,
  ownerUid: string,
): StoredMulliganFact | null {
  try {
    // Combined dual-perspective records point back to source replays that are
    // already independently factored. Excluding them prevents double-counting
    // if combined replay completion later adopts this same hook.
    if (replay.collaboration) return null;
    const observed = extractObservedMulligan(replay, ownerUid);
    const candidate = observed ? canonicalizeCandidateWithPackagedRegistry(observed) : null;
    if (!candidate || !validStoredCandidate(candidate)) return null;
    return {
      schema: "riftlite-mulligan-fact",
      version: MULLIGAN_LAB_FACT_VERSION,
      status: "eligible",
      contributorHash: sha256(ownerUid),
      observedHandId: candidate.observedHandId,
      observation: candidate.observation,
      matchup: candidate.matchup,
      initiative: candidate.initiative,
      hand: candidate.hand,
      redrawnCardIndexes: candidate.redrawnCardIndexes,
      wonGame: candidate.wonGame,
      deck: candidate.deck,
      battlefields: candidate.battlefields,
    };
  } catch {
    // Fact extraction is deliberately optional: a malformed legacy replay
    // must never make canonical replay completion fail for the user.
    return null;
  }
}

/**
 * Records that a replay was inspected by the current strict extractor but did
 * not yield a valid fact. Keeping this marker avoids reopening the canonical
 * artifact on every daily refresh. A future extractor change can increment the
 * fact version to make all markers eligible for a deliberate backfill.
 */
export function ineligibleMulliganFactMarker(): StoredMulliganFactMarker {
  return {
    schema: "riftlite-mulligan-fact",
    version: MULLIGAN_LAB_FACT_VERSION,
    status: "ineligible",
  };
}

export function isCurrentMulliganFact(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fact = value as Partial<StoredMulliganFact | StoredMulliganFactMarker>;
  if (fact.schema !== "riftlite-mulligan-fact") return false;
  // Existing eligible v1 facts contain the complete observation and are
  // normalized through the current registry when read. Old v1 ineligible
  // markers carry no evidence and must be retried now legal star/base prints
  // remain accepted while the v3 battlefield/setup backfill progresses.
  return fact.status === "eligible"
    ? fact.version === 1 || fact.version === 2 || fact.version === MULLIGAN_LAB_FACT_VERSION
    : fact.status === "ineligible" && fact.version === MULLIGAN_LAB_FACT_VERSION;
}

export function setMulliganFactInTransaction(
  db: Firestore,
  transaction: Transaction,
  replayId: string,
  fact: StoredMulliganFact | null,
): void {
  const ref = db.collection(MULLIGAN_LAB_FACT_COLLECTION).doc(replayId);
  transaction.set(ref, {
    ...(fact ?? ineligibleMulliganFactMarker()),
    updatedAt: Timestamp.now(),
  });
}

export function storedMulliganFactCandidate(value: unknown): ObservedMulliganCandidate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fact = value as Partial<StoredMulliganFact>;
  if (
    fact.schema !== "riftlite-mulligan-fact" ||
    (fact.version !== 1 && fact.version !== 2 && fact.version !== MULLIGAN_LAB_FACT_VERSION) ||
    fact.status !== "eligible" ||
    typeof fact.contributorHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(fact.contributorHash) ||
    !fact.observedHandId ||
    !fact.observation ||
    !fact.matchup ||
    !fact.initiative ||
    !fact.hand ||
    !fact.redrawnCardIndexes ||
    typeof fact.wonGame !== "boolean" ||
    !fact.deck
  ) return null;
  const candidate = {
    observedHandId: fact.observedHandId,
    contributorKey: fact.contributorHash,
    observation: fact.observation,
    matchup: fact.matchup,
    initiative: fact.initiative,
    hand: fact.hand,
    redrawnCardIndexes: fact.redrawnCardIndexes,
    wonGame: fact.wonGame,
    deck: fact.deck,
    battlefields: fact.battlefields,
  } as ObservedMulliganCandidate;
  const canonical = canonicalizeCandidateWithPackagedRegistry(candidate);
  return canonical && validStoredCandidate(canonical) ? canonical : null;
}

function validStoredCandidate(candidate: ObservedMulliganCandidate): boolean {
  if (
    !MulliganLabObservationSchema.safeParse(candidate.observation).success ||
    !MulliganLabCardSchema.safeParse(candidate.matchup.playerLegend).success ||
    !MulliganLabCardSchema.safeParse(candidate.matchup.opponentLegend).success ||
    !MulliganLabDeckSchema.safeParse(candidate.deck).success ||
    candidate.hand.length !== 4 ||
    candidate.hand.some((card) => !MulliganLabCardSchema.safeParse(card).success) ||
    candidate.redrawnCardIndexes.length > 2 ||
    new Set(candidate.redrawnCardIndexes).size !== candidate.redrawnCardIndexes.length ||
    candidate.redrawnCardIndexes.some((index) => !Number.isInteger(index) || index < 0 || index > 3) ||
    candidate.deck.fingerprint !== mulliganDeckFingerprint(candidate.deck.mainDeck)
  ) return false;

  const deckCounts = new Map(candidate.deck.mainDeck.map((card) => [card.cardCode, card.count]));
  const handCounts = new Map<string, number>();
  for (const card of candidate.hand) {
    handCounts.set(card.cardCode, (handCounts.get(card.cardCode) ?? 0) + 1);
  }
  return [...handCounts].every(([cardCode, count]) => count <= (deckCounts.get(cardCode) ?? 0));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
