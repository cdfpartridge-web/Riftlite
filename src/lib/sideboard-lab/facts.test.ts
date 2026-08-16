import { describe, expect, it, vi } from "vitest";

import {
  buildStoredSideboardFactDocument,
  ineligibleSideboardFactMarker,
  isCurrentSideboardFact,
  setSideboardFactInTransaction,
  SIDEBOARD_LAB_FACT_COLLECTION,
  storedSideboardFactCandidates,
} from "@/lib/sideboard-lab/facts";
import { observedSideboardReplay } from "@/lib/sideboard-lab/extract.test";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";

describe("Sideboard Lab anonymous fact documents", () => {
  it("hashes the owner, stores no private key, and restores a valid candidate", () => {
    const fact = buildStoredSideboardFactDocument(observedSideboardReplay(), "private-owner-id");

    expect(fact).toMatchObject({
      schema: "riftlite-sideboard-fact",
      version: 3,
      status: "eligible",
      contributorHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      decisions: [{ observation: {
        provider: "atlas",
        targetGameNumber: 2,
        nextInitiative: expect.stringMatching(/^(first|second|unknown)$/),
      } }],
    });
    expect(JSON.stringify(fact)).not.toContain("private-owner-id");
    const restored = storedSideboardFactCandidates(fact);
    expect(restored).toHaveLength(1);
    expect(restored[0].contributorKey).toBe(fact?.contributorHash);

    const legacy = {
      ...fact,
      version: 1 as const,
      decisions: fact!.decisions.map((decision) => ({
        ...decision,
        observation: {
          ...decision.observation,
          nextInitiative: undefined,
        },
      })),
    };
    expect(storedSideboardFactCandidates(legacy)).toHaveLength(1);
    expect(isCurrentSideboardFact(legacy)).toBe(false);
  });

  it("rejects tampered fingerprints and malformed contributor hashes", () => {
    const fact = buildStoredSideboardFactDocument(observedSideboardReplay(), "private-owner-id");
    if (!fact) throw new Error("fixture must produce a fact");

    expect(storedSideboardFactCandidates({ ...fact, contributorHash: "private-owner-id" })).toEqual([]);
    expect(storedSideboardFactCandidates({
      ...fact,
      decisions: [{
        ...fact.decisions[0],
        deck: { ...fact.decisions[0].deck, fingerprint: "0".repeat(64) },
      }],
    })).toEqual([]);
    expect(storedSideboardFactCandidates({
      ...fact,
      decisions: [{
        ...fact.decisions[0],
        cardsIn: fact.decisions[0].cardsOut,
        cardsOut: fact.decisions[0].cardsIn,
      }],
    })).toEqual([]);
  });

  it("preserves legacy facts while dropping an unproven Chosen Champion label", () => {
    const fact = buildStoredSideboardFactDocument(observedSideboardReplay(), "private-owner-id");
    if (!fact) throw new Error("fixture must produce a fact");
    const nonChampionCode = fact.decisions[0].deck.mainDeck.find((card) => card.count === 1)?.cardCode
      ?? fact.decisions[0].deck.mainDeck[0].cardCode;
    const legacy = {
      ...fact,
      version: 1 as const,
      decisions: fact.decisions.map((decision) => ({
        ...decision,
        deck: { ...decision.deck, chosenChampionCode: nonChampionCode },
        submittedDeck: { ...decision.submittedDeck, chosenChampionCode: nonChampionCode },
      })),
    };

    const restored = storedSideboardFactCandidates(legacy);

    expect(restored).toHaveLength(1);
    expect(restored[0].deck.chosenChampionCode).toBeUndefined();
    expect(restored[0].submittedDeck.chosenChampionCode).toBeUndefined();
    expect(restored[0].deck.mainDeck.reduce((sum, card) => sum + card.count, 0)).toBe(40);
  });

  it("uses an idempotent replay document and a versioned ineligible marker", () => {
    const set = vi.fn();
    const doc = vi.fn(() => ({ path: `${SIDEBOARD_LAB_FACT_COLLECTION}/replay-a` }));
    const collection = vi.fn(() => ({ doc }));
    const transaction = { set };

    setSideboardFactInTransaction(
      { collection } as never,
      transaction as never,
      "replay-a",
      null,
    );

    expect(collection).toHaveBeenCalledWith("sideboardLabFactsV1");
    expect(doc).toHaveBeenCalledWith("replay-a");
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][1]).toMatchObject(ineligibleSideboardFactMarker());
    expect(isCurrentSideboardFact(ineligibleSideboardFactMarker())).toBe(true);
    expect(storedSideboardFactCandidates(ineligibleSideboardFactMarker())).toEqual([]);
  });

  it("fails closed for combined, TCGA, and malformed canonical replays", () => {
    const combined = observedSideboardReplay();
    combined.collaboration = {
      schema: "riftlite-dual-perspective",
      version: 1,
      mode: "dual-perspective",
      sourceReplayIds: ["one", "two"],
      sourceCanonicalSha256s: ["a".repeat(64), "b".repeat(64)],
      perspectivePlayerIds: ["self", "opponent"],
      informationPolicy: "consented_full_information",
      confidence: "exact",
      diagnostics: {
        primarySourceReplayId: "one",
        pairedSnapshotEvents: 0,
        pairedActionEvents: 0,
        unpairedPrimaryEvents: 0,
        unpairedSecondaryEvents: 0,
        enrichedCards: 0,
        enrichedFields: 0,
        coveragePercent: 100,
        warningCodes: [],
      },
    };
    expect(buildStoredSideboardFactDocument(combined, "owner")).toBeNull();

    const tcga = observedSideboardReplay();
    tcga.source.schema = "riftlite-tcga-raw-capture";
    expect(buildStoredSideboardFactDocument(tcga, "owner")).toBeNull();
    expect(() => buildStoredSideboardFactDocument({ version: 2 } as CanonicalReplayV2, "owner"))
      .not.toThrow();
  });
});
