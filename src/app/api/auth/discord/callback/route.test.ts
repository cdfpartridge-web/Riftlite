import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimLinkedIdentityAssociation: vi.fn(),
  createFirebaseCustomToken: vi.fn(),
  discordAccountClientId: vi.fn(),
  discordAccountClientSecret: vi.fn(),
  discordAccountRedirectUri: vi.fn(),
  discordLinkedRiftLiteUid: vi.fn(),
  exchangeDiscordAccountCode: vi.fn(),
  getFirestoreAdmin: vi.fn(),
  readDiscordAccountUserId: vi.fn(),
  sealDiscordAccountValue: vi.fn(),
  unsealDiscordAccountValue: vi.fn(),
  validateDiscordDesktopLink: vi.fn(),
}));

vi.mock("@/lib/discord/account-auth", () => ({
  DISCORD_ACCOUNT_CALLBACK_PATH: "/api/auth/discord/callback",
  DISCORD_ACCOUNT_RESULT_COOKIE: "riftlite_discord_result",
  DISCORD_ACCOUNT_STATE_COOKIE: "riftlite_discord_state",
  DISCORD_ACCOUNT_TOKEN_PATH: "/api/auth/discord/token",
  discordAccountClientId: mocks.discordAccountClientId,
  discordAccountClientSecret: mocks.discordAccountClientSecret,
  discordAccountRedirectUri: mocks.discordAccountRedirectUri,
  discordLinkedRiftLiteUid: mocks.discordLinkedRiftLiteUid,
  exchangeDiscordAccountCode: mocks.exchangeDiscordAccountCode,
  readDiscordAccountUserId: mocks.readDiscordAccountUserId,
  sealDiscordAccountValue: mocks.sealDiscordAccountValue,
  unsealDiscordAccountValue: mocks.unsealDiscordAccountValue,
  validateDiscordDesktopLink: mocks.validateDiscordDesktopLink,
}));

vi.mock("@/lib/firebase/admin", () => ({
  createFirebaseCustomToken: mocks.createFirebaseCustomToken,
  getFirestoreAdmin: mocks.getFirestoreAdmin,
}));

vi.mock("@/lib/social/server", () => ({
  claimLinkedIdentityAssociation: mocks.claimLinkedIdentityAssociation,
}));

import { GET } from "@/app/api/auth/discord/callback/route";
import { NextRequest } from "next/server";

describe("Discord account recovery callback", () => {
  const db = { collection: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFirestoreAdmin.mockReturnValue(db);
    mocks.discordAccountClientId.mockReturnValue("discord-client");
    mocks.discordAccountClientSecret.mockReturnValue("discord-secret");
    mocks.discordAccountRedirectUri.mockReturnValue("https://www.riftlite.com/api/auth/discord/callback");
    mocks.unsealDiscordAccountValue.mockReturnValue({
      sessionId: "session-1",
      code: "device-code",
      state: "oauth-state",
    });
    mocks.validateDiscordDesktopLink.mockResolvedValue({ expectedUid: "account-123" });
    mocks.exchangeDiscordAccountCode.mockResolvedValue("discord-access-token");
    mocks.readDiscordAccountUserId.mockResolvedValue("discord-user");
    mocks.discordLinkedRiftLiteUid.mockResolvedValue("account-123");
    mocks.claimLinkedIdentityAssociation.mockResolvedValue(undefined);
    mocks.createFirebaseCustomToken.mockResolvedValue("firebase-custom-token");
    mocks.sealDiscordAccountValue.mockReturnValue("sealed-result");
  });

  it("establishes the canonical self association before issuing a recovered credential", async () => {
    const response = await GET(request());

    expect(response.status).toBe(307);
    expect(mocks.claimLinkedIdentityAssociation).toHaveBeenCalledWith(db, "account-123", "account-123");
    expect(mocks.createFirebaseCustomToken).toHaveBeenCalledWith("account-123");
    expect(mocks.claimLinkedIdentityAssociation.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.createFirebaseCustomToken.mock.invocationCallOrder[0]);
  });

  it("does not issue a recovered credential when the association cannot be established", async () => {
    mocks.claimLinkedIdentityAssociation.mockRejectedValue(new Error("Identity association conflict."));

    const response = await GET(request());

    expect(response.status).toBe(307);
    expect(mocks.createFirebaseCustomToken).not.toHaveBeenCalled();
    expect(mocks.sealDiscordAccountValue).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Identity association conflict." }),
      "discord-secret",
    );
  });
});

function request(): NextRequest {
  return new NextRequest(
    "https://www.riftlite.com/api/auth/discord/callback?state=oauth-state&code=authorization-code",
    { headers: { Cookie: "riftlite_discord_state=sealed-state" } },
  );
}
