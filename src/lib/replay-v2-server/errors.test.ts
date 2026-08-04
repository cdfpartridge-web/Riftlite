import { describe, expect, it } from "vitest";

import {
  REPLAY_CAPTURE_MISSING_MULLIGAN_CODE,
  REPLAY_PROCESSING_RETRY_STATUS,
} from "@/lib/replay-v2-server/constants";
import {
  normalizeStoredReplayFailure,
  ReplayV2Error,
  replayApiProblem,
  replayFailure,
} from "@/lib/replay-v2-server/errors";

describe("Replay V2 structured recovery errors", () => {
  it("classifies an in-flight completion as retryable processing", () => {
    expect(replayApiProblem(new ReplayV2Error(
      REPLAY_PROCESSING_RETRY_STATUS,
      "replay_processing",
      "Replay processing is still in progress. Retry shortly.",
    ))).toEqual({
      status: 425,
      code: "replay_processing",
      message: "Replay processing is still in progress. Retry shortly.",
      class: "processing",
      retryable: true,
      recommendedAction: "wait",
      retryAfterMs: 5_000,
    });
  });

  it("uses a stable action code for the owner-approved missing-mulligan override", () => {
    expect(replayFailure(new ReplayV2Error(
      422,
      REPLAY_CAPTURE_MISSING_MULLIGAN_CODE,
      "Replay capture is incomplete: The replay did not capture the opening mulligan.",
    ))).toEqual({
      code: "replay_capture_missing_mulligan",
      message: "Replay capture is incomplete: The replay did not capture the opening mulligan.",
      class: "capture",
      retryable: false,
      recommendedAction: "upload-incomplete",
    });
  });

  it("keeps unexpected processing failures compatible with the existing persisted code", () => {
    expect(replayFailure(new Error("private implementation detail"))).toEqual({
      code: "processing_failed",
      message: "Replay processing failed.",
      class: "processing",
      retryable: true,
      recommendedAction: "retry-processing",
    });
  });

  it("preserves valid structured failures and infers legacy two-field failures", () => {
    expect(normalizeStoredReplayFailure({
      code: "normalization_failed",
      message: "Raw replay could not be normalized.",
      class: "request",
      retryable: false,
      recommendedAction: "contact-support",
    })).toEqual({
      code: "normalization_failed",
      message: "Raw replay could not be normalized.",
      class: "request",
      retryable: false,
      recommendedAction: "contact-support",
    });
    expect(normalizeStoredReplayFailure({
      code: REPLAY_CAPTURE_MISSING_MULLIGAN_CODE,
      message: "Replay capture is incomplete: The replay did not capture the opening mulligan.",
    })).toMatchObject({
      class: "capture",
      retryable: false,
      recommendedAction: "upload-incomplete",
    });
  });
});
