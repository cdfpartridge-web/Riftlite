import { describe, expect, it } from "vitest";

import { linkedReplayUid } from "@/lib/replay-v2-server/identity";

describe("Replay V2 linked account identity", () => {
  it.each(["custom", "password", "google.com"])("accepts linked Firebase provider %s", (provider) => {
    expect(linkedReplayUid({ uid: "account-123", firebase: { sign_in_provider: provider } }))
      .toBe("account-123");
  });

  it("rejects anonymous and incomplete Firebase identities", () => {
    expect(linkedReplayUid({ uid: "anonymous-123", firebase: { sign_in_provider: "anonymous" } })).toBe("");
    expect(linkedReplayUid({ uid: "account-123" })).toBe("");
    expect(linkedReplayUid(null)).toBe("");
  });
});
