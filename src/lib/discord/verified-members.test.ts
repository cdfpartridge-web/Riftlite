import { describe, expect, it } from "vitest";

import { formatDiscordVerifiedMembers } from "@/lib/discord/verified-members";

describe("Discord verified-member list", () => {
  it("shows Discord and RiftLite identities without exposing email or Firebase UID", () => {
    const text = formatDiscordVerifiedMembers([{
      discordUserId: "123456789012345678",
      discordUsername: "Jakub",
      displayName: "RIFTLAB Jakub",
      handle: "RIFTLAB",
      linkedAt: 1_783_945_210_908,
    }]);

    expect(text).toContain("Verified and linked RiftLite accounts (1)");
    expect(text).toContain("<@123456789012345678> → RIFTLAB Jakub (@RIFTLAB)");
    expect(text).toContain("linked <t:1783945210:d>");
    expect(text).not.toContain("person@example.com");
    expect(text).not.toContain("firebase-account-id");
  });

  it("keeps the response within Discord's safe message budget", () => {
    const members = Array.from({ length: 100 }, (_, index) => ({
      discordUserId: String(100000000000000000n + BigInt(index)),
      discordUsername: `member-${index}`,
      displayName: `RiftLite member ${index}`,
      handle: `member-${index}`,
      linkedAt: 1_700_000_000_000 + index,
    }));
    const text = formatDiscordVerifiedMembers(members, 500);

    expect(text.length).toBeLessThanOrEqual(500);
    expect(text).toContain("more.");
  });
});
