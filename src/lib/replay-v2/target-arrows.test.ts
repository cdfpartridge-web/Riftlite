import { describe, expect, it } from "vitest";
import { normalizeRawCaptureV1 } from "@/lib/replay-v2/normalize-replay";
import { projectReplayState } from "@/lib/replay-v2/project-state";
import { seekReplay, seekReplayByEventIndex } from "@/lib/replay-v2/seek";
import { getReplayTargetArrows } from "@/lib/replay-v2/target-arrows";
import type { JsonObject, RawCaptureV1 } from "@/lib/replay-v2/types";

const arrow = (sourceCardId: string, targetCardId: string, sourceAnchor = "board", targetAnchor = "board") => ({
  sourceCardId, targetCardId, sourceAnchor, targetAnchor,
});
const bothPlayers = {
  local: [arrow("local-unit", "opponent-unit")],
  opponent: [arrow("opponent-unit", "local-unit")],
};

describe("captured player-drawn target arrows", () => {
  it("reads both players' arrows from existing canonical snapshots, distinct from chain targeting", () => {
    const replay = normalizeRawCaptureV1(capture([snapshot(bothPlayers)]));
    const state = projectReplayState(replay);
    const arrows = getReplayTargetArrows(state);
    expect(arrows.map(item => [item.actorPlayerId, item.sourceCardId, item.targetCardId]))
      .toEqual([["local", "local-unit", "opponent-unit"], ["opponent", "opponent-unit", "local-unit"]]);
    expect(arrows.every(item => item.sourceAnchor === "board" && item.targetAnchor === "board")).toBe(true);
    expect(getReplayTargetArrows(state)).toEqual(arrows);
  });

  it("preserves authoritative additions and removals across forward/backward seek without inventing expiry", () => {
    const replay = normalizeRawCaptureV1(capture([
      snapshot({}),
      commit("target_arrow_add", [{ op: "set_room_fields", fields: { targetArrowsByPlayer: bothPlayers } }]),
      { type: "chat_sync", chatEntries: [] },
      commit("target_arrow_clear_all", [{ op: "set_room_fields", fields: { targetArrowsByPlayer: { opponent: bothPlayers.opponent } } }]),
      commit("target_arrow_remove", [{ op: "unset_room_fields", fields: ["targetArrowsByPlayer"] }]),
    ], [0, 1_000, 90_000, 100_000, 110_000]), { checkpoints: { everyEvents: 2 } });
    const added = replay.events.findIndex(event => event.kind === "action" && event.actionType === "target_arrow_add");
    const cleared = replay.events.findIndex(event => event.kind === "action" && event.actionType === "target_arrow_clear_all");
    expect(getReplayTargetArrows(seekReplay(replay, 95_000).state)).toHaveLength(2);
    expect(getReplayTargetArrows(seekReplayByEventIndex(replay, cleared).state).map(item => item.actorPlayerId)).toEqual(["opponent"]);
    expect(getReplayTargetArrows(projectReplayState(replay))).toEqual([]);
    expect(getReplayTargetArrows(seekReplayByEventIndex(replay, added).state)).toHaveLength(2);
    for (const event of replay.events) {
      expect(seekReplayByEventIndex(replay, event.index).state).toEqual(projectReplayState(replay, event.index));
    }
  });

  it("does not apply an unconfirmed arrow intent", () => {
    const replay = normalizeRawCaptureV1(capture([
      snapshot(bothPlayers),
      { type: "action_intent", clientActionId: "not-confirmed", actorPlayerId: "local", action: { type: "target_arrow_clear_all" } },
    ]));
    expect(getReplayTargetArrows(projectReplayState(replay))).toHaveLength(2);
  });

  it("uses the correct board/chain instance and only supported marker endpoints", () => {
    const replay = normalizeRawCaptureV1(capture([snapshot({ local: [
      arrow("chain-card", "opponent-unit", "chain"),
      arrow("chain-entry", "opponent-unit", "chain"),
      arrow("chain-card", "opponent-unit", "board"),
      arrow("local-unit", "battlefield-marker:battlefieldA"),
      arrow("base-area-marker:local", "base-area-marker:opponent"),
      arrow("local-unit", "base-area-marker:unknown"),
      arrow("local-unit", "battlefield-marker:battlefieldToken"),
    ] })]));
    const state = projectReplayState(replay);
    expect(getReplayTargetArrows(state).map(item => item.sourceCardId)).toEqual(["chain-card", "local-unit", "base-area-marker:local"]);
    state.room.fields.sharedBattlefieldToken = { active: true, zone: "battlefieldToken", kind: "baron_pit" };
    expect(getReplayTargetArrows(state).at(-1)?.targetCardId).toBe("battlefield-marker:battlefieldToken");
    state.chain = [];
    expect(getReplayTargetArrows(state).some(item => item.sourceAnchor === "chain")).toBe(false);
  });

  it("rejects concealed, hidden-zone, stale, future-knowledge and malformed endpoints without exporting their fields", () => {
    const replay = normalizeRawCaptureV1(capture([snapshot({ local: [
      arrow("local-unit", "secret-hand"), arrow("local-unit", "hidden-unit"),
      arrow("local-unit", "future-unit"), arrow("local-unit", "missing-unit"),
      arrow("local-unit", "opponent-unit", "screen"), arrow("local-unit", "local-unit"),
      { ...arrow("local-unit", "opponent-unit"), privateCardName: "never return arbitrary fields" },
      arrow("local-unit", "opponent-unit"),
    ], unknown: [arrow("local-unit", "opponent-unit")] })]));
    const state = projectReplayState(replay);
    const result = getReplayTargetArrows(state);
    expect(result).toHaveLength(1);
    expect(Object.keys(result[0]).sort()).toEqual(["actorPlayerId", "id", "sourceAnchor", "sourceCardId", "targetAnchor", "targetCardId"]);
    expect(JSON.stringify(result)).not.toMatch(/secret|hidden|future|privateCardName/);
    state.players.opponent.zones.base = [];
    expect(getReplayTargetArrows(state)).toEqual([]);
  });

  it("clears BO3 arrows at the new game boundary and repairs old checkpoints without mutating them", () => {
    const replay = normalizeRawCaptureV1(capture([
      snapshot(bothPlayers),
      commit("game_result", [{ op: "set_room_fields", fields: { phase: "game_end", gameNumber: 1 } }]),
      commit("submit_sideboard", [{ op: "set_room_fields", fields: { phase: "sideboarding", gameNumber: 2, targetArrowsByPlayer: bothPlayers } }]),
      commit("start_game", [{ op: "set_room_fields", fields: { phase: "in_game", gameNumber: 2 } }]),
    ]), { checkpoints: { everyEvents: 1 } });
    const gameTwo = replay.series.games[1];
    expect(gameTwo).toBeDefined();
    const boundary = projectReplayState(replay, gameTwo.eventStartIndex);
    expect(boundary.room.fields).not.toHaveProperty("targetArrowsByPlayer");
    const current = [...replay.events].reverse().find(event => event.kind === "action" && event.actionType === "start_game")!;
    expect(projectReplayState(replay, current.index).room.fields).not.toHaveProperty("targetArrowsByPlayer");
    const checkpoint = replay.checkpoints.find(item => item.eventIndex === current.index)!;
    checkpoint.state.room.fields.targetArrowsByPlayer = bothPlayers;
    const before = JSON.stringify(checkpoint);
    let historyReads = 0;
    replay.events = new Proxy(replay.events, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) historyReads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    expect(getReplayTargetArrows(seekReplayByEventIndex(replay, current.index).state)).toEqual([]);
    const initialHistoryReads = historyReads;
    historyReads = 0;
    expect(getReplayTargetArrows(seekReplayByEventIndex(replay, current.index).state)).toEqual([]);
    expect(historyReads).toBeLessThan(initialHistoryReads);
    expect(JSON.stringify(checkpoint)).toBe(before);
    expect(getReplayTargetArrows(seekReplayByEventIndex(replay, gameTwo.eventStartIndex - 1).state)).toHaveLength(2);
  });

  it("retains game-two arrows set alongside a normalized gameplay phase transition in checkpoints", () => {
    const replay = normalizeRawCaptureV1(capture([
      snapshot(bothPlayers),
      commit("game_result", [{ op: "set_room_fields", fields: { phase: "game_end", gameNumber: 1 } }]),
      commit("submit_sideboard", [{ op: "set_room_fields", fields: { phase: "sideboarding", gameNumber: 2 } }]),
      commit("start_game", [{ op: "set_room_fields", fields: { phase: "gameplay", gameNumber: 2, targetArrowsByPlayer: { opponent: bothPlayers.opponent } } }]),
    ]), { checkpoints: { everyEvents: 1 } });
    expect(getReplayTargetArrows(seekReplayByEventIndex(replay, replay.events.length - 1).state).map(item => item.actorPlayerId))
      .toEqual(["opponent"]);
  });
});

function capture(payloads: JsonObject[], offsets = payloads.map((_, index) => index * 1_000)): RawCaptureV1 {
  return {
    schema: "riftreplay-raw-capture", version: 1,
    capture: { captureSessionId: "synthetic-target-arrows", lifecycle: { matchFormat: "bo3" } },
    messages: payloads.map((payload, index) => ({
      seq: index, ts: 1_000_000 + offsets[index], dir: payload.type === "action_intent" ? "out" : "in",
      raw: JSON.stringify({ gameInstanceId: "synthetic-room", ...payload }),
    })),
  };
}

function snapshot(targetArrowsByPlayer: JsonObject, gameNumber = 1): JsonObject {
  return {
    type: "authoritative_snapshot", sequence: gameNumber, viewerPlayerId: "local",
    snapshot: {
      roomCode: "synthetic-room", phase: "in_game", gameNumber, matchFormat: "bo3", targetArrowsByPlayer,
      players: [
        { id: "local", name: "Local", board: { base: [{ id: "local-unit", name: "Local unit" }] } },
        { id: "opponent", name: "Opponent", board: {
          base: [{ id: "opponent-unit", name: "Opponent unit" }, { id: "hidden-unit", hidden: true }, { id: "future-unit", analysisKnowledge: "future_reveal" }],
          hand: [{ id: "secret-hand", name: "Secret name" }],
        } },
      ],
      chainEntries: [{ id: "chain-entry", card: { id: "chain-card", name: "A spell" }, byPlayerId: "local" }],
      gameplayLog: [],
    },
  };
}

function commit(type: string, operations: JsonObject[]): JsonObject {
  return { type: "authoritative_patch_commit", action: { type }, actorPlayerId: "local", patch: { operations } };
}
