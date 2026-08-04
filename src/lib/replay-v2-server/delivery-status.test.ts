import { describe, expect, it } from "vitest";

import { REPLAY_CAPTURE_MISSING_MULLIGAN_CODE } from "@/lib/replay-v2-server/constants";
import { replayOwnerDeliveryStatus } from "@/lib/replay-v2-server/delivery-status";
import type { ReplayRecord } from "@/lib/replay-v2-server/model";

describe("owner replay delivery status", () => {
  it("distinguishes source upload, completion, and active processing", () => {
    expect(replayOwnerDeliveryStatus(record({ status: "uploading" }))).toMatchObject({
      stage: "source-upload-required",
      retryable: true,
      recommendedAction: "upload-source",
    });
    expect(replayOwnerDeliveryStatus(record({
      status: "uploading",
      rawArtifact: artifact("raw"),
    }))).toMatchObject({
      stage: "processing-required",
      retryable: true,
      recommendedAction: "retry-processing",
    });
    expect(replayOwnerDeliveryStatus(record({
      status: "processing",
      rawArtifact: artifact("raw"),
      processingGeneration: "canonical-1",
      updatedAt: new Date(),
    }))).toMatchObject({
      stage: "processing",
      retryable: true,
      recommendedAction: "wait",
      retryAfterMs: 5_000,
    });
  });

  it("turns an expired or incomplete processing claim into an actionable retry", () => {
    expect(replayOwnerDeliveryStatus(record({
      status: "processing",
      rawArtifact: artifact("raw"),
      processingGeneration: "canonical-1",
      updatedAt: new Date(Date.now() - 90_001),
    }))).toMatchObject({
      status: "processing",
      stage: "processing-required",
      retryable: true,
      recommendedAction: "retry-processing",
    });
    expect(replayOwnerDeliveryStatus(record({
      status: "processing",
      rawArtifact: artifact("raw"),
      processingGeneration: "",
      updatedAt: new Date(),
    }))).toMatchObject({
      stage: "processing-required",
      recommendedAction: "retry-processing",
    });
  });

  it("returns partial-capture warnings on a ready replay", () => {
    expect(replayOwnerDeliveryStatus(record({
      status: "ready",
      rawArtifact: artifact("raw"),
      canonicalArtifact: artifact("canonical"),
      warnings: [{
        code: REPLAY_CAPTURE_MISSING_MULLIGAN_CODE,
        message: "The replay did not capture the opening mulligan.",
      }],
    }))).toMatchObject({
      schema: "riftlite-replay-delivery-status",
      version: 1,
      stage: "ready",
      retryable: false,
      recommendedAction: "none",
      warnings: [{
        code: "replay_capture_missing_mulligan",
        message: "The replay did not capture the opening mulligan.",
      }],
    });
  });

  it("preserves validated structured failure guidance", () => {
    expect(replayOwnerDeliveryStatus(record({
      status: "failed",
      failure: {
        code: "normalization_failed",
        message: "Raw replay could not be normalized.",
        class: "request",
        retryable: false,
        recommendedAction: "contact-support",
      },
    }))).toMatchObject({
      stage: "failed",
      retryable: false,
      recommendedAction: "contact-support",
      failure: {
        code: "normalization_failed",
        class: "request",
        retryable: false,
        recommendedAction: "contact-support",
      },
    });
  });

  it("normalizes a legacy two-field failure into the stable recovery contract", () => {
    expect(replayOwnerDeliveryStatus(record({
      status: "failed",
      failure: {
        code: REPLAY_CAPTURE_MISSING_MULLIGAN_CODE,
        message: "Replay capture is incomplete: The replay did not capture the opening mulligan.",
      } as ReplayRecord["failure"],
    }))).toMatchObject({
      stage: "failed",
      retryable: false,
      recommendedAction: "upload-incomplete",
      failure: {
        code: "replay_capture_missing_mulligan",
        class: "capture",
        retryable: false,
        recommendedAction: "upload-incomplete",
      },
    });
  });
});

function record(overrides: Partial<ReplayRecord>): ReplayRecord {
  return {
    schema: "riftlite-replay-record",
    version: 2,
    replayId: `rl2_${"a".repeat(32)}`,
    ownerUid: "owner-1",
    captureId: "capture-1",
    visibility: "private",
    status: "uploading",
    title: "Replay",
    platform: "atlas",
    localReplayId: "",
    matchId: "",
    seriesId: "",
    roomCode: "",
    messageCount: 10,
    expectedRaw: { sha256: "b".repeat(64), bytes: 100 },
    createdAt: new Date("2026-08-03T12:00:00.000Z"),
    updatedAt: new Date("2026-08-03T12:01:00.000Z"),
    ...overrides,
  };
}

function artifact(kind: "raw" | "canonical"): NonNullable<ReplayRecord["rawArtifact"]> {
  return {
    kind,
    generation: `${kind}-1`,
    sha256: "c".repeat(64),
    bytes: 100,
    contentType: "application/gzip",
    provider: "vercel-blob",
    pathname: `${kind}/artifact`,
  };
}
