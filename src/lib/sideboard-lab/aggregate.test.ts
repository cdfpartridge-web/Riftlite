import { describe, expect, it } from "vitest";

import registryData from "@/lib/mulligan-lab/card-registry-v1.json";
import {
  buildSideboardLabPack,
  buildSideboardLabSnapshot,
  sideboardDeckFingerprint,
  type ObservedSideboardCandidate,
} from "@/lib/sideboard-lab/aggregate";
import { SideboardLabDeckSchema, SideboardLabPackResponseSchema } from "@/lib/sideboard-lab/contracts";
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

  it("publishes deliberate/no-change, quantity, package, and period evidence in v2 packs", () => {
    const candidates = Array.from({ length: 30 }, (_, index) => {
      const value = candidate(index + 900, {
        contributorKey: `pack-player-${index % 12}`,
        selectedIn: index < 24,
        wonGame: index % 2 === 0,
      });
      value.observation.observedOn = index < 15 ? "2026-07-15" : "2026-08-12";
      return value;
    });
    const deckFingerprint = candidates[0].deck.fingerprint;
    const pack = buildSideboardLabPack(candidates, {
      playerLegendIdentityCode: "UNL-191",
      opponentLegendIdentityCode: "VEN-145",
      deckFingerprint,
      priorGameResult: "win",
    }, {
      generatedAt: new Date("2026-08-13T06:00:00.000Z"),
      backfillComplete: true,
      maxDrills: 2,
    });

    expect(SideboardLabPackResponseSchema.safeParse(pack).success).toBe(true);
    expect(pack).toMatchObject({
      schema: "riftlite-sideboard-lab-pack",
      query: { resolved: { scope: "exact-deck", sharedCards: 40 } },
      source: {
        cardRegistryPrints: 1180,
        formatPolicy: {
          observedRulesEpoch: "unknown",
          currentReference: {
            sideboardMaximum: 10,
            swaps: "one-for-one",
            championChangesAllowed: true,
            fixedSections: ["legend", "runes", "battlefields"],
          },
          historicalValidation: "structural-only-no-retroactive-rules",
        },
      },
    });
    expect(pack?.drills[0]).toMatchObject({
      context: {
        nextInitiative: "unknown",
        format: "bo3",
        provider: "atlas",
        targetGameNumber: 2,
      },
      decisionEvidence: {
        decisions: 30,
        players: 12,
        noChangeDecisions: 6,
        noChangeRate: 0.2,
        medianCopiesMoved: 1,
      },
    });
    expect(pack?.drills[0].packages).toEqual([
      expect.objectContaining({
        cardsIn: [expect.objectContaining({ cardCode: "OGN-050", count: 1 })],
        cardsOut: [expect.objectContaining({ cardCode: "OGN-001", count: 1 })],
        decisions: 24,
        players: 12,
        evidenceStatus: "developing",
      }),
    ]);
    const sideCard = pack?.drills[0].cardEvidence.find((entry) => (
      entry.direction === "in" && entry.cardCode === "OGN-050"
    ));
    expect(sideCard?.quantity).toMatchObject({
      histogram: [
        { copies: 0, decisions: 6 },
        { copies: 1, decisions: 24 },
      ],
      selectedMedianCopies: 1,
      status: "robust",
    });
    expectQuantityToMatchEvidence(sideCard!);
    expect(sideCard?.periods).toMatchObject({
      preseason: { opportunities: 15 },
      currentSeason: { opportunities: 15 },
    });
    expect(JSON.stringify(pack)).not.toContain("pack-player");
  });

  it("keeps quantity evidence on the same opportunity scope as player-Legend fallback evidence", () => {
    const matchup = Array.from({ length: 8 }, (_, index) => {
      const value = candidate(index + 1_300, {
        contributorKey: `matchup-player-${index % 4}`,
        selectedIn: false,
      });
      setObservedSwapCopies(value, [0, 1, 2, 0, 1, 0, 2, 0][index]!);
      return value;
    });
    const broaderOpportunities = Array.from({ length: 24 }, (_, index) => {
      const value = candidate(index + 1_400, {
        contributorKey: `broader-player-${index}`,
        selectedIn: false,
      });
      value.matchup.opponentLegend = canonicalCard("OGN-247");
      setObservedSwapCopies(value, index < 8 ? 0 : index < 16 ? 1 : 2);
      return value;
    });
    const broaderWithoutOpportunity = Array.from({ length: 8 }, (_, index) => {
      const value = candidate(index + 1_500, {
        contributorKey: `no-opportunity-player-${index}`,
        selectedIn: false,
      });
      value.matchup.opponentLegend = canonicalCard("OGN-247");
      removeSideboardOpportunity(value, "OGN-050");
      return value;
    });

    const pack = buildSideboardLabPack([
      ...matchup,
      ...broaderOpportunities,
      ...broaderWithoutOpportunity,
    ], {
      playerLegendIdentityCode: "UNL-191",
      opponentLegendIdentityCode: "VEN-145",
      priorGameResult: "win",
    }, {
      generatedAt: new Date("2026-08-13T06:00:00.000Z"),
      maxDrills: 1,
    });

    expect(SideboardLabPackResponseSchema.safeParse(pack).success).toBe(true);
    const evidence = pack?.drills[0].cardEvidence.find((entry) => (
      entry.direction === "in" && entry.identityCode === "OGN-050"
    ));
    expect(evidence).toMatchObject({
      scope: "player-legend",
      scopeDecisions: 40,
      opportunities: 32,
      selected: 20,
      selectedCopies: 30,
      quantity: {
        histogram: [
          { copies: 0, decisions: 12 },
          { copies: 1, decisions: 10 },
          { copies: 2, decisions: 10 },
        ],
        selectedMedianCopies: 1.5,
        status: "robust",
      },
      periods: {
        currentSeason: {
          opportunities: 32,
          selected: 20,
          selectedCopies: 30,
        },
      },
    });
    expectQuantityToMatchEvidence(evidence!);
  });

  it.each([
    {
      label: "fewer than eight decisions",
      decisions: 7,
      contributorKey: (index: number) => `sparse-decision-${index}`,
    },
    {
      label: "fewer than four contributors",
      decisions: 8,
      contributorKey: (index: number) => `sparse-player-${index % 3}`,
    },
  ])("withholds a broad-pack result subgroup with $label", ({ decisions, contributorKey }) => {
    const publishable = Array.from({ length: 8 }, (_, index) => {
      const value = candidate(index + 1_100, {
        contributorKey: `public-player-${index % 4}`,
        selectedIn: index % 2 === 0,
      });
      value.observation.priorGameWon = true;
      return value;
    });
    const privateSubgroup = Array.from({ length: decisions }, (_, index) => {
      const value = candidate(index + 1_200, {
        contributorKey: contributorKey(index),
        selectedIn: index % 2 === 0,
      });
      value.observation.priorGameWon = false;
      return value;
    });

    const pack = buildSideboardLabPack([...publishable, ...privateSubgroup], {
      playerLegendIdentityCode: "UNL-191",
      opponentLegendIdentityCode: "VEN-145",
    }, {
      generatedAt: new Date("2026-08-13T06:00:00.000Z"),
      maxDrills: 4,
    });

    expect(SideboardLabPackResponseSchema.safeParse(pack).success).toBe(true);
    expect(pack?.drills.length).toBeGreaterThan(0);
    expect(pack?.drills.every((drill) => drill.priorGameResult === "win")).toBe(true);
    expect(pack?.drills.every((drill) => (
      drill.decisionEvidence.decisions === 8 && drill.decisionEvidence.players === 4
    ))).toBe(true);
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

function setObservedSwapCopies(value: ObservedSideboardCandidate, copies: number) {
  value.cardsIn = copies > 0 ? [canonicalDeckCard("OGN-050", copies)] : [];
  value.cardsOut = copies > 0 ? [canonicalDeckCard("OGN-001", copies)] : [];
  const mainDeck = value.deck.mainDeck.map((card) => (
    card.cardCode === "OGN-001" ? { ...card, count: card.count - copies } : card
  )).filter((card) => card.count > 0);
  if (copies > 0) mainDeck.push(canonicalDeckCard("OGN-050", copies));
  const sideboard = value.deck.sideboard.map((card) => (
    card.cardCode === "OGN-050" ? { ...card, count: card.count - copies } : card
  )).filter((card) => card.count > 0);
  if (copies > 0) sideboard.push(canonicalDeckCard("OGN-001", copies));
  value.submittedDeck = {
    fingerprint: sideboardDeckFingerprint(mainDeck, sideboard),
    mainDeck,
    sideboard,
  };
}

function removeSideboardOpportunity(value: ObservedSideboardCandidate, cardCode: string) {
  const sideboard = value.deck.sideboard.filter((card) => card.cardCode !== cardCode);
  const deck = {
    ...value.deck,
    fingerprint: sideboardDeckFingerprint(value.deck.mainDeck, sideboard),
    sideboard,
  };
  value.deck = deck;
  value.submittedDeck = deck;
  value.cardsIn = [];
  value.cardsOut = [];
}

function expectQuantityToMatchEvidence(
  evidence: NonNullable<ReturnType<typeof buildSideboardLabPack>>["drills"][number]["cardEvidence"][number],
) {
  const histogram = evidence.quantity.histogram;
  expect(histogram.reduce((sum, bucket) => sum + bucket.decisions, 0)).toBe(evidence.opportunities);
  expect(histogram.filter((bucket) => bucket.copies > 0)
    .reduce((sum, bucket) => sum + bucket.decisions, 0)).toBe(evidence.selected);
  expect(histogram.reduce((sum, bucket) => sum + bucket.copies * bucket.decisions, 0))
    .toBe(evidence.selectedCopies);
  expect(evidence.quantity.selectedMedianCopies === null).toBe(evidence.selected === 0);
}

function canonicalCard(cardCode: string) {
  const card = REGISTRY[cardCode];
  if (!card) throw new Error(`Missing packaged test card ${cardCode}`);
  return { cardCode, name: card.name };
}
