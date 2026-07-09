import { describe, expect, it } from "vitest";

import {
  MAX_RAW_CAPTURE_MESSAGES,
  minimumPositiveTimestamp,
  parseRawCaptureV1,
} from "@/lib/replay-v2/parse-raw-capture";

describe("raw replay parser bounds", () => {
  it("rejects the actual raw message sequence above the server limit", () => {
    expect(() => parseRawCaptureV1({
      schema: "riftreplay-raw-capture",
      version: 1,
      messages: new Array(MAX_RAW_CAPTURE_MESSAGES + 1),
    })).toThrow(/cannot contain more than/);
  });

  it("finds the earliest timestamp without spreading a large array", () => {
    const timestamps = new Array<number>(500_000).fill(50_000);
    timestamps[timestamps.length - 1] = 25;
    expect(minimumPositiveTimestamp(timestamps)).toBe(25);
  });

  it("ignores zero, negative, and non-finite timestamps", () => {
    expect(minimumPositiveTimestamp([0, -1, Number.NaN, Number.POSITIVE_INFINITY])).toBeUndefined();
  });
});
