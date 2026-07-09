import type { JsonObject, RawCaptureMessageV1, RawCaptureV1 } from "@/lib/replay-v2/types";

const START = 1_000_000;

export function syntheticBo3Capture(): RawCaptureV1 {
  const messages: RawCaptureMessageV1[] = [
    packet(0, START, "out", {
      type: "search",
      authToken: "SYNTHETIC-TOP-SECRET-TOKEN",
      decklist: "Synthetic private deck text",
      matchFormat: "bo3",
    }),
    packet(1, START + 30_000, "in", roomShell("matchup", 1, "bo3")),
    packet(2, START + 31_000, "in", snapshotPacket(1, 0, 0)),
    packet(3, START + 32_000, "out", {
      type: "action_intent",
      gameInstanceId: "ROOM42",
      actorPlayerId: "player-local",
      clientActionId: "client-action-1",
      action: { type: "move_card", cardId: "local-card", fromZone: "hand", toZone: "base" },
    }),
    packet(4, START + 32_120, "in", {
      type: "authoritative_patch_commit",
      gameInstanceId: "ROOM42",
      baseSequence: 1,
      sequence: 2,
      clientActionId: "client-action-1",
      action: { type: "move_card", cardId: "local-card", fromZone: "hand", toZone: "base" },
      patch: {
        operations: [{
          op: "zone_move",
          cardId: "local-card",
          from: { playerId: "player-local", zone: "hand" },
          to: { playerId: "player-local", zone: "base", index: 0 },
          card: visibleCard("local-card", "Local Vanguard", "SYN-001", "player-local", "hand"),
        }],
      },
    }),
    packet(5, START + 32_500, "out", {
      type: "action_intent",
      gameInstanceId: "ROOM42",
      actorPlayerId: "player-local",
      clientActionId: "never-confirmed",
      action: { type: "toggle_exhausted", cardId: "local-card" },
    }),
    packet(6, START + 35_000, "in", resultCommit(1, "player-local", 7, 5, 3)),
    packet(7, START + 40_000, "in", {
      type: "authoritative_patch_commit",
      gameInstanceId: "ROOM42",
      baseSequence: 3,
      sequence: 4,
      actorPlayerId: "player-opponent",
      clientActionId: "remote-sideboard",
      action: {
        type: "submit_sideboard",
        mainDeck: [{ name: "Opponent Hidden Main Card", cardCode: "SYN-900" }],
        sideboard: [{ name: "Opponent Hidden Sideboard Card", cardCode: "SYN-901" }],
      },
      patch: { operations: [{ op: "set_room_fields", fields: { phase: "sideboarding", gameNumber: 2 } }] },
    }),
    packet(8, START + 41_000, "in", phaseCommit("in_game", 2, 5)),
    packet(9, START + 45_000, "in", resultCommit(2, "player-local", 7, 5, 6)),
    packet(10, START + 50_000, "in", phaseCommit("sideboarding", 3, 7)),
    packet(11, START + 51_000, "in", phaseCommit("in_game", 3, 8)),
    packet(12, START + 55_000, "in", resultCommit(3, "player-opponent", 6, 8, 9)),
    packet(13, START + 56_000, "in", {
      type: "presence_event",
      gameInstanceId: "ROOM42",
      event: { type: "card_ping", playerId: "player-opponent", pingedCardId: "public-card", pingIntent: "general" },
    }),
    packet(14, START + 56_100, "in", {
      type: "presence_event",
      gameInstanceId: "ROOM42",
      event: { type: "hover_state", playerId: "player-opponent", hoveredCardId: "public-card" },
    }),
    packet(15, START + 56_200, "out", {
      type: "presence_update",
      gameInstanceId: "ROOM42",
      hoveredCardId: "public-card",
    }),
    packet(16, START + 56_300, "in", {
      type: "setup_log_sync",
      gameInstanceId: "ROOM42",
      log: [{ id: "log-game-start", at: START + 51_000, text: "Game Start" }],
    }),
    packet(17, START + 56_400, "in", {
      type: "mystery_stateful_packet",
      authToken: "SYNTHETIC-UNKNOWN-SECRET",
      apiKey: "SYNTHETIC-API-KEY",
      raw: "raw payload must not survive",
      hand: [{ name: "Opponent Mystery Hand Card" }],
      stateMarker: "preserve-me",
    }),
    {
      seq: 18,
      ts: START + 56_500,
      dir: "in",
      raw: '{"type":"broken","authToken":"SYNTHETIC-MALFORMED-SECRET"',
    },
  ];

  return capture("synthetic-bo3", "bo3", messages, START + 56_500);
}

export function syntheticTerminalScoreCapture(score: number): RawCaptureV1 {
  const messages: RawCaptureMessageV1[] = [
    packet(0, START, "out", { type: "search", authToken: "SYNTHETIC-PREGAME-SECRET" }),
    packet(1, START + 30_000, "in", roomShell("matchup", 1, "bo1")),
    packet(2, START + 31_000, "in", snapshotPacket(1, 0, 0)),
    packet(3, START + 40_000, "in", {
      type: "authoritative_patch_commit",
      gameInstanceId: "ROOM42",
      baseSequence: 1,
      sequence: 2,
      action: { type: "battlefield_conquer_confirm" },
      patch: { operations: [{ op: "set_board_fields", playerId: "player-local", fields: { score } }] },
    }),
    packet(4, START + 41_000, "in", roomShell("sideboarding", 1, "bo1")),
    packet(5, START + 42_000, "out", { type: "room_shell_leave", gameInstanceId: "ROOM42" }),
  ];
  return capture(`synthetic-terminal-${score}`, "bo1", messages, START + 42_000);
}

function capture(id: string, matchFormat: string, messages: RawCaptureMessageV1[], endedAt: number): RawCaptureV1 {
  return {
    schema: "riftreplay-raw-capture",
    version: 1,
    capture: {
      captureSessionId: id,
      identity: { roomCode: "ROOM42", firstSeenAt: START, lastSeenAt: endedAt },
      lifecycle: {
        matchFormat,
        boundaries: [
          { at: START, reason: "session-start" },
          { at: endedAt, reason: "end-of-match" },
        ],
      },
    },
    messages,
  };
}

function roomShell(phase: string, gameNumber: number, matchFormat: string): JsonObject {
  return {
    type: "room_shell_sync",
    gameInstanceId: "ROOM42",
    sessionDoc: {
      roomCode: "ROOM42",
      matchFormat,
      phase,
      gameNumber,
      viewer: { role: "player", playerId: "player-local" },
      selfPlayer: {
        id: "player-local",
        seat: 1,
        name: "Perspective Player",
        decklistRaw: "Visible only to the perspective player",
      },
      publicPlayers: [{
        id: "player-opponent",
        seat: 0,
        name: "Opponent Player",
        decklistRaw: "Opponent deck must not survive",
        sideboard: [{ name: "Opponent shell secret" }],
      }],
    },
  };
}

function snapshotPacket(gameNumber: number, localScore: number, opponentScore: number): JsonObject {
  return {
    type: "authoritative_snapshot",
    gameInstanceId: "ROOM42",
    sequence: 1,
    snapshot: {
      roomCode: "ROOM42",
      phase: "in_game",
      gameNumber,
      players: [
        {
          id: "player-local",
          seat: 1,
          name: "Perspective Player",
          board: {
            score: localScore,
            hand: [visibleCard("local-card", "Local Vanguard", "SYN-001", "player-local", "hand")],
            deck: [{ id: "local-deck-1", name: "Local Hidden Card", cardCode: "SYN-002" }],
            base: [],
          },
        },
        {
          id: "player-opponent",
          seat: 0,
          name: "Opponent Player",
          board: {
            score: opponentScore,
            hand: [{ id: "opponent-hand-1", name: "Opponent Secret Hand Card", cardCode: "SYN-999" }],
            deck: [{ id: "opponent-deck-1", name: "Opponent Secret Deck Card", cardCode: "SYN-998" }],
            base: [],
          },
        },
      ],
      chainEntries: [],
      gameplayLog: [],
    },
  };
}

function resultCommit(
  gameNumber: number,
  winnerPlayerId: string,
  localScore: number,
  opponentScore: number,
  sequence: number,
): JsonObject {
  return {
    type: "authoritative_patch_commit",
    gameInstanceId: "ROOM42",
    baseSequence: sequence - 1,
    sequence,
    action: { type: "game_result", winnerPlayerId },
    patch: {
      operations: [{
        op: "set_room_fields",
        fields: {
          phase: "game_end",
          gameNumber,
          winnerPlayerId,
          scoresByPlayerId: {
            "player-local": localScore,
            "player-opponent": opponentScore,
          },
        },
      }],
    },
  };
}

function phaseCommit(phase: string, gameNumber: number, sequence: number): JsonObject {
  return {
    type: "authoritative_patch_commit",
    gameInstanceId: "ROOM42",
    baseSequence: sequence - 1,
    sequence,
    action: { type: "set_phase" },
    patch: { operations: [{ op: "set_room_fields", fields: { phase, gameNumber } }] },
  };
}

function visibleCard(
  id: string,
  name: string,
  cardCode: string,
  ownerPlayerId: string,
  source: string,
): JsonObject {
  return { id, name, cardCode, ownerPlayerId, source, exhausted: false, isPlaceholder: false };
}

function packet(seq: number, ts: number, dir: "in" | "out", payload: JsonObject): RawCaptureMessageV1 {
  return { seq, ts, dir, raw: JSON.stringify(payload) };
}
