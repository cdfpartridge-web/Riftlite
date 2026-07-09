import { describe, expect, it } from "vitest";

import { syntheticBo3Capture } from "@/lib/replay-v2/__fixtures__/synthetic-captures";
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
});
