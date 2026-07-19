import { describe, expect, it } from "vitest";

import {
  ReplayCombinationRequestSchema,
  parseReplayCombinationRequest,
  parseReplayReference,
} from "@/lib/replay-combiner/input";

const LEFT = `rl2_${"a".repeat(32)}`;
const RIGHT = `rl2_${"b".repeat(32)}`;

describe("Replay Combiner input", () => {
  it("accepts canonical IDs and RiftLite replay links", () => {
    expect(parseReplayReference(LEFT)).toBe(LEFT);
    expect(parseReplayReference(`https://www.riftlite.com/replays/${RIGHT}?from=discord#watch`)).toBe(RIGHT);
    expect(parseReplayReference(`/replays/${LEFT}`)).toBe(LEFT);
  });

  it("accepts development links but not lookalike or credentialed hosts", () => {
    expect(parseReplayReference(`http://localhost:3000/replays/${LEFT}`)).toBe(LEFT);
    expect(() => parseReplayReference(`https://riftlite.com.evil.test/replays/${LEFT}`)).toThrow(
      "Enter a RiftLite replay link",
    );
    expect(() => parseReplayReference(`https://user:pass@riftlite.com/replays/${LEFT}`)).toThrow(
      "Enter a RiftLite replay link",
    );
  });

  it("rejects legacy, malformed, and non-replay paths", () => {
    expect(() => parseReplayReference(`https://www.riftlite.com/replay/${LEFT}`)).toThrow();
    expect(() => parseReplayReference(`https://www.riftlite.com/replays/${LEFT}/extra`)).toThrow();
    expect(() => parseReplayReference(`rl2_${"A".repeat(32)}`)).toThrow();
  });

  it("requires explicit permission and different source replays", () => {
    expect(
      ReplayCombinationRequestSchema.safeParse({
        leftReplay: LEFT,
        rightReplay: RIGHT,
        permissionConfirmed: false,
      }).success,
    ).toBe(false);
    expect(() =>
      parseReplayCombinationRequest({
        leftReplay: LEFT,
        rightReplay: LEFT,
        permissionConfirmed: true,
      }),
    ).toThrow("Choose two different replay links");
  });
});
