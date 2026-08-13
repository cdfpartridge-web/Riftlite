import "server-only";

import { createHash } from "node:crypto";

import { Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";

import {
  extractObservedSideboardDecisions,
  isValidObservedSideboardCandidate,
  withoutSideboardContributor,
  type ObservedSideboardCandidate,
} from "@/lib/sideboard-lab/extract";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";

export const SIDEBOARD_LAB_FACT_COLLECTION = "sideboardLabFactsV1";
export const SIDEBOARD_LAB_FACT_VERSION = 1;

type StoredSideboardDecision = Omit<ObservedSideboardCandidate, "contributorKey">;

export type StoredSideboardFactDocument = {
  schema: "riftlite-sideboard-fact";
  version: 1;
  status: "eligible";
  contributorHash: string;
  decisions: StoredSideboardDecision[];
};

export type StoredSideboardFactMarker = {
  schema: "riftlite-sideboard-fact";
  version: 1;
  status: "ineligible";
};

export function buildStoredSideboardFactDocument(
  replay: CanonicalReplayV2,
  ownerUid: string,
): StoredSideboardFactDocument | null {
  try {
    if (!ownerUid || replay.collaboration) return null;
    const contributorHash = sha256(ownerUid);
    const decisions = extractObservedSideboardDecisions(replay, contributorHash);
    if (!decisions.length || decisions.some((candidate) => !isValidObservedSideboardCandidate(candidate))) return null;
    return {
      schema: "riftlite-sideboard-fact",
      version: SIDEBOARD_LAB_FACT_VERSION,
      status: "eligible",
      contributorHash,
      decisions: decisions.map(withoutSideboardContributor),
    };
  } catch {
    // Sideboard evidence is optional. Legacy or malformed artifacts must never
    // make replay completion fail for the uploader.
    return null;
  }
}

export function ineligibleSideboardFactMarker(): StoredSideboardFactMarker {
  return {
    schema: "riftlite-sideboard-fact",
    version: SIDEBOARD_LAB_FACT_VERSION,
    status: "ineligible",
  };
}

export function isCurrentSideboardFact(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fact = value as Partial<StoredSideboardFactDocument | StoredSideboardFactMarker>;
  return fact.schema === "riftlite-sideboard-fact" &&
    fact.version === SIDEBOARD_LAB_FACT_VERSION &&
    (fact.status === "eligible" || fact.status === "ineligible");
}

export function setSideboardFactInTransaction(
  db: Firestore,
  transaction: Transaction,
  replayId: string,
  fact: StoredSideboardFactDocument | null,
): void {
  transaction.set(db.collection(SIDEBOARD_LAB_FACT_COLLECTION).doc(replayId), {
    ...(fact ?? ineligibleSideboardFactMarker()),
    updatedAt: Timestamp.now(),
  });
}

export function storedSideboardFactCandidates(value: unknown): ObservedSideboardCandidate[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const fact = value as Partial<StoredSideboardFactDocument>;
  if (
    fact.schema !== "riftlite-sideboard-fact" ||
    fact.version !== SIDEBOARD_LAB_FACT_VERSION ||
    fact.status !== "eligible" ||
    typeof fact.contributorHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(fact.contributorHash) ||
    !Array.isArray(fact.decisions) ||
    fact.decisions.length < 1
  ) return [];
  const restored = fact.decisions.map((decision) => ({
    ...decision,
    contributorKey: fact.contributorHash!,
  })) as ObservedSideboardCandidate[];
  return restored.every(isValidObservedSideboardCandidate) ? restored : [];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
