import { describe, expect, it } from "vitest";

import type {
  CanonicalReplayV2,
  ReplayActionEvent,
  ReplayGameBoundaryEvent,
  ReplaySnapshotEvent,
} from "@/lib/replay-v2";

import { replayScoreTimelineMarkers } from "./timeline-score-markers";

describe("replay score timeline markers", () => {
  it("maps authoritative player and opponent score increases to exact timeline tags", () => {
    const replay = scoreReplay([
      gameStart(0, "game-1"),
      scoreSnapshot(1, "game-1", 0, 0, 0),
      scoreAction(2, "game-1", 10_000, "self", 1),
      scoreAction(3, "game-1", 20_000, "opponent", 1),
    ]);

    expect(replayScoreTimelineMarkers(replay)).toEqual([
      expect.objectContaining({
        atMs: 10_000,
        eventIndex: 2,
        gameId: "game-1",
        playerId: "self",
        score: 1,
        scoreLabel: "1\u20130",
        side: "player",
      }),
      expect.objectContaining({
        atMs: 20_000,
        eventIndex: 3,
        gameId: "game-1",
        playerId: "opponent",
        score: 1,
        scoreLabel: "1\u20131",
        side: "opponent",
      }),
    ]);
  });

  it("derives a TCGA-style snapshot increase after the initial score baseline", () => {
    const replay = scoreReplay([
      gameStart(0, "game-1"),
      scoreSnapshot(1, "game-1", 0, 0, 0),
      scoreSnapshot(2, "game-1", 15_500, 0, 1),
    ]);

    expect(replayScoreTimelineMarkers(replay)).toEqual([
      expect.objectContaining({
        atMs: 15_500,
        eventIndex: 2,
        playerId: "opponent",
        scoreLabel: "0\u20131",
        side: "opponent",
      }),
    ]);
  });

  it("suppresses initial syncs, resets, corrections, and simultaneous changes", () => {
    const replay = scoreReplay([
      gameStart(0, "game-1"),
      scoreSnapshot(1, "game-1", 0, 3, 2),
      scoreSnapshot(2, "game-1", 5_000, 4, 3),
      scoreSnapshot(3, "game-1", 8_000, 3, 3),
      gameStart(4, "game-2", 10_000, 2),
      scoreSnapshot(5, "game-2", 10_100, 0, 0),
      scoreAction(6, "game-2", 12_000, "self", 1, "opponent", 1),
    ]);

    expect(replayScoreTimelineMarkers(replay)).toEqual([]);
  });

  it("does not infer a tag when a snapshot introduces an incomplete baseline", () => {
    const replay = scoreReplay([
      gameStart(0, "game-1"),
      partialScoreSnapshot(1, "game-1", 0, 0),
      scoreSnapshot(2, "game-1", 3_000, 1, 0),
    ]);

    expect(replayScoreTimelineMarkers(replay)).toEqual([]);
  });

  it("does not emit an opponent tag while the perspective score baseline is missing", () => {
    const replay = scoreReplay([
      gameStart(0, "game-1"),
      opponentOnlyScoreSnapshot(1, "game-1", 0, 0),
      scoreAction(2, "game-1", 3_000, "opponent", 1),
    ]);

    expect(replayScoreTimelineMarkers(replay)).toEqual([]);
  });

  it("starts a fresh score baseline at each game boundary", () => {
    const replay = scoreReplay([
      gameStart(0, "game-1"),
      scoreSnapshot(1, "game-1", 0, 7, 5),
      gameStart(2, "game-2", 10_000, 2),
      scoreAction(3, "game-2", 12_000, "self", 1),
      scoreAction(4, "game-2", 14_000, "opponent", 1),
      scoreAction(5, "game-2", 16_000, "self", 2),
    ]);

    expect(replayScoreTimelineMarkers(replay)).toEqual([
      expect.objectContaining({
        atMs: 16_000,
        gameId: "game-2",
        playerId: "self",
        scoreLabel: "2\u20131",
        side: "player",
      }),
    ]);
  });

  it("does not let a score event without game identity contaminate a known game", () => {
    const ambiguous = scoreAction(2, "game-1", 4_000, "opponent", 4);
    ambiguous.gameId = null;
    const replay = scoreReplay([
      gameStart(0, "game-1"),
      scoreSnapshot(1, "game-1", 0, 0, 0),
      ambiguous,
      scoreAction(3, "game-1", 6_000, "self", 1),
    ]);

    expect(replayScoreTimelineMarkers(replay)).toEqual([
      expect.objectContaining({
        atMs: 6_000,
        gameId: "game-1",
        playerId: "self",
        scoreLabel: "1\u20130",
      }),
    ]);
  });
});

function scoreReplay(events: CanonicalReplayV2["events"]): CanonicalReplayV2 {
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: "score-replay",
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: "score-capture",
      roomCode: "SCORE",
      startedAt: 1_000,
      endedAt: 61_000,
      messageCount: events.length,
    },
    series: {
      id: "score-series",
      perspectivePlayerId: "self",
      format: "bo3",
      bestOf: 3,
      roomCode: "SCORE",
      startedAt: 1_000,
      endedAt: 61_000,
      participants: [
        { id: "self", name: "Player", isPerspective: true, fields: {} },
        { id: "opponent", name: "Opponent", isPerspective: false, fields: {} },
      ],
      games: [],
    },
    events,
    unknownEvents: [],
    diagnostics: [],
    checkpoints: [],
  };
}

function gameStart(
  index: number,
  gameId: string,
  atMs = 0,
  gameNumber = 1,
): ReplayGameBoundaryEvent {
  return {
    id: `boundary-${gameId}`,
    index,
    at: 1_000 + atMs,
    atMs,
    sourceMessageId: `message-${index}`,
    gameId,
    kind: "game_boundary",
    boundary: "start",
    gameOrdinal: gameNumber,
    gameNumber,
    reason: gameNumber === 1 ? "series_start" : "explicit_game_number",
  };
}

function scoreAction(
  index: number,
  gameId: string,
  atMs: number,
  playerId: string,
  score: number,
  secondPlayerId?: string,
  secondScore?: number,
): ReplayActionEvent {
  return {
    id: `score-action-${index}`,
    index,
    at: 1_000 + atMs,
    atMs,
    sourceMessageId: `message-${index}`,
    gameId,
    kind: "action",
    actionType: "battlefield_conquer_confirm",
    actorPlayerId: playerId,
    action: { type: "battlefield_conquer_confirm" },
    confirmation: {
      status: "confirmed",
      authority: "authoritative_patch_commit",
      correlation: "intent_not_observed",
      commitMessageId: `message-${index}`,
    },
    patch: {
      operations: [
        { id: `score-op-${index}`, op: "set_board_fields", playerId, fields: { score } },
        ...(secondPlayerId && secondScore !== undefined ? [{
          id: `score-op-${index}-second`,
          op: "set_board_fields" as const,
          playerId: secondPlayerId,
          fields: { score: secondScore },
        }] : []),
      ],
    },
  };
}

function scoreSnapshot(
  index: number,
  gameId: string,
  atMs: number,
  selfScore: number,
  opponentScore: number,
): ReplaySnapshotEvent {
  return snapshot(index, gameId, atMs, {
    self: player("self", "Player", selfScore),
    opponent: player("opponent", "Opponent", opponentScore),
  });
}

function partialScoreSnapshot(
  index: number,
  gameId: string,
  atMs: number,
  selfScore: number,
): ReplaySnapshotEvent {
  return snapshot(index, gameId, atMs, {
    self: player("self", "Player", selfScore),
    opponent: {
      id: "opponent",
      name: "Opponent",
      fields: {},
      boardFields: {},
      zones: {},
    },
  });
}

function opponentOnlyScoreSnapshot(
  index: number,
  gameId: string,
  atMs: number,
  opponentScore: number,
): ReplaySnapshotEvent {
  return snapshot(index, gameId, atMs, {
    self: {
      id: "self",
      name: "Player",
      fields: {},
      boardFields: {},
      zones: {},
    },
    opponent: player("opponent", "Opponent", opponentScore),
  });
}

function snapshot(
  index: number,
  gameId: string,
  atMs: number,
  players: ReplaySnapshotEvent["snapshot"]["players"],
): ReplaySnapshotEvent {
  return {
    id: `snapshot-${index}`,
    index,
    at: 1_000 + atMs,
    atMs,
    sourceMessageId: `message-${index}`,
    gameId,
    kind: "snapshot",
    snapshot: {
      room: {
        phase: "in_game",
        rawPhase: "in_game",
        gameNumber: 1,
        fields: {},
      },
      players,
      chain: [],
      log: [],
    },
  };
}

function player(id: string, name: string, score: number) {
  return { id, name, score, fields: {}, boardFields: { score }, zones: {} };
}
