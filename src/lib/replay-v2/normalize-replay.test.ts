import { describe, expect, it } from "vitest";

import {
  syntheticBo3Capture,
  syntheticTerminalScoreCapture,
} from "@/lib/replay-v2/__fixtures__/synthetic-captures";
import { normalizeRawCaptureV1 } from "@/lib/replay-v2/normalize-replay";
import type { RawCaptureV1 } from "@/lib/replay-v2/types";

describe("normalizeRawCaptureV1", () => {
  it("builds a deterministic, explicit BO3 series without collapsing equal results", () => {
    const first = normalizeRawCaptureV1(syntheticBo3Capture(), { checkpoints: { everyEvents: 2 } });
    const second = normalizeRawCaptureV1(syntheticBo3Capture(), { checkpoints: { everyEvents: 2 } });

    expect(second).toEqual(first);
    expect(first.series.format).toBe("bo3");
    expect(first.series.bestOf).toBe(3);
    expect(first.series.games).toHaveLength(3);
    expect(first.series.games.map((game) => game.gameNumber)).toEqual([1, 2, 3]);
    expect(first.series.games[0].result?.winnerPlayerId).toBe("player-local");
    expect(first.series.games[1].result?.winnerPlayerId).toBe("player-local");
    expect(first.series.games[0].result?.finalScores).toEqual({
      "player-local": 7,
      "player-opponent": 5,
    });
    expect(first.series.games[1].result?.finalScores).toEqual(first.series.games[0].result?.finalScores);
    expect(first.series.games[0].sourceIdentity.resultEventId).not.toBe(
      first.series.games[1].sourceIdentity.resultEventId,
    );
  });

  it("marks and orders the capture perspective independently of seat order", () => {
    const replay = normalizeRawCaptureV1(syntheticBo3Capture());

    expect(replay.series.perspectivePlayerId).toBe("player-local");
    expect(replay.series.participants[0]).toMatchObject({
      id: "player-local",
      seat: 1,
      isPerspective: true,
    });
    expect(replay.series.participants[1]).toMatchObject({
      id: "player-opponent",
      seat: 0,
      isPerspective: false,
    });
  });

  it("correlates only authoritative commits and preserves unconfirmed intents diagnostically", () => {
    const replay = normalizeRawCaptureV1(syntheticBo3Capture());
    const move = replay.events.find(
      (event) => event.kind === "action" && event.actionType === "move_card",
    );

    expect(move?.kind).toBe("action");
    if (move?.kind !== "action") throw new Error("Expected move action");
    expect(move.confirmation).toMatchObject({
      status: "confirmed",
      correlation: "matched_intent",
      clientActionId: "client-action-1",
    });
    expect(move.confirmation.intentMessageId).toBeTruthy();
    expect(replay.unknownEvents.some((event) => event.reason === "unconfirmed_intent")).toBe(true);
    expect(replay.diagnostics.some((entry) => entry.code === "unconfirmed_intent")).toBe(true);
  });

  it("rebases playback to setup, compacts ephemeral presence, and keeps semantic right-rail events", () => {
    const replay = normalizeRawCaptureV1(syntheticBo3Capture());
    const firstGameStart = replay.events.find(
      (event) => event.kind === "game_boundary" && event.boundary === "start",
    );

    expect(replay.source.startedAt).toBe(1_000_000);
    expect(firstGameStart?.at).toBe(1_030_000);
    expect(firstGameStart?.atMs).toBe(0);
    expect(replay.events.some((event) => event.kind === "interaction" && event.interactionType === "card_ping")).toBe(true);
    expect(replay.events.some((event) => event.kind === "log" && event.mode === "replace")).toBe(true);
    expect(replay.unknownEvents.some((event) => event.packetType === "presence_update")).toBe(false);
    expect(replay.unknownEvents.some((event) => event.packetType === "presence_event")).toBe(false);
    expect(replay.diagnostics.some((entry) => entry.code === "compacted_ephemeral_packets")).toBe(true);
    expect(replay.unknownEvents).toHaveLength(3);
  });

  it("redacts credentials, raw text, remote hidden zones, and opponent sideboarding", () => {
    const replay = normalizeRawCaptureV1(syntheticBo3Capture());
    const serialized = JSON.stringify(replay);

    [
      "SYNTHETIC-TOP-SECRET-TOKEN",
      "SYNTHETIC-UNKNOWN-SECRET",
      "SYNTHETIC-API-KEY",
      "SYNTHETIC-MALFORMED-SECRET",
      "raw payload must not survive",
      "Opponent Secret Hand Card",
      "Opponent Secret Deck Card",
      "Opponent Hidden Main Card",
      "Opponent Hidden Sideboard Card",
      "Opponent deck must not survive",
      "Opponent shell secret",
      "Opponent Mystery Hand Card",
    ].forEach((secret) => expect(serialized).not.toContain(secret));

    const snapshot = replay.events.find((event) => event.kind === "snapshot");
    expect(snapshot?.kind).toBe("snapshot");
    if (snapshot?.kind !== "snapshot") throw new Error("Expected snapshot");
    const opponent = snapshot.snapshot.players["player-opponent"];
    expect(opponent.zones.hand[0]).toMatchObject({ name: "", isPlaceholder: true });
    expect(opponent.zones.hand[0].cardCode).toBeUndefined();
    expect(opponent.zones.deck[0]).toMatchObject({ name: "", isPlaceholder: true });

    const unknownStateful = replay.unknownEvents.find((event) => event.packetType === "mystery_stateful_packet");
    expect(unknownStateful?.payload).toMatchObject({ type: "mystery_stateful_packet", stateMarker: "preserve-me" });
  });

  it("fails closed for every hidden zone when the capture perspective cannot be identified", () => {
    const capture = syntheticBo3Capture();
    capture.messages = capture.messages.map((message) => {
      if (typeof message.raw !== "string") return message;
      try {
        const payload = JSON.parse(message.raw) as Record<string, unknown>;
        const sessionDoc = payload.sessionDoc && typeof payload.sessionDoc === "object"
          ? payload.sessionDoc as Record<string, unknown>
          : null;
        if (sessionDoc) {
          delete sessionDoc.viewer;
          if (sessionDoc.selfPlayer && typeof sessionDoc.selfPlayer === "object") {
            delete (sessionDoc.selfPlayer as Record<string, unknown>).id;
          }
        }
        return { ...message, raw: JSON.stringify(payload) };
      } catch {
        return message;
      }
    });

    const replay = normalizeRawCaptureV1(capture);
    const serialized = JSON.stringify(replay);
    expect(replay.series.perspectivePlayerId).toBeFalsy();
    expect(serialized).not.toContain("Local Hidden Card");
    expect(serialized).not.toContain("Opponent Secret Hand Card");
    expect(serialized).not.toContain("Opponent Secret Deck Card");
  });

  it("redacts hidden card and participant fields carried by authoritative patch operations", () => {
    const capture = syntheticBo3Capture();
    capture.messages.push({
      seq: 19,
      ts: 1_056_450,
      dir: "in",
      raw: JSON.stringify({
        type: "authoritative_patch_commit",
        gameInstanceId: "ROOM42",
        actorPlayerId: "player-opponent",
        sequence: 10,
        patch: {
          operations: [
            {
              op: "patch_card_fields",
              playerId: "player-opponent",
              zone: "hand",
              cardId: "opponent-hand-1",
              fields: { name: "PATCHED-HAND-SECRET", cardCode: "PATCH-999" },
            },
            {
              op: "set_player_fields",
              playerId: "player-opponent",
              fields: { hand: [{ name: "PLAYER-FIELD-SECRET" }], publicMarker: "kept" },
            },
            {
              op: "set_board_fields",
              playerId: "player-opponent",
              fields: { deck: [{ name: "BOARD-FIELD-SECRET" }], score: 8 },
            },
            {
              op: "set_room_fields",
              fields: { players: [{ hand: [{ name: "ROOM-FIELD-SECRET" }] }], turnNumber: 3 },
            },
          ],
        },
      }),
    });

    const replay = normalizeRawCaptureV1(capture);
    const serialized = JSON.stringify(replay);
    [
      "PATCHED-HAND-SECRET",
      "PATCH-999",
      "PLAYER-FIELD-SECRET",
      "BOARD-FIELD-SECRET",
      "ROOM-FIELD-SECRET",
    ].forEach((secret) => expect(serialized).not.toContain(secret));
    expect(serialized).toContain("publicMarker");
  });

  it("derives only rules-safe terminal-score results and never infers from who is merely ahead", () => {
    const safe = normalizeRawCaptureV1(syntheticTerminalScoreCapture(8));
    const unsafe = normalizeRawCaptureV1(syntheticTerminalScoreCapture(7));

    expect(safe.series.games).toHaveLength(1);
    expect(safe.series.games[0].result).toMatchObject({
      winnerPlayerId: "player-local",
      finalScores: { "player-local": 8, "player-opponent": 0 },
    });
    expect(safe.diagnostics.some((entry) => entry.code === "derived_terminal_score")).toBe(true);

    expect(unsafe.series.games).toHaveLength(1);
    expect(unsafe.series.games[0].result).toBeUndefined();
    expect(unsafe.diagnostics.some((entry) => entry.code === "terminal_result_unknown")).toBe(true);
  });

  it("uses a reviewed single-game BO1 result over an Atlas room's BO3 default", () => {
    const capture = syntheticTerminalScoreCapture(7);
    if (!capture.capture) throw new Error("Expected capture metadata");
    capture.capture.lifecycle = {
      ...(capture.capture.lifecycle ?? {}),
      matchFormat: "bo3",
    };
    capture.capture.match = {
      format: "bo1",
      result: "win",
      score: { perspective: 1, opponent: 0 },
      games: [{
        gameNumber: 1,
        result: "win",
        perspectivePoints: 7,
        opponentPoints: 5,
      }],
    };
    capture.messages = capture.messages.map((message) => {
      if (typeof message.raw !== "string") return message;
      const payload = JSON.parse(message.raw) as Record<string, unknown>;
      if (payload.sessionDoc && typeof payload.sessionDoc === "object") {
        payload.sessionDoc = {
          ...(payload.sessionDoc as Record<string, unknown>),
          matchFormat: "bo3",
        };
      }
      return { ...message, raw: JSON.stringify(payload) };
    });

    const replay = normalizeRawCaptureV1(capture);

    expect(replay.series.format).toBe("bo1");
    expect(replay.series.bestOf).toBe(1);
    expect(replay.series.games).toHaveLength(1);
    expect(replay.series.games[0].result).toMatchObject({
      winnerPlayerId: "player-local",
      loserPlayerId: "player-opponent",
      finalScores: { "player-local": 7, "player-opponent": 5 },
    });
    expect(replay.series.result).toMatchObject({
      source: "desktop_match_metadata",
      outcome: "win",
      finalScores: { "player-local": 1, "player-opponent": 0 },
    });
    expect(replay.diagnostics).toContainEqual(expect.objectContaining({
      code: "desktop_match_format_override",
      severity: "info",
    }));
    expect(replay.diagnostics.some(
      (entry) => entry.code === "desktop_match_metadata_unmatched",
    )).toBe(false);
  });

  it("fills a desktop-confirmed 0-2 BO3 without embedding player identifiers in the metadata", () => {
    const replay = normalizeRawCaptureV1(desktopResultBo3Capture());

    expect(replay.series.format).toBe("bo3");
    expect(replay.series.games).toHaveLength(2);
    expect(replay.series.games.map((game) => game.result)).toEqual([
      expect.objectContaining({
        winnerPlayerId: "player-opponent",
        loserPlayerId: "player-local",
        finalScores: { "player-local": 5, "player-opponent": 8 },
      }),
      expect.objectContaining({
        winnerPlayerId: "player-opponent",
        loserPlayerId: "player-local",
        finalScores: { "player-local": 4, "player-opponent": 5 },
      }),
    ]);
    expect(replay.series.games.every((game) => (
      game.sourceIdentity.resultEventId === game.result?.resultEventId
    ))).toBe(true);
    expect(replay.series.result).toMatchObject({
      source: "desktop_match_metadata",
      outcome: "loss",
      winnerPlayerId: "player-opponent",
      loserPlayerId: "player-local",
      finalScores: { "player-local": 0, "player-opponent": 2 },
    });
    expect(replay.diagnostics.filter((entry) => entry.code === "desktop_match_result_applied")).toHaveLength(2);
    expect(replay.diagnostics.some((entry) => entry.code === "terminal_result_unknown")).toBe(false);
  });

  it("treats later game numbers and completed desktop metadata as BO3 evidence over per-game BO1 labels", () => {
    const capture = desktopResultBo3Capture();
    capture.messages = capture.messages.map((message) => {
      const payload = JSON.parse(String(message.raw)) as Record<string, unknown>;
      if (payload.sessionDoc && typeof payload.sessionDoc === "object") {
        payload.sessionDoc = { ...(payload.sessionDoc as Record<string, unknown>), matchFormat: "bo1" };
      }
      if (payload.snapshot && typeof payload.snapshot === "object") {
        payload.snapshot = { ...(payload.snapshot as Record<string, unknown>), matchFormat: "bo1" };
      }
      return { ...message, raw: JSON.stringify(payload) };
    });

    const replay = normalizeRawCaptureV1(capture);

    expect(replay.series.format).toBe("bo3");
    expect(replay.series.games.map((game) => game.gameNumber)).toEqual([1, 2]);
    expect(replay.series.result?.finalScores).toEqual({
      "player-local": 0,
      "player-opponent": 2,
    });
    expect(replay.diagnostics.some((entry) => entry.code === "desktop_match_metadata_unmatched")).toBe(false);
  });

  it("does not create a duplicate game when postgame setup repeats the current explicit game number", () => {
    const capture = desktopResultBo3Capture();
    capture.messages.splice(capture.messages.length - 1, 0, rawMessage(4, 2_150, {
      type: "room_shell_sync",
      gameInstanceId: "GAME-2",
      sessionDoc: matchSessionDoc(2, "sideboarding"),
    }));

    const replay = normalizeRawCaptureV1(capture);

    expect(replay.series.games.map((game) => game.gameNumber)).toEqual([1, 2]);
    expect(replay.diagnostics.some((entry) => entry.code === "desktop_match_metadata_ambiguous")).toBe(false);
  });

  it("ignores a stale same-game setup phase after authoritative gameplay begins", () => {
    const capture = desktopResultBo3Capture();
    capture.messages = [
      capture.messages[0],
      capture.messages[1],
      rawMessage(2, 1_150, {
        type: "room_shell_sync",
        gameInstanceId: "GAME-1",
        sessionDoc: matchSessionDoc(1, "battlefield_pick"),
      }),
      ...capture.messages.slice(2).map((message) => ({
        ...message,
        seq: Number(message.seq) + 1,
      })),
    ];

    const replay = normalizeRawCaptureV1(capture);
    const firstGame = replay.series.games[0];

    expect(firstGame.phases.map((phase) => phase.phase)).toEqual([
      "battlefield_pick",
      "in_game",
    ]);
    expect(replay.events.filter((event) => (
      event.kind === "phase" &&
      event.gameId === firstGame.id &&
      event.phase === "battlefield_pick"
    ))).toHaveLength(1);
    expect(replay.diagnostics).toContainEqual(expect.objectContaining({
      code: "stale_same_game_setup_phase",
      severity: "warning",
    }));
  });

  it("keeps raw-derived results authoritative over conflicting desktop metadata", () => {
    const capture = desktopResultBo3Capture();
    capture.messages.splice(capture.messages.length - 1, 0, {
      seq: 4,
      ts: 2_190,
      dir: "in",
      raw: JSON.stringify({
        type: "authoritative_patch_commit",
        gameInstanceId: "GAME-2",
        action: {
          type: "game_result",
          winnerPlayerId: "player-local",
          loserPlayerId: "player-opponent",
          finalScores: { "player-local": 8, "player-opponent": 5 },
        },
        patch: { operations: [] },
      }),
    });

    const replay = normalizeRawCaptureV1(capture);

    expect(replay.series.games[1].result).toMatchObject({
      winnerPlayerId: "player-local",
      loserPlayerId: "player-opponent",
      finalScores: { "player-local": 8, "player-opponent": 5 },
    });
    expect(replay.diagnostics).toContainEqual(expect.objectContaining({
      code: "desktop_match_result_ignored",
      severity: "info",
    }));
  });

  it("diagnoses duplicate and unmatched desktop game metadata instead of guessing", () => {
    const capture = desktopResultBo3Capture();
    if (!capture.capture?.match) throw new Error("Expected match metadata");
    capture.capture.match.games = [
      { gameNumber: 1, result: "loss", perspectivePoints: 5, opponentPoints: 8 },
      { gameNumber: 1, result: "win", perspectivePoints: 8, opponentPoints: 5 },
      { gameNumber: 3, result: "loss", perspectivePoints: 4, opponentPoints: 8 },
    ];

    const replay = normalizeRawCaptureV1(capture);

    expect(replay.series.games.every((game) => game.result === undefined)).toBe(true);
    expect(replay.diagnostics).toContainEqual(expect.objectContaining({
      code: "desktop_match_metadata_ambiguous",
      severity: "warning",
    }));
    expect(replay.diagnostics).toContainEqual(expect.objectContaining({
      code: "desktop_match_game_unmatched",
      severity: "warning",
    }));
  });

  it("preserves the pre-metadata normalization behaviour for older captures", () => {
    const capture = desktopResultBo3Capture();
    if (capture.capture) delete capture.capture.match;

    const replay = normalizeRawCaptureV1(capture);

    expect(replay.series.games).toHaveLength(2);
    expect(replay.series.games.every((game) => game.result === undefined)).toBe(true);
    expect(replay.diagnostics.some((entry) => entry.code === "desktop_match_result_applied")).toBe(false);
    expect(replay.diagnostics.some((entry) => entry.code === "terminal_result_unknown")).toBe(true);
  });
});

function desktopResultBo3Capture(): RawCaptureV1 {
  return {
    schema: "riftreplay-raw-capture",
    version: 1,
    capture: {
      captureSessionId: "desktop-result-capture",
      identity: {
        seriesId: "desktop-result-series",
        firstSeenAt: 1_000,
        lastSeenAt: 2_200,
      },
      lifecycle: {
        boundaries: [{ at: 2_200, reason: "end-of-match" }],
      },
      match: {
        format: "bo3",
        result: "loss",
        score: { perspective: 0, opponent: 2 },
        games: [
          { gameNumber: 1, result: "loss", perspectivePoints: 5, opponentPoints: 8 },
          { gameNumber: 2, result: "loss", perspectivePoints: 4, opponentPoints: 5 },
        ],
      },
    },
    messages: [
      rawMessage(0, 1_000, {
        type: "room_shell_sync",
        gameInstanceId: "GAME-1",
        sessionDoc: matchSessionDoc(1, "battlefield_pick"),
      }),
      rawMessage(1, 1_100, {
        type: "authoritative_snapshot",
        gameInstanceId: "GAME-1",
        snapshot: gameSnapshot(1, 5, 8),
      }),
      rawMessage(2, 2_000, {
        type: "room_shell_sync",
        gameInstanceId: "GAME-2",
        sessionDoc: matchSessionDoc(2, "sideboarding"),
      }),
      rawMessage(3, 2_100, {
        type: "authoritative_snapshot",
        gameInstanceId: "GAME-2",
        snapshot: gameSnapshot(2, 4, 5),
      }),
      rawMessage(5, 2_200, {
        type: "room_shell_leave",
        gameInstanceId: "GAME-2",
      }),
    ],
  };
}

function rawMessage(seq: number, ts: number, payload: Record<string, unknown>) {
  return { seq, ts, dir: "in", raw: JSON.stringify(payload) };
}

function matchSessionDoc(gameNumber: number, phase: string) {
  return {
    matchFormat: "bo3",
    seriesId: "desktop-result-series",
    gameNumber,
    phase,
    viewer: { role: "player", playerId: "player-local" },
    selfPlayer: { id: "player-local", seat: 0, name: "Local" },
    publicPlayers: [{ id: "player-opponent", seat: 1, name: "Opponent" }],
  };
}

function gameSnapshot(gameNumber: number, perspectivePoints: number, opponentPoints: number) {
  return {
    matchFormat: "bo3",
    gameNumber,
    phase: "in_game",
    players: [
      { id: "player-local", seat: 0, name: "Local", board: { score: perspectivePoints } },
      { id: "player-opponent", seat: 1, name: "Opponent", board: { score: opponentPoints } },
    ],
  };
}
