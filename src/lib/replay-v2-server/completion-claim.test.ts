import { describe, expect, it } from "vitest";

import {
  REPLAY_PROCESSING_LEASE_MS,
  replayProcessingClaimIsActive,
} from "@/lib/replay-v2-server/completion-claim";
import type { ReplayRecord } from "@/lib/replay-v2-server/model";

const NOW = Date.UTC(2026, 6, 9, 15, 0, 0);

describe("replay completion claims", () => {
  it("keeps one recent processing generation active", () => {
    expect(replayProcessingClaimIsActive(processingRecord(new Date(NOW - 1_000)), NOW)).toBe(true);
  });

  it("allows recovery after the processing lease expires", () => {
    expect(
      replayProcessingClaimIsActive(
        processingRecord(new Date(NOW - REPLAY_PROCESSING_LEASE_MS - 1)),
        NOW,
      ),
    ).toBe(false);
  });

  it("fails closed when an active claim has unreadable timestamp metadata", () => {
    expect(replayProcessingClaimIsActive(processingRecord({}), NOW)).toBe(true);
  });

  it("does not treat non-processing records as claimed", () => {
    const record = processingRecord(new Date(NOW));
    record.status = "failed";
    expect(replayProcessingClaimIsActive(record, NOW)).toBe(false);
  });
});

function processingRecord(updatedAt: unknown): ReplayRecord {
  return {
    status: "processing",
    processingGeneration: "canonical_0123456789abcdef0123456789abcdef",
    updatedAt,
  } as ReplayRecord;
}
