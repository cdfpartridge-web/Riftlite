import { describe, expect, it } from "vitest";

import { syntheticBo3Capture } from "@/lib/replay-v2/__fixtures__/synthetic-captures";
import { normalizeRawCaptureV1 } from "@/lib/replay-v2/normalize-replay";
import { normalizeReplayProviderCapture } from "@/lib/replay-v2/provider-normalization";

describe("Replay V2 provider normalization", () => {
  it("keeps the Atlas parser and canonical output unchanged", () => {
    const input = syntheticBo3Capture();
    const expected = { ...normalizeRawCaptureV1(input), id: "rl2_provider_test" };
    const result = normalizeReplayProviderCapture(input, "atlas", "rl2_provider_test");

    expect(result.captureId).toBe(input.capture?.captureSessionId);
    expect(result.replay).toEqual(expected);
    expect(result.replay.source.schema).toBe("riftreplay-raw-capture");
  });

  it("does not allow a TCGA envelope to enter the Atlas normalizer", () => {
    expect(() => normalizeReplayProviderCapture({
      schema: "riftlite-tcga-raw-capture",
      version: 1,
      capture: {},
      messages: [],
    }, "atlas", "rl2_provider_test")).toThrow(/riftreplay-raw-capture/i);
  });

  it("dispatches a TCGA envelope only through the TCGA normalizer", () => {
    const input = syntheticTcgaCapture();
    const result = normalizeReplayProviderCapture(input, "tcga", "rl2_tcga_provider_test");

    expect(result.captureId).toBe("tcga_provider_capture");
    expect(result.replay.id).toBe("rl2_tcga_provider_test");
    expect(result.replay.source.schema).toBe("riftlite-tcga-raw-capture");
    expect(result.replay.series.participants).toHaveLength(2);
  });

  it("keeps legacy research captures on the local-preview path", () => {
    const input = syntheticTcgaCapture();
    input.capture.source.schema = "riftlite-tcga-research-session";

    expect(() => normalizeReplayProviderCapture(
      input,
      "tcga",
      "rl2_tcga_provider_test",
    )).toThrow(/local-preview only/i);
  });

  it("does not allow an Atlas envelope to enter the TCGA normalizer", () => {
    expect(() => normalizeReplayProviderCapture(
      syntheticBo3Capture(),
      "tcga",
      "rl2_provider_test",
    )).toThrow(/TCGA raw capture/i);
  });
});

function syntheticTcgaCapture() {
  const player = (name: string, legendCode: string, battlefieldCode: string, setupStep: number) => ({
    setupStep,
    profileData: { username: name },
    visibleCards: [{
      id: `${name}-legend`,
      owner: name,
      position: { section: "Legend", index: 0 },
      hiddenTo: { status: "no" },
      cardData: { id: legendCode, name },
    }, {
      id: `${name}-battlefield`,
      owner: name,
      position: { section: "Battlefields", index: 0 },
      hiddenTo: { status: "no" },
      cardData: { id: battlefieldCode, name: `${name} Battlefield` },
    }],
    deck: [],
  });
  const messages = [{
    seq: 0,
    ts: 1_000,
    dir: "in",
    firstTransportSequence: 1,
    completedTransportSequence: 1,
    parsed: {
      type: "NEWCOMMER_GAMEDATA",
      payload: {
        players: {
          tcga_self: player("Self", "OGN-001", "OGN-201", 0),
          tcga_opponent: player("Opponent", "OGN-002", "OGN-202", 0),
        },
        general: { turnCount: 1 },
      },
    },
  }, {
    seq: 1,
    ts: 1_100,
    dir: "out",
    firstTransportSequence: 2,
    completedTransportSequence: 2,
    parsed: {
      type: "PLAYER_DATA",
      gameId: "tcga_self",
      payload: player("Self", "OGN-001", "OGN-201", 10),
    },
  }, {
    seq: 2,
    ts: 1_200,
    dir: "in",
    firstTransportSequence: 3,
    completedTransportSequence: 3,
    parsed: {
      type: "PLAYER_DATA",
      gameId: "tcga_opponent",
      payload: player("Opponent", "OGN-002", "OGN-202", 10),
    },
  }];
  return {
    schema: "riftlite-tcga-raw-capture",
    version: 1,
    exportedAt: "2026-07-20T16:00:00.000Z",
    capture: {
      captureSessionId: "tcga_provider_capture",
      identity: { perspectivePlayerId: "tcga_self", firstSeenAt: 1_000, lastSeenAt: 1_200 },
      lifecycle: { channelKey: "channel-1", openedAt: 900, closedAt: 1_200, endedByLeaving: false },
      source: {
        schema: "riftlite-tcga-web-replay",
        version: 1,
        sha256: "a".repeat(64),
      },
      match: { result: "win" },
    },
    transport: {
      frames: 3,
      decodedFrames: 3,
      logicalMessages: 3,
      chunkGroups: 0,
      completeChunkGroups: 0,
      incompleteChunkGroups: 0,
      incompleteChunkCount: 0,
      duplicateChunks: 0,
      issueCounts: {},
    },
    messages,
  };
}
