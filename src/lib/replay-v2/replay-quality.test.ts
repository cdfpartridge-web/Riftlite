import { describe, expect, it } from "vitest";

import {
  assessReplayPublicationQuality,
  blockingReplayPublicationIssues,
} from "@/lib/replay-v2/replay-quality";
import type { CanonicalReplayV2, ReplayGame, ReplayPlayerState } from "@/lib/replay-v2/types";

describe("replay publication quality", () => {
  it("accepts a two-player replay that includes the opening and both board identities", () => {
    expect(assessReplayPublicationQuality(fixture())).toEqual({
      publishable: true,
      issues: [],
    });
  });

  it("rejects a stale mid-series snapshot with duplicate game identity and no mulligan", () => {
    const replay = fixture();
    replay.series.games = [
      game("g1", 1, 2, ["sideboarding", "in_game"]),
      game("g2", 2, 2, ["sideboarding"]),
    ];

    const quality = assessReplayPublicationQuality(replay);

    expect(quality.publishable).toBe(false);
    expect(quality.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "missing_game_one",
      "duplicate_game_number",
      "missing_mulligan",
    ]));
  });

  it("rejects captures that cannot render both players' legends and battlefields", () => {
    const replay = fixture();
    replay.series.participants[1]!.fields = {};
    replay.checkpoints[0]!.state.players.opp = {
      ...replay.checkpoints[0]!.state.players.opp!,
      fields: {},
      boardFields: {},
      zones: {},
    };

    const quality = assessReplayPublicationQuality(replay);

    expect(quality.publishable).toBe(false);
    expect(quality.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "missing_legend",
      "missing_battlefield",
    ]));
  });

  it("allows an explicit owner override only when the opening mulligan is missing", () => {
    const missingMulligan = assessReplayPublicationQuality({
      ...fixture(),
      series: {
        ...fixture().series,
        games: [game("g1", 1, 1, ["in_game"])],
      },
    });

    expect(missingMulligan.issues.map((issue) => issue.code)).toEqual(["missing_mulligan"]);
    expect(blockingReplayPublicationIssues(missingMulligan.issues, false)).toHaveLength(1);
    expect(blockingReplayPublicationIssues(missingMulligan.issues, true)).toEqual([]);

    const unsafe = [
      ...missingMulligan.issues,
      { code: "missing_gameplay" as const, message: "Gameplay is missing." },
    ];
    expect(blockingReplayPublicationIssues(unsafe, true)).toEqual([
      { code: "missing_gameplay", message: "Gameplay is missing." },
    ]);
  });
});

function fixture(): CanonicalReplayV2 {
  const players: Record<string, ReplayPlayerState> = {
    self: player("self", "Mel, Soul's Reflection", "Frozen Fortress"),
    opp: player("opp", "Akali, Rogue Assassin", "The Candlelit Sanctum"),
  };
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: "rl2_quality",
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: "capture-quality",
      roomCode: "",
      startedAt: 1_000,
      endedAt: 61_000,
      messageCount: 100,
    },
    series: {
      id: "series-quality",
      perspectivePlayerId: "self",
      format: "bo1",
      bestOf: 1,
      roomCode: "",
      startedAt: 1_000,
      endedAt: 61_000,
      participants: [
        { id: "self", name: "Jibbs", isPerspective: true, fields: { selectedBattlefield: "Frozen Fortress" } },
        { id: "opp", name: "X0TCG", isPerspective: false, fields: { selectedBattlefield: "The Candlelit Sanctum" } },
      ],
      games: [game("g1", 1, 1, ["mulligan", "in_game"])],
    },
    events: [],
    unknownEvents: [],
    diagnostics: [],
    checkpoints: [{
      id: "checkpoint-quality",
      eventIndex: -1,
      atMs: 60_000,
      stateHash: "hash",
      state: {
        seriesId: "series-quality",
        gameId: "g1",
        gameOrdinal: 1,
        phase: "in_game",
        chat: [],
        appliedEventIndex: -1,
        room: { phase: "in_game", rawPhase: "in_game", gameNumber: 1, fields: {} },
        players,
        chain: [],
        log: [],
      },
    }],
  };
}

function player(id: string, legend: string, battlefield: string): ReplayPlayerState {
  return {
    id,
    name: id,
    fields: { selectedBattlefield: battlefield },
    boardFields: {},
    zones: {
      legend: [{ id: `${id}-legend`, name: legend, source: "legend", fields: {} }],
    },
  };
}

function game(id: string, ordinal: number, gameNumber: number, phases: Array<"sideboarding" | "mulligan" | "in_game">): ReplayGame {
  return {
    id,
    ordinal,
    gameNumber,
    sourceIdentity: { explicitGameNumber: true, gameInstanceIds: [] },
    startedAt: 1_000,
    endedAt: 61_000,
    startedAtMs: 0,
    endedAtMs: 60_000,
    eventStartIndex: 0,
    eventEndIndex: 0,
    phases: phases.map((phase) => ({
      phase,
      rawPhase: phase,
      startEventIndex: 0,
      endEventIndex: 0,
      startedAtMs: 0,
      endedAtMs: 60_000,
    })),
  };
}
