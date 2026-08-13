import { describe, expect, it } from "vitest";

import registryData from "@/lib/mulligan-lab/card-registry-v1.json";
import {
  buildSideboardLabSnapshot,
  sideboardDeckFingerprint,
  type ObservedSideboardCandidate,
} from "@/lib/sideboard-lab/aggregate";
import { SideboardLabDeckSchema } from "@/lib/sideboard-lab/contracts";
import { sideboardDeckFingerprint as extractorSideboardDeckFingerprint } from "@/lib/sideboard-lab/extract";

const REGISTRY = registryData.cards as Record<string, { name: string }>;

describe("Sideboard Lab aggregate", () => {
  it("uses the extractor's canonical cross-module deck fingerprint", () => {
    const mainDeck = [
      { cardCode: "OGN-002", name: "Two", count: 1 },
      { cardCode: "OGN-001", name: "One", count: 3 },
    ];
    const sideboard = [{ cardCode: "OGN-050", name: "Side", count: 2 }];
    const expected = "16908d2ae724f3a742c4ce57bdabf497151186cb433457387d7573bd63c9030f";
    expect(sideboardDeckFingerprint(mainDeck, sideboard)).toBe(expected);
    expect(extractorSideboardDeckFingerprint(mainDeck, sideboard)).toBe(expected);
  });

  it("rejects more than three copies across alternate print codes", () => {
    const mainDeck = [
      canonicalDeckCard("OGN-027", 2),
      canonicalDeckCard("OGN-027A", 2),
      ...Array.from({ length: 12 }, (_, index) => canonicalDeckCard(
        `OGN-${String(index + 40).padStart(3, "0")}`,
        3,
      )),
    ];
    const sideboard = [canonicalDeckCard("OGN-090", 1)];
    expect(SideboardLabDeckSchema.safeParse({
      fingerprint: sideboardDeckFingerprint(mainDeck, sideboard),
      mainDeck,
      sideboard,
    }).success).toBe(false);
  });

  it("publishes matchup-wide opportunity denominators without sampled swaps or provenance", () => {
    const candidates = Array.from({ length: 30 }, (_, index) => candidate(index, {
      contributorKey: `player-${index % 12}`,
      selectedIn: index < 24,
      wonGame: index % 2 === 0,
    }));
    const result = buildSideboardLabSnapshot(candidates, {
      generatedAt: new Date("2026-08-13T06:00:00.000Z"),
      backfillComplete: true,
      maxDrills: 4,
    });

    expect(result).not.toBeNull();
    expect(result?.source).toMatchObject({
      includedFacts: 30,
      includedPeriods: ["current-season"],
      backfillComplete: true,
    });
    expect(result?.drills).toHaveLength(4);
    const drill = result!.drills[0];
    expect(drill).not.toHaveProperty("observedDecisionId");
    expect(drill).not.toHaveProperty("cardsIn");
    expect(drill).not.toHaveProperty("wonGame");
    expect(drill.evidence).toMatchObject({
      status: "sufficient",
      scope: "matchup",
      decisions: 30,
      players: 12,
    });
    const sideCard = drill.cardEvidence.find((entry) => (
      entry.direction === "in" && entry.cardCode === "OGN-050"
    ));
    expect(sideCard).toMatchObject({
      opportunities: 30,
      selected: 24,
      selectedCopies: 24,
      selectionRate: 0.8,
      evidenceStatus: "robust",
    });
  });

  it("balances repeated users to one majority guidance vote", () => {
    const candidates = [
      ...Array.from({ length: 20 }, (_, index) => candidate(index, {
        contributorKey: "grinder",
        selectedIn: true,
      })),
      ...Array.from({ length: 10 }, (_, index) => candidate(index + 20, {
        contributorKey: `other-${index}`,
        selectedIn: false,
      })),
    ];
    const result = buildSideboardLabSnapshot(candidates, {
      generatedAt: new Date("2026-08-13T06:00:00.000Z"),
      maxDrills: 1,
    });
    const evidence = result!.drills[0].cardEvidence.find((entry) => (
      entry.direction === "in" && entry.cardCode === "OGN-050"
    ));

    expect(evidence).toMatchObject({
      opportunities: 30,
      selected: 20,
      players: 11,
      guidancePlayers: 11,
      guidanceSelected: 1,
      guidanceSelectionRate: 1 / 11,
      guidance: "strong_avoid",
    });
  });

  it("keeps sparse evidence visible but refuses to grade it", () => {
    const result = buildSideboardLabSnapshot([
      candidate(1, { contributorKey: "one", selectedIn: true }),
      candidate(2, { contributorKey: "two", selectedIn: false }),
      candidate(3, { contributorKey: "three", selectedIn: true }),
    ], {
      generatedAt: new Date("2026-08-13T06:00:00.000Z"),
      maxDrills: 1,
    });
    const evidence = result!.drills[0].cardEvidence.find((entry) => (
      entry.direction === "in" && entry.cardCode === "OGN-050"
    ));
    expect(result?.drills[0].evidence.status).toBe("early");
    expect(evidence).toMatchObject({ evidenceStatus: "limited", guidance: "unclear" });
  });

  it("conditions evidence on whether the player won Game 1", () => {
    const candidates = Array.from({ length: 30 }, (_, index) => {
      const value = candidate(index, {
        contributorKey: `result-player-${index}`,
        selectedIn: index < 15,
      });
      value.observation.priorGameWon = index < 15;
      return value;
    });
    const result = buildSideboardLabSnapshot(candidates, {
      generatedAt: new Date("2026-08-13T06:00:00.000Z"),
      maxDrills: 2,
    });
    expect(result?.drills).toHaveLength(2);
    expect(result?.drills.map((drill) => drill.evidence.decisions)).toEqual([15, 15]);
    expect(result?.drills.map((drill) => drill.evidence.status)).toEqual(["early", "early"]);
  });

  it("returns unavailable data instead of synthetic drills when no strict facts exist", () => {
    expect(buildSideboardLabSnapshot([])).toBeNull();
  });

  it("keeps the aggregate comfortably below the Firestore document ceiling", () => {
    const candidates = Array.from({ length: 48 }, (_, index) => wideCandidate(index));
    const result = buildSideboardLabSnapshot(candidates, {
      generatedAt: new Date("2026-08-13T06:00:00.000Z"),
      maxDrills: 48,
    });
    expect(result).not.toBeNull();
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(700_000);
    expect(result!.drills.length).toBeLessThan(48);
  });
});

function candidate(
  index: number,
  options: {
    contributorKey: string;
    selectedIn: boolean;
    wonGame?: boolean;
  },
): ObservedSideboardCandidate {
  const mainDeck = [
    ...Array.from({ length: 13 }, (_, cardIndex) => ({
      cardCode: `OGN-${String(cardIndex + 1).padStart(3, "0")}`,
      name: REGISTRY[`OGN-${String(cardIndex + 1).padStart(3, "0")}`]!.name,
      count: 3,
    })),
    canonicalDeckCard("OGN-014", 1),
  ];
  const sideboard = [
    canonicalDeckCard("OGN-050", 2),
    canonicalDeckCard("OGN-051", 1),
  ];
  const selectedIn = options.selectedIn
    ? [canonicalDeckCard("OGN-050", 1)]
    : [];
  const selectedOut = options.selectedIn
    ? [canonicalDeckCard("OGN-001", 1)]
    : [];
  const afterMain = mainDeck.map((card) => {
    if (card.cardCode === "OGN-001") return { ...card, count: card.count - selectedOut.length };
    return card;
  }).filter((card) => card.count > 0);
  if (selectedIn.length) afterMain.push(canonicalDeckCard("OGN-050", 1));
  const afterSide = sideboard.map((card) => {
    if (card.cardCode === "OGN-050") return { ...card, count: card.count - selectedIn.length };
    return card;
  }).filter((card) => card.count > 0);
  if (selectedOut.length) afterSide.push(canonicalDeckCard("OGN-001", 1));
  const deck = {
    fingerprint: sideboardDeckFingerprint(mainDeck, sideboard),
    mainDeck,
    sideboard,
  };
  const submittedDeck = {
    fingerprint: sideboardDeckFingerprint(afterMain, afterSide),
    mainDeck: afterMain,
    sideboard: afterSide,
  };
  return {
    observedDecisionId: `sd1_${index.toString(16).padStart(32, "0")}`,
    contributorKey: options.contributorKey,
    observation: {
      provider: "atlas",
      matchKey: `sm1_${(index + 100).toString(16).padStart(32, "0")}`,
      targetGameNumber: 2,
      eventKey: `se1_${(index + 200).toString(16).padStart(32, "0")}`,
      observedOn: "2026-08-12",
      priorGameWon: true,
    },
    matchup: {
      playerLegend: canonicalCard("UNL-191"),
      opponentLegend: canonicalCard("VEN-145"),
    },
    deck,
    submittedDeck,
    cardsIn: selectedIn,
    cardsOut: selectedOut,
    wonGame: options.wonGame ?? false,
  };
}

function wideCandidate(index: number): ObservedSideboardCandidate {
  const mainDeck = Array.from({ length: 40 }, (_, cardIndex) => ({
    cardCode: `OGN-${String(cardIndex + 1).padStart(3, "0")}`,
    name: REGISTRY[`OGN-${String(cardIndex + 1).padStart(3, "0")}`]!.name,
    count: 1,
  }));
  const sideboard = Array.from({ length: 15 }, (_, cardIndex) => ({
    cardCode: `OGN-${String(cardIndex + 101).padStart(3, "0")}`,
    name: REGISTRY[`OGN-${String(cardIndex + 101).padStart(3, "0")}`]!.name,
    count: 1,
  }));
  const deck = {
    fingerprint: sideboardDeckFingerprint(mainDeck, sideboard),
    mainDeck,
    sideboard,
  };
  return {
    observedDecisionId: `sd1_${(index + 500).toString(16).padStart(32, "0")}`,
    contributorKey: `wide-player-${index}`,
    observation: {
      provider: "atlas",
      matchKey: `sm1_${(index + 600).toString(16).padStart(32, "0")}`,
      targetGameNumber: 2,
      eventKey: `se1_${(index + 700).toString(16).padStart(32, "0")}`,
      observedOn: "2026-08-12",
      priorGameWon: true,
    },
    matchup: {
      playerLegend: canonicalCard("UNL-191"),
      opponentLegend: canonicalCard("VEN-145"),
    },
    deck,
    submittedDeck: deck,
    cardsIn: [],
    cardsOut: [],
    wonGame: index % 2 === 0,
  };
}

function canonicalDeckCard(cardCode: string, count: number) {
  return { ...canonicalCard(cardCode), count };
}

function canonicalCard(cardCode: string) {
  const card = REGISTRY[cardCode];
  if (!card) throw new Error(`Missing packaged test card ${cardCode}`);
  return { cardCode, name: card.name };
}
