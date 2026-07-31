import { describe, expect, it } from "vitest";

import { aggregateReplayDiscordConfigResults } from "@/lib/discord/replay-share-status";

describe("Discord replay multi-guild delivery status", () => {
  it("keeps a partially delivered hub in progress", () => {
    expect(aggregateReplayDiscordConfigResults(["shared", "in-progress"]))
      .toBe("in-progress");
    expect(aggregateReplayDiscordConfigResults(["already-shared", "in-progress"]))
      .toBe("in-progress");
  });

  it("reports success only when every configured guild is terminal", () => {
    expect(aggregateReplayDiscordConfigResults(["shared", "already-shared"]))
      .toBe("shared");
    expect(aggregateReplayDiscordConfigResults(["already-shared", "already-shared"]))
      .toBe("already-shared");
  });

  it("preserves failure, membership, and configuration outcomes", () => {
    expect(aggregateReplayDiscordConfigResults(["shared", "failed", "in-progress"]))
      .toBe("failed");
    expect(aggregateReplayDiscordConfigResults(["shared", "hub-unavailable"]))
      .toBe("not-member");
    expect(aggregateReplayDiscordConfigResults([])).toBe("not-configured");
  });
});
