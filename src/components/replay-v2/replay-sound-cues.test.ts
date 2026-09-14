import { describe, expect, it } from "vitest";

import type {
  CanonicalReplayV2,
  JsonObject,
  ReplayActionEvent,
  ReplayEvent,
  ReplayGameBoundaryEvent,
  ReplayPhase,
  ReplayPhaseEvent,
  ReplaySnapshotEvent,
} from "@/lib/replay-v2";

import { latestReplaySoundCue, replaySoundCues, type ReplaySoundCue } from "./replay-sound-cues";

describe("replay sound cues", () => {
  it("sounds the first turn after mulligan and later authoritative turns once each", () => {
    const replay = fixture([
      snapshot(0, { phase: "mulligan", turnNumber: 1 }),
      phase(1, "in_game"),
      snapshot(2, { turnNumber: 1 }),
      action(3, { turnNumber: 2 }),
      snapshot(4, { turnNumber: 2 }),
      { ...action(5), action: { type: "end_turn", turnNumber: 3 } },
    ]);

    expect(replaySoundCues(replay)).toEqual([cue("turn-start", 1), cue("turn-start", 3)]);
  });

  it("waits for the first confirmed turn number when the gameplay phase arrives first", () => {
    const replay = fixture([
      snapshot(0, { phase: "mulligan", turnNumber: 0 }),
      phase(1, "in_game"),
      action(2, { turnNumber: 1 }),
      snapshot(3, { turnNumber: 1 }),
    ]);

    expect(replaySoundCues(replay)).toEqual([cue("turn-start", 2)]);
  });

  it("keeps a partial capture's initial gameplay snapshot silent", () => {
    const replay = fixture([
      phase(0, "in_game"),
      snapshot(1, { turnNumber: 5 }),
      snapshot(2, { turnNumber: 5 }),
      action(3, { turnNumber: 6 }),
    ]);

    expect(replaySoundCues(replay)).toEqual([cue("turn-start", 3)]);
    expect(replaySoundCues(fixture([snapshot(0, { turnNumber: 1 })]))).toEqual([]);
  });

  it("does not assume an opening-to-late-game gap captured the first turn", () => {
    expect(replaySoundCues(fixture([
      phase(0, "mulligan"),
      snapshot(1, { turnNumber: 6 }),
      action(2, { turnNumber: 7 }),
    ]))).toEqual([cue("turn-start", 2)]);
  });

  it("ignores turn corrections, active-player changes and repeated setup phases", () => {
    const replay = fixture([
      snapshot(0, { turnNumber: 3 }),
      action(1, { activeTurnPlayerId: "opponent" }),
      action(2, { turnNumber: 2 }),
      action(3, { turnNumber: 3 }),
      phase(4, "mulligan"),
      phase(5, "in_game"),
      action(6, { turnNumber: 4 }),
    ]);

    expect(replaySoundCues(replay)).toEqual([cue("turn-start", 6)]);
  });

  it("starts a fresh baseline for each BO3 game without sounding boundaries or game ends", () => {
    const replay = fixture([
      snapshot(0, { turnNumber: 8 }),
      boundary(1, "end"),
      action(2, { turnNumber: 9 }),
      boundary(3, "start", "game-2"),
      snapshot(4, { gameId: "game-2", phase: "mulligan", turnNumber: 1 }),
      phase(5, "in_game", "game-2"),
      snapshot(6, { gameId: "game-2", turnNumber: 1 }),
      phase(7, "game_end", "game-2"),
      action(8, { turnNumber: 2 }, {}, "game-2"),
      boundary(9, "start", "game-3"),
      snapshot(10, { gameId: "game-3", turnNumber: 3 }),
      action(11, { turnNumber: 4 }, {}, "game-3"),
    ]);

    expect(replaySoundCues(replay)).toEqual([cue("turn-start", 5), cue("turn-start", 11)]);
  });

  it("sounds one point cue per score event, including multi-point awards, without echoes", () => {
    const replay = fixture([
      snapshot(0, { selfScore: 3, opponentScore: 2 }),
      action(1, {}, { self: 4 }),
      snapshot(2, { selfScore: 4, opponentScore: 2 }),
      action(3, {}, { self: 6 }),
      action(4, {}, { opponent: 3 }),
    ]);

    expect(replaySoundCues(replay)).toEqual([
      cue("point-scored", 1), cue("point-scored", 3), cue("point-scored", 4),
    ]);
  });

  it("supports a snapshot-only score increase after the known baseline", () => {
    expect(replaySoundCues(fixture([
      snapshot(0),
      snapshot(1, { opponentScore: 1 }),
    ]))).toEqual([cue("point-scored", 1)]);
  });

  it("keeps initial scores, downward corrections, simultaneous updates and game resets silent", () => {
    const replay = fixture([
      snapshot(0, { selfScore: 4, opponentScore: 3 }),
      action(1, {}, { self: 3 }),
      action(2, {}, { self: 4, opponent: 4 }),
      boundary(3, "start", "game-2"),
      snapshot(4, { gameId: "game-2", selfScore: 1, opponentScore: 0 }),
    ]);

    expect(replaySoundCues(replay)).toEqual([]);
  });

  it("gives a point award priority when the same event also starts a turn", () => {
    const replay = fixture([
      snapshot(0, { turnNumber: 1 }),
      action(1, { turnNumber: 2 }, { self: 1 }),
    ]);

    expect(replaySoundCues(replay)).toEqual([cue("point-scored", 1)]);
  });

  it("uses event indexes to select the final cue when multiple events share a timestamp", () => {
    const score = { ...action(2, {}, { self: 1 }), at: 1_000, atMs: 1_000 };
    const cues = replaySoundCues(fixture([
      snapshot(0, { turnNumber: 1 }),
      action(1, { turnNumber: 2 }),
      score,
    ]));

    expect(cues).toEqual([
      cue("turn-start", 1),
      { kind: "point-scored", eventIndex: 2, atMs: 1_000 },
    ]);
    expect(latestReplaySoundCue(cues, 0, 2)).toEqual(cues[1]);
    expect(latestReplaySoundCue(cues, 2, 3)).toBeNull();
  });

  it("ignores events without game identity and leaves the input replay unchanged", () => {
    const ambiguous = action(1, { turnNumber: 2 }, { self: 1 });
    ambiguous.gameId = null;
    const replay = fixture([snapshot(0, { turnNumber: 1 }), ambiguous, action(2, { turnNumber: 2 })]);
    const before = JSON.stringify(replay);

    expect(replaySoundCues(replay)).toEqual([cue("turn-start", 2)]);
    expect(JSON.stringify(replay)).toBe(before);
  });
});

describe("latest crossed replay sound cue", () => {
  const cues = [cue("turn-start", 2), cue("point-scored", 4), cue("turn-start", 8)];

  it("chooses only the last cue crossed during a fast playback frame", () => {
    expect(latestReplaySoundCue(cues, 0, 5)).toEqual(cues[1]);
    expect(latestReplaySoundCue(cues, 4, 8)).toEqual(cues[2]);
    expect(latestReplaySoundCue(cues, -1, 2)).toEqual(cues[0]);
  });

  it("never repeats a consumed cue or emits during backward or empty ranges", () => {
    expect(latestReplaySoundCue(cues, 4, 7)).toBeNull();
    expect(latestReplaySoundCue(cues, 4, 4)).toBeNull();
    expect(latestReplaySoundCue(cues, 8, 2)).toBeNull();
    expect(latestReplaySoundCue(cues, 0, 1)).toBeNull();
    expect(latestReplaySoundCue([], -1, 20)).toBeNull();
    expect(latestReplaySoundCue(cues, Number.NaN, 8)).toBeNull();
    expect(latestReplaySoundCue(cues, 0, Infinity)).toBeNull();
  });
});

function cue(kind: ReplaySoundCue["kind"], eventIndex: number): ReplaySoundCue {
  return { kind, eventIndex, atMs: eventIndex * 1_000 };
}

function fixture(events: ReplayEvent[]): Pick<CanonicalReplayV2, "events" | "series"> {
  return {
    events,
    series: {
      id: "series", perspectivePlayerId: "self", format: "bo3", bestOf: 3, roomCode: "SOUND",
      startedAt: 0, endedAt: events.length * 1_000, games: [],
      participants: [
        { id: "self", name: "Player", isPerspective: true, fields: {} },
        { id: "opponent", name: "Opponent", isPerspective: false, fields: {} },
      ],
    },
  };
}

function base(index: number, gameId = "game-1") {
  return { id: `event-${index}`, index, at: index * 1_000, atMs: index * 1_000, sourceMessageId: `message-${index}`, gameId };
}

function snapshot(index: number, options: {
  gameId?: string;
  phase?: ReplayPhase;
  turnNumber?: number;
  selfScore?: number;
  opponentScore?: number;
} = {}): ReplaySnapshotEvent {
  const currentPhase = options.phase ?? "in_game";
  return {
    ...base(index, options.gameId), kind: "snapshot",
    snapshot: {
      room: {
        phase: currentPhase, rawPhase: currentPhase, gameNumber: 1, fields: {},
        ...(options.turnNumber !== undefined ? { turnNumber: options.turnNumber } : {}),
      },
      players: {
        self: { id: "self", name: "Player", score: options.selfScore ?? 0, fields: {}, boardFields: {}, zones: {} },
        opponent: { id: "opponent", name: "Opponent", score: options.opponentScore ?? 0, fields: {}, boardFields: {}, zones: {} },
      },
      chain: [], log: [],
    },
  };
}

function phase(index: number, nextPhase: ReplayPhase, gameId = "game-1"): ReplayPhaseEvent {
  return { ...base(index, gameId), kind: "phase", phase: nextPhase, rawPhase: nextPhase, gameNumber: 1 };
}

function boundary(index: number, kind: "start" | "end", gameId = "game-1"): ReplayGameBoundaryEvent {
  const gameNumber = Number(gameId.split("-")[1]);
  return {
    ...base(index, gameId), kind: "game_boundary", boundary: kind, gameOrdinal: gameNumber, gameNumber,
    reason: kind === "end" ? "explicit_result" : "explicit_game_number",
  };
}

function action(index: number, room: JsonObject = {}, scores: Record<string, number> = {}, gameId = "game-1"): ReplayActionEvent {
  return {
    ...base(index, gameId), kind: "action", actionType: "authoritative_patch", action: {},
    confirmation: {
      status: "confirmed", authority: "authoritative_patch_commit", correlation: "intent_not_observed", commitMessageId: `message-${index}`,
    },
    patch: {
      operations: [
        ...(Object.keys(room).length ? [{ id: `room-${index}`, op: "set_room_fields" as const, fields: room }] : []),
        ...Object.entries(scores).map(([playerId, score]) => ({
          id: `score-${index}-${playerId}`, op: "set_board_fields" as const, playerId, fields: { score },
        })),
      ],
    },
  };
}
