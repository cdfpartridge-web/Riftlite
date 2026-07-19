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

  it("validates and whitelists optional desktop match metadata", () => {
    const parsed = parseRawCaptureV1({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "capture-with-result",
        match: {
          format: "bo3",
          result: "loss",
          score: { perspective: 0, opponent: 2, playerId: "must-not-survive" },
          games: [
            {
              gameNumber: 1,
              result: "loss",
              perspectivePoints: 5,
              opponentPoints: 8,
              playerName: "must-not-survive",
            },
            { gameNumber: 2, result: "loss", perspectivePoints: 4, opponentPoints: 5 },
          ],
          opponentId: "must-not-survive",
        },
      },
      messages: [],
    });

    expect(parsed.source.capture?.match).toEqual({
      format: "bo3",
      result: "loss",
      score: { perspective: 0, opponent: 2 },
      games: [
        { gameNumber: 1, result: "loss", perspectivePoints: 5, opponentPoints: 8 },
        { gameNumber: 2, result: "loss", perspectivePoints: 4, opponentPoints: 5 },
      ],
    });
    expect(JSON.stringify(parsed.source.capture?.match)).not.toContain("must-not-survive");
  });

  it("fails closed and diagnoses malformed desktop match metadata", () => {
    const parsed = parseRawCaptureV1({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "capture-with-invalid-result",
        match: {
          format: "bo3",
          result: "loss",
          score: { perspective: 0, opponent: 2 },
          games: [{ gameNumber: 2, result: "definitely-a-win", perspectivePoints: -1 }],
        },
      },
      messages: [],
    });

    expect(parsed.source.capture?.match).toBeUndefined();
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
      code: "desktop_match_metadata_invalid",
      severity: "warning",
    }));
  });

  it("rejects contradictory completed summaries but permits an incomplete partial series", () => {
    const contradictory = parseRawCaptureV1({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "capture-with-contradiction",
        match: {
          format: "bo3",
          result: "win",
          score: { perspective: 0, opponent: 2 },
          games: [
            { gameNumber: 1, result: "loss" },
            { gameNumber: 2, result: "loss" },
          ],
        },
      },
      messages: [],
    });
    const incomplete = parseRawCaptureV1({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "capture-in-progress",
        match: {
          format: "bo3",
          result: "incomplete",
          score: { perspective: 0, opponent: 1 },
          games: [
            { gameNumber: 1, result: "loss", perspectivePoints: 5, opponentPoints: 8 },
            { gameNumber: 2, result: "incomplete" },
          ],
        },
      },
      messages: [],
    });

    expect(contradictory.source.capture?.match).toBeUndefined();
    expect(contradictory.diagnostics.some((entry) => entry.code === "desktop_match_metadata_invalid")).toBe(true);
    expect(incomplete.source.capture?.match).toMatchObject({
      result: "incomplete",
      score: { perspective: 0, opponent: 1 },
    });
    expect(incomplete.diagnostics.some((entry) => entry.code === "desktop_match_metadata_invalid")).toBe(false);
  });
});
