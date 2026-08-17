import { describe, expect, it } from "vitest";

import type { CanonicalReplayV2 } from "@/lib/replay-v2";

import { anonymizeReplayPlayerNames } from "./player-anonymization";

function replayFixture(): CanonicalReplayV2 {
  const player = (id: string, name: string) => ({
    id,
    name,
    fields: { displayName: name },
    boardFields: {},
    zones: {
      hand: [{ id: `${id}-card`, name: "Alice", fields: { ownerLabel: name } }],
    },
  });
  const state = {
    seriesId: "series-1",
    gameId: "game-1",
    gameOrdinal: 1,
    phase: "in_game" as const,
    room: { phase: "in_game" as const, rawPhase: "IN_GAME", gameNumber: 1, fields: {} },
    players: { alice: player("alice", "Alice"), bob: player("bob", "Bob") },
    chain: [],
    log: [{ id: "log-1", text: "Alice played a card against Bob", fields: {} }],
    chat: [{ id: "chat-1", author: "Alice", text: "Hello Bob", fields: {} }],
    appliedEventIndex: 0,
  };
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: "replay-1",
    source: { schema: "riftreplay-raw-capture", version: 1, captureSessionId: "capture-1", roomCode: "ROOM", startedAt: 1, endedAt: 2, messageCount: 1 },
    series: {
      id: "series-1",
      format: "bo1",
      bestOf: 1,
      roomCode: "ROOM",
      startedAt: 1,
      endedAt: 2,
      participants: [
        { id: "alice", name: "Alice", isPerspective: true, fields: {} },
        { id: "bob", name: "Bob", isPerspective: false, fields: {} },
      ],
      games: [],
    },
    events: [{ id: "event-1", index: 0, at: 1, atMs: 0, sourceMessageId: "message-1", gameId: "game-1", kind: "snapshot", snapshot: state }],
    unknownEvents: [],
    diagnostics: [{ id: "diagnostic-1", severity: "info", code: "test", message: "Alice joined Bob" }],
    checkpoints: [{ id: "checkpoint-1", eventIndex: 0, atMs: 0, stateHash: "hash", state }],
  };
}

describe("anonymizeReplayPlayerNames", () => {
  it("replaces participant, board, chat, log, and diagnostic display names without mutating the source", () => {
    const source = replayFixture();
    const anonymized = anonymizeReplayPlayerNames(source);

    expect(anonymized.series.participants.map((participant) => participant.name)).toEqual(["Player 1", "Player 2"]);
    expect(anonymized.checkpoints[0]?.state.players.alice?.name).toBe("Player 1");
    expect(anonymized.checkpoints[0]?.state.chat[0]).toMatchObject({ author: "Player 1", text: "Hello Player 2" });
    expect(anonymized.checkpoints[0]?.state.log[0]?.text).toBe("Player 1 played a card against Player 2");
    expect(anonymized.diagnostics[0]?.message).toBe("Player 1 joined Player 2");
    expect(source.series.participants[0]?.name).toBe("Alice");
  });

  it("does not rename a card whose printed name happens to match a player", () => {
    const anonymized = anonymizeReplayPlayerNames(replayFixture());
    expect(anonymized.checkpoints[0]?.state.players.alice?.zones.hand?.[0]?.name).toBe("Alice");
  });

  it("does not replace a player name embedded inside an unrelated word", () => {
    const source = replayFixture();
    source.diagnostics[0]!.message = "Bobby challenged Bob";
    expect(anonymizeReplayPlayerNames(source).diagnostics[0]?.message).toBe("Bobby challenged Player 2");
  });
});
