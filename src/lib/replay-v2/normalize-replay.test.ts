import { describe, expect, it } from "vitest";

import {
  syntheticBo3Capture,
  syntheticTerminalScoreCapture,
} from "@/lib/replay-v2/__fixtures__/synthetic-captures";
import { normalizeRawCaptureV1 } from "@/lib/replay-v2/normalize-replay";

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
});
