import { describe, expect, it } from "vitest";

import { linkedReplayUid } from "@/lib/replay-v2-server/identity";

describe("Replay V2 linked account identity", () => {
  it.each(["email", "phone", "google.com", "github.com"])("accepts durable Firebase identity %s", (provider) => {
    expect(linkedReplayUid({
      uid: "account-123",
      firebase: {
        identities: { [provider]: ["linked-identity"] },
        sign_in_provider: provider,
      },
    }))
      .toBe("account-123");
  });

  it("accepts an anonymous-origin session after Google and email identities are linked", () => {
    expect(linkedReplayUid({
      uid: "account-123",
      firebase: {
        identities: {
          email: ["linked@example.com"],
          "google.com": ["google-account-id"],
        },
        sign_in_provider: "anonymous",
      },
    })).toBe("account-123");
  });

  it("rejects anonymous, bare custom, malformed, and incomplete Firebase identities", () => {
    expect(linkedReplayUid({
      uid: "anonymous-123",
      firebase: { identities: {}, sign_in_provider: "anonymous" },
    })).toBe("");
    expect(linkedReplayUid({
      uid: "custom-without-link",
      firebase: { identities: {}, sign_in_provider: "custom" },
    })).toBe("");
    expect(linkedReplayUid({
      uid: "malformed-identity",
      firebase: { identities: { "google.com": ["", "   "] }, sign_in_provider: "google.com" },
    })).toBe("");
    expect(linkedReplayUid({ uid: "account-123" })).toBe("");
    expect(linkedReplayUid(null)).toBe("");
  });
});
