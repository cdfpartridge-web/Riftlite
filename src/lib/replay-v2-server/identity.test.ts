import { describe, expect, it } from "vitest";

import { linkedReplayUid, serverAssociatedReplayUid } from "@/lib/replay-v2-server/identity";

describe("Replay V2 linked account identity", () => {
  it.each(["phone", "google.com", "github.com"])("accepts durable Firebase identity %s", (provider) => {
    expect(linkedReplayUid({
      uid: "account-123",
      firebase: {
        identities: { [provider]: ["linked-identity"] },
        sign_in_provider: provider,
      },
    }))
      .toBe("account-123");
  });

  it("accepts email only after Firebase confirms mailbox ownership", () => {
    expect(linkedReplayUid({
      uid: "account-123",
      email_verified: true,
      firebase: { identities: { email: ["linked@example.com"] }, sign_in_provider: "password" },
    })).toBe("account-123");
    expect(linkedReplayUid({
      uid: "account-123",
      email_verified: false,
      firebase: { identities: { email: ["linked@example.com"] }, sign_in_provider: "password" },
    })).toBe("");
  });

  it("accepts a server-issued RiftLite linked-account token without repeated provider metadata", () => {
    expect(linkedReplayUid({
      uid: "account-123",
      riftlite_linked_account: true,
      firebase: { identities: {}, sign_in_provider: "custom" },
    })).toBe("account-123");
    expect(linkedReplayUid({
      uid: "account-123",
      riftlite_linked_account: false,
      firebase: { identities: {}, sign_in_provider: "custom" },
    })).toBe("");
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

  it("accepts only exact server-owned legacy alias and custom self associations", () => {
    expect(serverAssociatedReplayUid({
      uid: "legacy-desktop",
      firebase: { identities: {}, sign_in_provider: "anonymous" },
    }, {
      sourceUid: "legacy-desktop",
      canonicalUid: "account-123",
    })).toBe("account-123");

    expect(serverAssociatedReplayUid({
      uid: "account-123",
      firebase: { identities: {}, sign_in_provider: "custom" },
    }, {
      sourceUid: "account-123",
      canonicalUid: "account-123",
    })).toBe("account-123");

    expect(serverAssociatedReplayUid({
      uid: "anonymous-123",
      firebase: { identities: {}, sign_in_provider: "anonymous" },
    }, {
      sourceUid: "anonymous-123",
      canonicalUid: "anonymous-123",
    })).toBe("");
    expect(serverAssociatedReplayUid({
      uid: "account-123",
      firebase: { identities: {}, sign_in_provider: "custom" },
    }, {
      sourceUid: "another-account",
      canonicalUid: "account-123",
    })).toBe("");
  });
});
