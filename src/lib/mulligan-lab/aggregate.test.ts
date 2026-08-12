import { describe, expect, it } from "vitest";

import {
  buildMulliganLabSnapshot,
  extractObservedMulligan,
} from "@/lib/mulligan-lab/aggregate";
import { MulliganLabResponseSchema } from "@/lib/mulligan-lab/contracts";
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
      "OGN-001", "OGN-002", "OGN-003", "OGN-014",
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

  it("publishes raw evidence early and marks it sufficient only after both reliability gates pass", () => {
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
      evidence: { status: "early", scope: "matchup-initiative", hands: 2, players: 2 },
    });
    expect(early?.drills[0].cardEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardCode: "OGN-001", offered: 2, kept: 2, redrawn: 0 }),
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
      scope: "matchup-initiative",
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
    expect(MulliganLabResponseSchema.safeParse(snapshot).success).toBe(true);
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

    const handIds = [12, 13, 14].map((day) => buildMulliganLabSnapshot(candidates, {
      maxDrills: 1,
      generatedAt: new Date(Date.UTC(2026, 7, day, 2)),
    })?.drills[0].observedHandId);
    expect(new Set(handIds).size).toBe(3);
  });
});

function observedReplay(
  id = "replay-a",
  perspectiveWins = true,
  redrawnCardIndexes = [1, 3],
): CanonicalReplayV2 {
  const hand = [
    card("hand-1", "Synthetic card 1", "OGN-001"),
    card("hand-2", "Synthetic card 2", "OGN-002"),
    card("hand-3", "Synthetic card 3", "OGN-003"),
    card("hand-4", "Synthetic card 14", "OGN-014"),
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
        fields: {},
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
        fields: {},
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
                champion: [{ count: 1, name: "Synthetic card 14", cardCode: "OGN-014" }],
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
