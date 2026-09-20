import { describe, expect, it } from "vitest";

import { syntheticBo3Capture } from "@/lib/replay-v2/__fixtures__/synthetic-captures";
import { buildReplayCheckpoints } from "@/lib/replay-v2/checkpoints";
import { normalizeRawCaptureV1 } from "@/lib/replay-v2/normalize-replay";
import { projectReplayState } from "@/lib/replay-v2/project-state";
import { seekReplay, seekReplayByEventIndex, seekToGameStart } from "@/lib/replay-v2/seek";
import { stableDigest } from "@/lib/replay-v2/stable-id";

describe("replay projection and seeking", () => {
  it("projects authoritative patches without applying an unconfirmed intent", () => {
    const replay = normalizeRawCaptureV1(syntheticBo3Capture(), { checkpoints: { everyEvents: 2 } });
    const moveIndex = replay.events.findIndex(
      (event) => event.kind === "action" && event.actionType === "move_card",
    );
    const state = seekReplayByEventIndex(replay, moveIndex).state;

    expect(state.players["player-local"].zones.hand).toHaveLength(0);
    expect(state.players["player-local"].zones.base.map((card) => card.id)).toContain("local-card");

    const unconfirmedIndex = replay.events.findIndex(
      (event) => event.kind === "unknown" && event.reason === "unconfirmed_intent",
    );
    const afterUnconfirmed = seekReplayByEventIndex(replay, unconfirmedIndex).state;
    const localCard = afterUnconfirmed.players["player-local"].zones.base.find((card) => card.id === "local-card");
    expect(localCard?.exhausted).toBe(false);
  });

  it("returns the same state through direct projection, checkpoints, forward seek, and backward seek", () => {
    const replay = normalizeRawCaptureV1(syntheticBo3Capture(), { checkpoints: { everyEvents: 2 } });
    const finalIndex = replay.events.length - 1;
    const direct = projectReplayState(replay, finalIndex);
    const firstForward = seekReplayByEventIndex(replay, finalIndex).state;
    const middleTime = replay.events[Math.floor(replay.events.length / 2)].atMs;
    const middle = seekReplay(replay, middleTime);
    const secondForward = seekReplayByEventIndex(replay, finalIndex).state;

    expect(firstForward).toEqual(direct);
    expect(secondForward).toEqual(firstForward);
    expect(middle.eventIndex).toBeGreaterThanOrEqual(0);
    expect(stableDigest(secondForward)).toBe(stableDigest(firstForward));
    replay.checkpoints.forEach((checkpoint) => {
      expect(checkpoint.stateHash).toBe(stableDigest(checkpoint.state));
    });
  });

  it("seeks to an explicit game boundary deterministically", () => {
    const replay = normalizeRawCaptureV1(syntheticBo3Capture(), { checkpoints: { everyEvents: 3 } });
    const first = seekToGameStart(replay, 2);
    const second = seekToGameStart(replay, 2);

    expect(first).toEqual(second);
    expect(first.state.gameOrdinal).toBe(2);
    expect(first.state.gameId).toBe(replay.series.games[1].id);
    expect(first.eventIndex).toBe(replay.series.games[1].eventStartIndex);
  });

  it("keeps Baron Pit for game one and removes it when game two begins", () => {
    const replay = baronPitBo3Replay();
    const secondGameStart = replay.series.games[1].eventStartIndex;
    const gameOneEnd = projectReplayState(replay, secondGameStart - 1);
    const gameTwoStart = projectReplayState(replay, secondGameStart);

    expect(gameOneEnd.room.fields.sharedBattlefieldToken).toEqual(baronPitToken);
    expect(gameOneEnd.players["player-local"].zones.battlefieldToken.map(card => card.name))
      .toEqual(["Baron Nashor"]);
    expect(gameTwoStart.room.fields).not.toHaveProperty("sharedBattlefieldToken");
    expect(gameTwoStart.players["player-local"].zones).not.toHaveProperty("battlefieldToken");
    expect(seekReplayByEventIndex(replay, secondGameStart).state).toEqual(gameTwoStart);
  });

  it("cleans a legacy game-two checkpoint containing only stale Baron Pit metadata", () => {
    const { replay, sideboardingIndex, cleanState, checkpoint } = legacyBaronPitCheckpoint();
    const checkpointHash = stableDigest(checkpoint.state);

    // The old artifact has no battlefield units, options, or selections to
    // trigger existing reconciliation. The shared token alone needs cleanup.
    for (const player of Object.values(checkpoint.state.players)) {
      expect(Object.keys(player.zones).filter(zone => /battlefield/i.test(zone))).toEqual([]);
      expect(player.fields).not.toHaveProperty("battlefieldOptions");
      expect(player.boardFields).not.toHaveProperty("battlefieldOptions");
      expect(player.fields).not.toHaveProperty("selectedBattlefield");
      expect(player.boardFields).not.toHaveProperty("selectedBattlefield");
    }
    const sought = seekReplayByEventIndex(replay, sideboardingIndex);

    expect(sought.checkpointEventIndex).toBe(sideboardingIndex);
    expect(sought.state).toEqual(cleanState);
    expect(sought.state.room.fields).not.toHaveProperty("sharedBattlefieldToken");
    expect(stableDigest(checkpoint.state)).toBe(checkpointHash);
    expect(checkpoint.state.room.fields.sharedBattlefieldToken).toEqual(baronPitToken);
  });

  it("cleans a legacy game-two boundary checkpoint before its setup phase arrives", () => {
    const replay = baronPitBo3Replay();
    const boundaryIndex = replay.series.games[1].eventStartIndex;
    const cleanState = projectReplayState(replay, boundaryIndex);
    const checkpoint = replay.checkpoints.find(candidate => candidate.eventIndex === boundaryIndex);
    if (!checkpoint) throw new Error("Missing fixture boundary checkpoint.");
    expect(cleanState.phase).toBe("unknown");
    expect(cleanState.players["player-local"].zones).not.toHaveProperty("battlefieldToken");
    checkpoint.state.room.fields.sharedBattlefieldToken = { ...baronPitToken };
    checkpoint.stateHash = stableDigest(checkpoint.state);
    const checkpointHash = checkpoint.stateHash;

    const sought = seekReplayByEventIndex(replay, boundaryIndex);
    expect(sought.checkpointEventIndex).toBe(boundaryIndex);
    expect(sought.state).toEqual(cleanState);
    expect(sought.state.room.fields).not.toHaveProperty("sharedBattlefieldToken");
    expect(stableDigest(checkpoint.state)).toBe(checkpointHash);
    expect(seekReplayByEventIndex(replay, boundaryIndex - 1).state.room.fields.sharedBattlefieldToken)
      .toEqual(baronPitToken);
    expect(seekReplayByEventIndex(replay, boundaryIndex).state).toEqual(cleanState);
  });

  it("restores Baron Pit when seeking backward and repeatedly clears it in later-game setup", () => {
    const { replay, sideboardingIndex, cleanState } = legacyBaronPitCheckpoint();
    const firstGameEndIndex = replay.series.games[1].eventStartIndex - 1;
    const firstGameEnd = projectReplayState(replay, firstGameEndIndex);
    const firstGameEndHash = stableDigest(firstGameEnd);

    for (let pass = 0; pass < 3; pass += 1) {
      expect(seekReplayByEventIndex(replay, sideboardingIndex).state).toEqual(cleanState);
      const backward = seekReplayByEventIndex(replay, firstGameEndIndex).state;
      expect(backward.room.fields.sharedBattlefieldToken).toEqual(baronPitToken);
      expect(stableDigest(backward)).toBe(firstGameEndHash);
      expect(seekReplayByEventIndex(replay, sideboardingIndex).state).toEqual(cleanState);
    }
  });
});

const baronPitToken = { kind: "baron_pit", zone: "battlefieldToken", title: "Baron Pit", active: true };

function baronPitBo3Replay() {
  const replay = normalizeRawCaptureV1(syntheticBo3Capture());
  const playEvent = replay.events.find(event => event.kind === "action" && event.actionType === "move_card");
  if (!playEvent || playEvent.kind !== "action") throw new Error("Missing fixture play event.");
  playEvent.patch.operations.push(
    { id: "create-baron-pit", op: "set_room_fields", fields: { sharedBattlefieldToken: baronPitToken } },
    {
      id: "play-baron", op: "zone_insert", playerId: "player-local", zone: "battlefieldToken", index: 0,
      cards: [{
        id: "baron", name: "Baron Nashor", cardCode: "UNL-147", ownerPlayerId: "player-local",
        source: "mainDeck", exhausted: true, isPlaceholder: false, fields: { type: "unit" },
      }],
    },
  );
  replay.checkpoints = buildReplayCheckpoints(replay, { everyEvents: 1 });
  return replay;
}

function legacyBaronPitCheckpoint() {
  const replay = baronPitBo3Replay();
  const gameTwo = replay.series.games[1];
  const sideboardingIndex = replay.events.findIndex(event => (
    event.gameId === gameTwo.id && event.kind === "phase" && event.phase === "sideboarding"
  ));
  if (sideboardingIndex < 0) throw new Error("Missing fixture sideboarding phase.");
  const cleanState = projectReplayState(replay, sideboardingIndex);
  const checkpoint = replay.checkpoints.find(candidate => candidate.eventIndex === sideboardingIndex);
  if (!checkpoint) throw new Error("Missing fixture checkpoint.");
  checkpoint.state.room.fields.sharedBattlefieldToken = { ...baronPitToken };
  checkpoint.stateHash = stableDigest(checkpoint.state);
  return { replay, sideboardingIndex, cleanState, checkpoint };
}
