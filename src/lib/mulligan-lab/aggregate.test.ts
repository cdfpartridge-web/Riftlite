import { describe, expect, it } from "vitest";

import {
  buildMulliganLabPack,
  buildMulliganLabSnapshot,
  extractObservedMulligan,
  mulliganDeckFingerprint,
} from "@/lib/mulligan-lab/aggregate";
import { MulliganLabPackResponseSchema, MulliganLabResponseSchema } from "@/lib/mulligan-lab/contracts";
import type {
  CanonicalReplayV2,
  ReplayCardState,
  ReplaySnapshot,
} from "@/lib/replay-v2";

describe("Mulligan Lab observed-data aggregate", () => {
  it("extracts an exact Game 1 decision bound to its same-replay 40-card deck", () => {
    const candidate = extractObservedMulligan(observedReplay(), "private-contributor-a");

    expect(candidate).toMatchObject({
      contributorKey: "private-contributor-a",
      initiative: "first",
      wonGame: true,
      matchup: {
        playerLegend: { cardCode: "UNL-191", name: "Master Yi, Wuju Master" },
        opponentLegend: { cardCode: "VEN-145", name: "Nasus, Curator of the Sands" },
      },
      redrawnCardIndexes: [1, 3],
      observation: {
        provider: "atlas",
        gameNumber: 1,
      },
    });
    expect(candidate?.hand.map((card) => card.cardCode)).toEqual([
      "OGN-001", "OGN-002", "OGN-003", "OGN-013",
    ]);
    expect(candidate?.deck.mainDeck.reduce((sum, card) => sum + card.count, 0)).toBe(40);
    expect(candidate?.deck.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed when the hand is not in the bound deck or redraw patch is not exact", () => {
    const offDeck = observedReplay();
    const snapshot = snapshotOf(offDeck);
    snapshot.players.self.zones.hand[0] = card("hand-off-deck", "Off-deck card", "SFD-250");
    expect(extractObservedMulligan(offDeck, "player-a")).toBeNull();

    const inexactAction = observedReplay();
    const action = inexactAction.events.find((event) => event.kind === "action");
    if (!action || action.kind !== "action") throw new Error("missing action");
    const remove = action.patch.operations.find((operation) => operation.op === "zone_remove");
    if (!remove || remove.op !== "zone_remove") throw new Error("missing real-shaped redraw patch");
    remove.cardIds = ["not-in-the-observed-hand"];
    expect(extractObservedMulligan(inexactAction, "player-a")).toBeNull();
  });

  it("accepts the real Atlas keep-all shape with no action.cardIds and no hand removal", () => {
    const replay = observedReplay("keep-all", true, []);
    const action = replay.events.find((event) => event.kind === "action");
    if (!action || action.kind !== "action") throw new Error("missing action");

    expect(action.action).toEqual({ type: "submit_mulligan" });
    expect(action.patch.operations.some((operation) => (
      operation.op === "zone_remove" && operation.zone === "hand"
    ))).toBe(false);
    expect(extractObservedMulligan(replay, "player-keep-all")?.redrawnCardIndexes).toEqual([]);
  });

  it("publishes raw evidence early and keeps per-card guidance neutral below its stronger gate", () => {
    const first = extractObservedMulligan(observedReplay("replay-a", true), "player-a");
    const second = extractObservedMulligan(observedReplay("replay-b", false), "player-b");
    if (!first || !second) throw new Error("fixtures must be extractable");

    const early = buildMulliganLabSnapshot([first, second], {
      minimumHands: 2,
      minimumPlayers: 3,
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });
    expect(early?.drills).toHaveLength(2);
    expect(early?.drills[0]).toMatchObject({
      evidence: { status: "early", scope: "matchup", hands: 2, players: 2 },
    });
    expect(early?.drills[0].cardEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cardCode: "OGN-001",
        identityCode: "OGN-001",
        scope: "matchup",
        offered: 2,
        kept: 2,
        redrawn: 0,
        guidance: "unclear",
        evidenceStatus: "limited",
      }),
    ]));

    const snapshot = buildMulliganLabSnapshot([first, second], {
      minimumHands: 2,
      minimumPlayers: 2,
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });
    expect(snapshot?.status).toBe("ready");
    expect(snapshot?.drills).toHaveLength(2);
    expect(snapshot?.drills[0].evidence).toEqual({
      status: "sufficient",
      scope: "matchup",
      deckScope: "all-observed-decks",
      guidanceBasis: "community-keep-rate",
      outcomeInterpretation: "descriptive-not-causal",
      playerLegendIdentityCode: "UNL-191",
      opponentLegendIdentityCode: "VEN-145",
      hands: 2,
      players: 2,
    });
    expect(snapshot?.drills[0].cardEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardCode: "OGN-001", offered: 2, kept: 2, redrawn: 0, keptWins: 1 }),
      expect.objectContaining({ cardCode: "OGN-002", offered: 2, kept: 0, redrawn: 2, redrawnWins: 1 }),
    ]));

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("player-a");
    expect(serialized).not.toContain("player-b");
    expect(serialized).not.toContain("replay-a");
    expect(serialized).not.toContain("observedDecision");
    expect(serialized).not.toContain("observedHandId");
    expect(serialized).not.toContain("eventKey");
    expect(serialized).not.toContain("matchKey");
    expect(snapshot?.version).toBe(2);
    expect(MulliganLabResponseSchema.safeParse(snapshot).success).toBe(true);
  });

  it("pools both initiatives for one oriented legend matchup", () => {
    const first = extractObservedMulligan(observedReplay("first"), "player-a");
    const second = extractObservedMulligan(observedReplay("second"), "player-b");
    if (!first || !second) throw new Error("fixtures must be extractable");
    second.initiative = "second";

    const snapshot = buildMulliganLabSnapshot([first, second], {
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });

    expect(snapshot?.drills).toHaveLength(2);
    expect(snapshot?.drills.every((drill) => drill.evidence.hands === 2)).toBe(true);
  });

  it("publishes a privacy-gated targeted pack with curve, initiative, and period slices", () => {
    const base = extractObservedMulligan(observedReplay("target-pack"), "player-0");
    if (!base) throw new Error("fixture must be extractable");
    const candidates = Array.from({ length: 30 }, (_, index) => ({
      ...base,
      observedHandId: `mh1_${(index + 800).toString(16).padStart(32, "0")}`,
      contributorKey: `target-player-${index % 12}`,
      observation: {
        ...base.observation,
        observedOn: index < 15 ? "2026-07-15" : "2026-08-12",
      },
      initiative: index % 2 === 0 ? "first" as const : "second" as const,
      redrawnCardIndexes: index < 24 ? [1] : [0, 1],
    }));
    const pack = buildMulliganLabPack(candidates, {
      playerLegendIdentityCode: "UNL-191",
      opponentLegendIdentityCode: "VEN-145",
      deckFingerprint: base.deck.fingerprint,
    }, {
      generatedAt: new Date("2026-08-13T06:00:00.000Z"),
      backfillComplete: true,
      maxDrills: 4,
    });

    expect(MulliganLabPackResponseSchema.safeParse(pack).success).toBe(true);
    expect(pack).toMatchObject({
      schema: "riftlite-mulligan-lab-pack",
      query: {
        resolved: { scope: "exact-deck", sharedCards: 40, totalCards: 40 },
        fallbackReason: null,
      },
      source: {
        includedPeriods: ["preseason", "current-season"],
        cardRegistryPrints: 1180,
      },
    });
    expect(pack?.drills[0].context?.curve).toMatchObject({
      classification: "two-drop-present",
      twoDropCount: 2,
    });
    expect(pack?.drills[0]).toMatchObject({
      deck: { chosenChampionCode: "OGN-027" },
      context: {
        battlefields: {
          player: { cardCode: "OGN-291" },
          opponent: { cardCode: "OGN-283" },
        },
        setup: {
          chosenChampion: { cardCode: "OGN-027" },
          replacementPoolCards: 35,
        },
      },
      decisionEvidence: {
        scope: "matching-curve",
        hands: 30,
        players: 12,
        redrawCountHistogram: [
          { redraws: 0, hands: 0 },
          { redraws: 1, hands: 24 },
          { redraws: 2, hands: 6 },
        ],
        mostCommonRedrawCount: 1,
        twoRedrawRate: 0.2,
        evidenceStatus: "robust",
      },
    });
    const evidence = pack?.drills[0].cardEvidence.find((entry) => entry.cardCode === "OGN-001");
    expect(evidence?.slices).toMatchObject({
      matchingCurve: { offered: 30, players: 12 },
      preseason: { offered: 15 },
      currentSeason: { offered: 15 },
    });
    expect(JSON.stringify(pack)).not.toContain("target-player");
  });

  it("uses player-legend evidence when a matchup is sparse and grades a broad consensus", () => {
    const base = extractObservedMulligan(observedReplay("holistic-base"), "player-0");
    if (!base) throw new Error("fixture must be extractable");
    const candidates = Array.from({ length: 30 }, (_, index) => ({
      ...base,
      observedHandId: `mh1_${(index + 100).toString(16).padStart(32, "0")}`,
      contributorKey: `player-${index}`,
      matchup: {
        ...base.matchup,
        opponentLegend: index < 15
          ? base.matchup.opponentLegend
          : { cardCode: "SFD-250", name: "Other legend" },
      },
      redrawnCardIndexes: index < 3 ? [0, 1] : [1],
      wonGame: index % 2 === 0,
    }));

    const snapshot = buildMulliganLabSnapshot(candidates, {
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });
    const evidence = snapshot?.drills[0].cardEvidence.find((entry) => entry.cardCode === "OGN-001");

    expect(evidence).toMatchObject({
      scope: "player-legend",
      scopeHands: 30,
      scopePlayers: 30,
      offered: 30,
      players: 30,
      kept: 27,
      redrawn: 3,
      keepRate: 0.9,
      guidancePlayers: 30,
      guidanceKept: 27,
      guidanceKeepRate: 0.9,
      guidance: "strong_keep",
      evidenceStatus: "robust",
      outcomeStatus: "one_sided",
    });
  });

  it("shows a materially broader developing player-legend fallback", () => {
    const base = extractObservedMulligan(observedReplay("developing-fallback"), "player-0");
    if (!base) throw new Error("fixture must be extractable");
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      ...base,
      observedHandId: `mh1_${(index + 180).toString(16).padStart(32, "0")}`,
      contributorKey: `developing-player-${index % 4}`,
      matchup: {
        ...base.matchup,
        opponentLegend: index < 2
          ? base.matchup.opponentLegend
          : { cardCode: "SFD-250", name: "Other legend" },
      },
      redrawnCardIndexes: [1],
    }));

    const snapshot = buildMulliganLabSnapshot(candidates, {
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });
    const target = snapshot?.drills.find((drill) => (
      drill.matchup.opponentLegend.cardCode === "VEN-145"
    ));
    expect(target?.cardEvidence.find((entry) => entry.cardCode === "OGN-001"))
      .toMatchObject({
        scope: "player-legend",
        offered: 8,
        guidancePlayers: 4,
        evidenceStatus: "developing",
        guidance: "unclear",
      });
    const pack = buildMulliganLabPack(candidates, {
      playerLegendIdentityCode: base.matchup.playerLegend.cardCode,
      opponentLegendIdentityCode: base.matchup.opponentLegend.cardCode,
    }, { generatedAt: new Date("2026-08-12T02:00:00.000Z") });
    expect(pack?.drills.length).toBeGreaterThan(0);
    expect(pack?.drills.every((drill) => !Object.prototype.hasOwnProperty.call(drill, "decisionEvidence")))
      .toBe(true);
  });

  it("keeps developing matchup evidence over a marginally broader legend scope", () => {
    const base = extractObservedMulligan(observedReplay("developing-relevance"), "player-0");
    if (!base) throw new Error("fixture must be extractable");
    const candidates = Array.from({ length: 9 }, (_, index) => ({
      ...base,
      observedHandId: `mh1_${(index + 190).toString(16).padStart(32, "0")}`,
      contributorKey: `relevance-player-${index < 8 ? index % 4 : 4}`,
      matchup: {
        ...base.matchup,
        opponentLegend: index < 8
          ? base.matchup.opponentLegend
          : { cardCode: "SFD-250", name: "Other legend" },
      },
      redrawnCardIndexes: [1],
    }));

    const snapshot = buildMulliganLabSnapshot(candidates, {
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });
    const target = snapshot?.drills.find((drill) => (
      drill.matchup.opponentLegend.cardCode === "VEN-145"
    ));

    expect(target?.cardEvidence.find((entry) => entry.cardCode === "OGN-001"))
      .toMatchObject({
        scope: "matchup",
        offered: 8,
        guidancePlayers: 4,
        evidenceStatus: "developing",
        guidance: "unclear",
      });
  });

  it("counts unanimous duplicate choices once and omits a partial duplicate decision", () => {
    const allKept = extractObservedMulligan(observedReplay("duplicate-kept", true, []), "player-a");
    const allRedrawn = extractObservedMulligan(observedReplay("duplicate-redrawn", false, [0, 1]), "player-b");
    const mixed = extractObservedMulligan(observedReplay("duplicate-mixed", true, [0]), "player-c");
    if (!allKept || !allRedrawn || !mixed) throw new Error("fixtures must be extractable");
    for (const candidate of [allKept, allRedrawn, mixed]) candidate.hand[1] = { ...candidate.hand[0] };

    const snapshot = buildMulliganLabSnapshot([allKept, allRedrawn, mixed], {
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });
    const evidence = snapshot?.drills[0].cardEvidence.find((entry) => entry.cardCode === "OGN-001");

    expect(evidence).toMatchObject({
      offered: 2,
      kept: 1,
      redrawn: 1,
      keptWins: 1,
      redrawnWins: 0,
    });
  });

  it("does not publish a drill whose duplicate identity has only partial decisions", () => {
    const mixed = extractObservedMulligan(observedReplay("duplicate-only-mixed", true, [0]), "player-a");
    if (!mixed) throw new Error("fixture must be extractable");
    mixed.hand[1] = { ...mixed.hand[0] };

    expect(buildMulliganLabSnapshot([mixed], {
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    })).toBeNull();
  });

  it("prefers reliable exact-matchup evidence over the broader backoff", () => {
    const base = extractObservedMulligan(observedReplay("exact-base"), "player-0");
    if (!base) throw new Error("fixture must be extractable");
    const candidates = Array.from({ length: 30 }, (_, index) => ({
      ...base,
      observedHandId: `mh1_${(index + 200).toString(16).padStart(32, "0")}`,
      contributorKey: `player-${index % 10}`,
      redrawnCardIndexes: [1],
    }));
    const snapshot = buildMulliganLabSnapshot(candidates, {
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });
    expect(snapshot?.drills[0].cardEvidence.find((entry) => entry.cardCode === "OGN-001"))
      .toMatchObject({
        scope: "matchup",
        offered: 30,
        players: 10,
        guidancePlayers: 10,
        guidanceKept: 10,
        guidanceKeepRate: 1,
        guidance: "strong_keep",
      });
  });

  it("includes every hand in raw counts while leaving one contributor ungraded", () => {
    const base = extractObservedMulligan(observedReplay("cap-base"), "one-player");
    if (!base) throw new Error("fixture must be extractable");
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      ...base,
      observedHandId: `mh1_${(index + 300).toString(16).padStart(32, "0")}`,
      redrawnCardIndexes: [1],
    }));
    const snapshot = buildMulliganLabSnapshot(candidates, {
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });
    expect(snapshot?.drills[0].cardEvidence.find((entry) => entry.cardCode === "OGN-001"))
      .toMatchObject({
        scope: "matchup",
        scopeHands: 12,
        scopePlayers: 1,
        offered: 12,
        players: 1,
        guidancePlayers: 1,
        guidance: "unclear",
      });
  });

  it("derives one majority vote per contributor from all hands and lets ties abstain", () => {
    const base = extractObservedMulligan(observedReplay("majority-vote"), "player-a");
    if (!base) throw new Error("fixture must be extractable");
    const candidates = Array.from({ length: 5 }, (_, index) => ({
      ...base,
      observedHandId: `mh1_${(index + 350).toString(16).padStart(32, "0")}`,
      contributorKey: index < 3 ? "player-a" : "player-b",
      // Player A keeps card 0 twice and redraws it once: one keep vote.
      // Player B keeps/redraws once each: a deterministic abstention.
      redrawnCardIndexes: index === 1 || index === 4 ? [0] : [1],
    }));
    const snapshot = buildMulliganLabSnapshot(candidates, {
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });
    const evidence = snapshot?.drills[0].cardEvidence.find((entry) => entry.cardCode === "OGN-001");

    expect(evidence).toMatchObject({
      offered: 5,
      kept: 3,
      redrawn: 2,
      players: 2,
      guidancePlayers: 1,
      guidanceKept: 1,
      guidanceKeepRate: 1,
      baselineKeepRate: 5 / 6,
    });
  });

  it("pools alternate art by base identity while keeping the shown exact print", () => {
    const base = extractObservedMulligan(observedReplay("base-art"), "player-a");
    const alternate = extractObservedMulligan(observedReplay("alternate-art"), "player-b");
    if (!base || !alternate) throw new Error("fixtures must be extractable");
    replaceCardPrint(base, "OGN-001", "OGN-030", "Jinx, Demolitionist");
    replaceCardPrint(alternate, "OGN-001", "OGN-030A", "Jinx, Demolitionist");
    const snapshot = buildMulliganLabSnapshot([base, alternate], {
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });

    expect(new Set(snapshot?.drills.map((drill) => (
      drill.hand.find((card) => card.cardCode.startsWith("OGN-030"))?.cardCode
    )))).toEqual(new Set(["OGN-030", "OGN-030A"]));
    for (const drill of snapshot?.drills ?? []) {
      const shown = drill.hand.find((card) => card.cardCode.startsWith("OGN-030"));
      expect(drill.cardEvidence.find((entry) => entry.cardCode === shown?.cardCode)).toMatchObject({
        identityCode: "OGN-030",
        offered: 2,
      });
    }
  });

  it("round-robins matchup cohorts so one large cohort cannot consume the drill pack", () => {
    const first = extractObservedMulligan(observedReplay("replay-a"), "player-a");
    const second = extractObservedMulligan(observedReplay("replay-b"), "player-b");
    const otherMatchup = extractObservedMulligan(observedReplay("replay-c"), "player-c");
    if (!first || !second || !otherMatchup) throw new Error("fixtures must be extractable");
    otherMatchup.matchup.opponentLegend = { cardCode: "SFD-250", name: "Other legend" };

    const snapshot = buildMulliganLabSnapshot([first, second, otherMatchup], {
      maxDrills: 2,
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });

    expect(new Set(snapshot?.drills.map((drill) => drill.matchup.opponentLegend.cardCode))).toEqual(
      new Set(["VEN-145", "SFD-250"]),
    );
  });

  it("rotates a bounded daily pack through every observed matchup cohort", () => {
    const base = extractObservedMulligan(observedReplay("rotation-base"), "rotation-player");
    if (!base) throw new Error("fixture must be extractable");

    const variant = (sequence: number, opponentCode: string) => ({
      ...base,
      observedHandId: `mh1_${sequence.toString(16).padStart(32, "0")}`,
      contributorKey: `rotation-player-${sequence}`,
      observation: {
        ...base.observation,
        matchKey: `mm1_${sequence.toString(16).padStart(32, "0")}`,
        eventKey: `me1_${sequence.toString(16).padStart(32, "0")}`,
      },
      matchup: {
        ...base.matchup,
        opponentLegend: { cardCode: opponentCode, name: `Opponent ${opponentCode}` },
      },
    });
    const candidates = [
      ...Array.from({ length: 4 }, (_, index) => variant(index + 1, "VEN-145")),
      ...Array.from({ length: 6 }, (_, index) => variant(index + 20, `SFD-${String(index + 201).padStart(3, "0")}`)),
    ];

    const first = buildMulliganLabSnapshot(candidates, {
      maxDrills: 2,
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });
    const repeated = buildMulliganLabSnapshot(candidates, {
      maxDrills: 2,
      generatedAt: new Date("2026-08-12T22:00:00.000Z"),
    });
    expect(repeated?.drills.map((drill) => drill.id)).toEqual(first?.drills.map((drill) => drill.id));

    const seenMatchups = new Set<string>();
    for (let day = 12; day < 19; day += 1) {
      const snapshot = buildMulliganLabSnapshot(candidates, {
        maxDrills: 2,
        generatedAt: new Date(Date.UTC(2026, 7, day, 2)),
      });
      snapshot?.drills.forEach((drill) => seenMatchups.add(drill.matchup.opponentLegend.cardCode));
    }
    expect(seenMatchups).toEqual(new Set([
      "VEN-145", "SFD-201", "SFD-202", "SFD-203", "SFD-204", "SFD-205", "SFD-206",
    ]));
  });

  it("rotates the exact observed hand contributed by a cohort each UTC day", () => {
    const base = extractObservedMulligan(observedReplay("hand-rotation-base"), "rotation-player");
    if (!base) throw new Error("fixture must be extractable");
    const candidates = Array.from({ length: 3 }, (_, index) => ({
      ...base,
      observedHandId: `mh1_${(index + 1).toString(16).padStart(32, "0")}`,
      contributorKey: `rotation-player-${index}`,
    }));

    const drillIds = [12, 13, 14].map((day) => buildMulliganLabSnapshot(candidates, {
      maxDrills: 1,
      generatedAt: new Date(Date.UTC(2026, 7, day, 2)),
    })?.drills[0].id);
    expect(new Set(drillIds).size).toBe(3);
  });

  it("prioritizes evidence-rich matchups when the daily pack is bounded", () => {
    const base = extractObservedMulligan(observedReplay("rich-base"), "player-a");
    if (!base) throw new Error("fixture must be extractable");
    const rich = Array.from({ length: 5 }, (_, index) => ({
      ...base,
      observedHandId: `mh1_${(index + 400).toString(16).padStart(32, "0")}`,
      contributorKey: `rich-player-${index}`,
    }));
    const sparse = {
      ...base,
      observedHandId: `mh1_${"f".repeat(32)}`,
      contributorKey: "sparse-player",
      matchup: {
        ...base.matchup,
        opponentLegend: { cardCode: "SFD-250", name: "Sparse opponent" },
      },
    };
    const snapshot = buildMulliganLabSnapshot([...rich, sparse], {
      maxDrills: 1,
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });
    expect(snapshot?.drills[0].matchup.opponentLegend.cardCode).toBe("VEN-145");
  });

  it("orders robust directional exercises before developing and limited exercises", () => {
    const base = extractObservedMulligan(observedReplay("priority-base"), "player-0");
    if (!base) throw new Error("fixture must be extractable");
    const robust = Array.from({ length: 30 }, (_, index) => ({
      ...base,
      observedHandId: `mh1_${(index + 500).toString(16).padStart(32, "0")}`,
      contributorKey: `priority-player-${index}`,
      redrawnCardIndexes: [1],
    }));
    const limited = {
      ...base,
      observedHandId: `mh1_${"e".repeat(32)}`,
      contributorKey: "limited-player",
      matchup: {
        ...base.matchup,
        playerLegend: { cardCode: "SFD-221", name: "Limited player legend" },
        opponentLegend: { cardCode: "SFD-250", name: "Limited opponent" },
      },
    };
    const snapshot = buildMulliganLabSnapshot([...robust, limited], {
      generatedAt: new Date("2026-08-12T02:00:00.000Z"),
    });

    expect(snapshot?.drills[0].cardEvidence.some((entry) => entry.guidance === "strong_keep")).toBe(true);
    expect(snapshot?.drills.at(-1)?.matchup.playerLegend.cardCode).toBe("SFD-221");
    expect(buildMulliganLabSnapshot([...robust, limited], {
      generatedAt: new Date("2026-08-12T22:00:00.000Z"),
    })?.drills.map((drill) => drill.id)).toEqual(snapshot?.drills.map((drill) => drill.id));
  });

  it("publishes truthful all-history coverage across preseason and current season", () => {
    const candidate = extractObservedMulligan(observedReplay("coverage"), "player-a");
    if (!candidate) throw new Error("fixture must be extractable");
    candidate.observation.observedOn = "2026-07-30";
    const later = {
      ...candidate,
      observedHandId: `mh1_${"d".repeat(32)}`,
      contributorKey: "player-b",
      observation: { ...candidate.observation, observedOn: "2026-08-12" },
    };
    const snapshot = buildMulliganLabSnapshot([candidate, later], {
      generatedAt: new Date("2026-08-12T22:00:00.000Z"),
      coverageTruncated: true,
      backfillComplete: true,
    });

    expect(snapshot?.source).toMatchObject({
      observedFrom: "2026-07-30",
      observedThrough: "2026-08-12",
      includedFacts: 2,
      coverageTruncated: true,
      coveragePolicy: "all-available-history",
      includedPeriods: ["preseason", "current-season"],
      backfillComplete: true,
      seasonCoverage: {
        currentSeasonStartedOn: "2026-07-31",
        preseasonFacts: 1,
        currentSeasonFacts: 1,
      },
    });
    expect(snapshot?.drills[0].cardEvidence.every((evidence) => evidence.offered === 2)).toBe(true);
  });
});

function replaceCardPrint(
  candidate: NonNullable<ReturnType<typeof extractObservedMulligan>>,
  from: string,
  cardCode: string,
  name: string,
): void {
  candidate.hand = candidate.hand.map((card) => card.cardCode === from ? { cardCode, name } : card);
  candidate.deck.mainDeck = candidate.deck.mainDeck.map((card) => (
    card.cardCode === from ? { ...card, cardCode, name } : card
  ));
  candidate.deck.fingerprint = mulliganDeckFingerprint(candidate.deck.mainDeck);
}

function observedReplay(
  id = "replay-a",
  perspectiveWins = true,
  redrawnCardIndexes = [1, 3],
): CanonicalReplayV2 {
  const hand = [
    card("hand-1", "Synthetic card 1", "OGN-001"),
    card("hand-2", "Synthetic card 2", "OGN-002"),
    card("hand-3", "Synthetic card 3", "OGN-003"),
    card("hand-4", "Synthetic card 13", "OGN-013"),
  ];
  // Mirrors Atlas' real participant deck shape: 39 MainDeck cards plus one
  // separately-labelled signature Champion form the forty shuffled cards.
  const mainDeckEntries = Array.from({ length: 13 }, (_, index) => {
    const code = `OGN-${String(index + 1).padStart(3, "0")}`;
    return { count: 3, name: `Synthetic card ${index + 1}`, cardCode: code };
  });
  const snapshot: ReplaySnapshot = {
    room: {
      phase: "mulligan",
      rawPhase: "mulligan",
      gameNumber: 1,
      firstPlayerId: "self",
      fields: {},
    },
    players: {
      self: {
        id: "self",
        name: "Player",
        fields: { selectedBattlefield: { cardCode: "OGN-291", name: "The Candlelit Sanctum" } },
        boardFields: {},
        zones: {
          hand,
          deck: Array.from({ length: 36 }, (_entry, index) => ({
            id: `hidden-deck-${index}`,
            name: "",
            source: "deck",
            isPlaceholder: true,
            fields: {},
          })),
          legend: [card("legend-self", "Master Yi, Wuju Master", "UNL-191", "legend")],
        },
      },
      opponent: {
        id: "opponent",
        name: "Opponent",
        fields: { selectedBattlefield: { cardCode: "OGN-283", name: "Navori Fighting Pit" } },
        boardFields: {},
        zones: {
          hand: [],
          legend: [card("legend-opponent", "Nasus, Curator of the Sands", "VEN-145", "legend")],
        },
      },
    },
    chain: [],
    log: [],
  };
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id,
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: `capture-${id}`,
      roomCode: "TEST",
      startedAt: 1_000,
      endedAt: 2_000,
      messageCount: 2,
    },
    series: {
      id: `series-${id}`,
      perspectivePlayerId: "self",
      format: "bo1",
      bestOf: 1,
      roomCode: "TEST",
      startedAt: 1_000,
      endedAt: 2_000,
      participants: [
        {
          id: "self",
          name: "Player",
          isPerspective: true,
          fields: {
            decklistRaw: "authoritative raw list",
            deck: {
              sections: {
                legend: [{ count: 1, name: "Master Yi, Wuju Master", cardCode: "UNL-191" }],
                champion: [{ count: 1, name: "Darius, Trifarian", cardCode: "OGN-027" }],
                mainDeck: mainDeckEntries,
              },
              totals: { champion: 1, mainDeck: 39 },
            },
          },
        },
        { id: "opponent", name: "Opponent", isPerspective: false, fields: {} },
      ],
      games: [{
        id: "game-1",
        ordinal: 1,
        gameNumber: 1,
        sourceIdentity: { explicitGameNumber: true, gameInstanceIds: ["game-instance"] },
        startedAt: 1_000,
        endedAt: 2_000,
        startedAtMs: 0,
        endedAtMs: 1_000,
        eventStartIndex: 0,
        eventEndIndex: 2,
        phases: [],
        result: {
          resultEventId: "result-1",
          winnerPlayerId: perspectiveWins ? "self" : "opponent",
          loserPlayerId: perspectiveWins ? "opponent" : "self",
        },
      }],
    },
    events: [
      {
        id: "boundary",
        index: 0,
        at: Date.UTC(2026, 7, 12, 10),
        atMs: 0,
        sourceMessageId: "message-0",
        gameId: "game-1",
        kind: "game_boundary",
        boundary: "start",
        gameOrdinal: 1,
        gameNumber: 1,
        reason: "series_start",
      },
      {
        id: "snapshot",
        index: 1,
        at: Date.UTC(2026, 7, 12, 10, 0, 1),
        atMs: 100,
        sourceMessageId: "message-1",
        gameId: "game-1",
        kind: "snapshot",
        snapshot,
      },
      {
        id: "mulligan",
        index: 2,
        at: Date.UTC(2026, 7, 12, 10, 0, 2),
        atMs: 200,
        sourceMessageId: "message-2",
        gameId: "game-1",
        kind: "action",
        actionType: "submit_mulligan",
        actorPlayerId: "self",
        action: { type: "submit_mulligan" },
        confirmation: {
          status: "confirmed",
          authority: "authoritative_patch_commit",
          correlation: "matched_intent",
          commitMessageId: "message-2",
        },
        patch: {
          operations: [
            {
              id: "playback",
              op: "set_room_fields",
              fields: {
                mulliganPlaybackByPlayerId: {
                  self: { redrawCount: redrawnCardIndexes.length, draws: [] },
                },
              },
            },
            ...(redrawnCardIndexes.length ? [{
              id: "remove-redraws",
              op: "zone_remove" as const,
              playerId: "self",
              zone: "hand",
              cardIds: redrawnCardIndexes.map((index) => hand[index].id),
            }] : []),
          ],
        },
      },
    ],
    unknownEvents: [],
    diagnostics: [],
    checkpoints: [],
  };
}

function snapshotOf(replay: CanonicalReplayV2): ReplaySnapshot {
  const event = replay.events.find((candidate) => candidate.kind === "snapshot");
  if (!event || event.kind !== "snapshot") throw new Error("missing snapshot");
  return event.snapshot;
}

function card(
  id: string,
  name: string,
  cardCode: string,
  source = "mainDeck",
): ReplayCardState {
  return { id, name, cardCode, source, isPlaceholder: false, fields: { name, cardCode, source } };
}
