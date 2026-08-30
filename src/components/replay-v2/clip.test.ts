import { describe, expect, it } from "vitest";

import {
  defaultReplayClipRange,
  formatReplayClipSeconds,
  formatReplayClipTimecode,
  normalizeReplayClipRange,
  replayClipDraftFromMarkedStart,
  replayClipUrl,
  replayLocationSelection,
} from "./clip";

describe("Web Replay clips", () => {
  it("keeps legacy timestamp links as one-point seeks", () => {
    expect(replayLocationSelection("?t=12.345", 60_000)).toEqual({
      clipRange: null,
      initialMs: 12_345,
    });
  });

  it("parses and clamps an explicit start/end range after duration is known", () => {
    expect(replayLocationSelection("?start=0&end=75.125", 60_000)).toEqual({
      clipRange: { startMs: 0, endMs: 60_000 },
      initialMs: 0,
    });
  });

  it("rejects malformed, reversed, equal, and extremely short ranges", () => {
    expect(replayLocationSelection("?start=20&end=10&t=3", 60_000)).toEqual({
      clipRange: null,
      initialMs: 3_000,
    });
    expect(normalizeReplayClipRange({ startMs: 1_000, endMs: 1_000 }, 60_000)).toBeNull();
    expect(normalizeReplayClipRange({ startMs: 1_000, endMs: 1_049 }, 60_000)).toBeNull();
  });

  it("makes a thirty-second draft at the playhead without running past the replay", () => {
    expect(defaultReplayClipRange(12_000, 120_000)).toEqual({
      startMs: 12_000,
      endMs: 42_000,
    });
    expect(defaultReplayClipRange(119_900, 120_000)).toEqual({
      startMs: 119_900,
      endMs: 120_000,
    });
  });

  it("keeps a marked start while drafting the end from a later playhead", () => {
    expect(replayClipDraftFromMarkedStart(12_000, 45_550, 120_000)).toEqual({
      startMs: 12_000,
      endMs: 45_550,
    });
    expect(replayClipDraftFromMarkedStart(40_000, 20_000, 120_000)).toEqual({
      startMs: 40_000,
      endMs: 70_000,
    });
    expect(replayClipDraftFromMarkedStart(119_975, 120_000, 120_000)).toBeNull();
  });

  it("builds stable links with millisecond precision", () => {
    expect(formatReplayClipSeconds(12_350)).toBe("12.35");
    expect(formatReplayClipTimecode(12_350)).toBe("0:12.350");
    expect(formatReplayClipTimecode(3_723_045)).toBe("1:02:03.045");
    expect(replayClipUrl("https://www.riftlite.com", "rp /unsafe", {
      startMs: 12_345,
      endMs: 67_890,
    })).toBe("https://www.riftlite.com/replays/rp%20%2Funsafe?start=12.345&end=67.89");
  });
});
