import { describe, expect, it } from "vitest";

import {
  canSkipLabRefresh,
  labRefreshState,
  type LabFactCorpusWatermark,
} from "@/lib/lab-refresh-state";

describe("Lab refresh state", () => {
  const now = new Date("2026-08-15T03:17:00.000Z");
  const watermark: LabFactCorpusWatermark = {
    documentCount: 2_005,
    latestDocumentId: "rl2_latest",
    latestUpdatedAt: "ts:1786760000:123000000",
  };

  it("skips only the same configuration, UTC day, and exact source watermark", () => {
    const state = labRefreshState(now, "config-a", watermark);

    expect(canSkipLabRefresh(state, now, "config-a", watermark)).toBe(true);
    expect(canSkipLabRefresh(state, now, "config-b", watermark)).toBe(false);
    expect(canSkipLabRefresh(state, new Date("2026-08-16T03:17:00.000Z"), "config-a", watermark))
      .toBe(false);
    expect(canSkipLabRefresh(state, now, "config-a", {
      ...watermark,
      documentCount: watermark.documentCount + 1,
    })).toBe(false);
    expect(canSkipLabRefresh(state, now, "config-a", {
      ...watermark,
      latestUpdatedAt: "ts:1786760001:0",
    })).toBe(false);
  });
});
