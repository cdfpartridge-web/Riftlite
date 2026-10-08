import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimLinkedIdentityAssociation: vi.fn(),
  createFirebaseCustomToken: vi.fn(),
  discordAccountClientId: vi.fn(),
  discordAccountClientSecret: vi.fn(),
  discordAccountRedirectUri: vi.fn(),
  discordLinkedRiftLiteUid: vi.fn(),
  resolveDiscordAccountUid: vi.fn(),
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
vi.mock("@/lib/discord/account-registration", () => ({ resolveDiscordAccountUid: mocks.resolveDiscordAccountUid }));

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
    mocks.resolveDiscordAccountUid.mockResolvedValue("account-123");
    mocks.claimLinkedIdentityAssociation.mockResolvedValue(undefined);
    mocks.createFirebaseCustomToken.mockResolvedValue("firebase-custom-token");
    mocks.sealDiscordAccountValue.mockReturnValue("sealed-result");
  });

  it("establishes the canonical self association before issuing a recovered credential", async () => {
    const response = await GET(request());

    expect(response.status).toBe(307);
    expect(mocks.resolveDiscordAccountUid).toHaveBeenCalledWith(db, "discord-user", "account-123");
    expect(mocks.claimLinkedIdentityAssociation).toHaveBeenCalledWith(db, "account-123", "account-123");
    expect(mocks.createFirebaseCustomToken).toHaveBeenCalledWith("account-123");
    expect(mocks.claimLinkedIdentityAssociation.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.createFirebaseCustomToken.mock.invocationCallOrder[0]);
  });

  it("registers a new Discord identity for an unpinned desktop and preserves its linking continuation", async () => {
    mocks.validateDiscordDesktopLink.mockResolvedValue({ expectedUid: "" });
    mocks.resolveDiscordAccountUid.mockResolvedValue("new-discord-account");
    const response = await GET(request());
    expect(mocks.resolveDiscordAccountUid).toHaveBeenCalledWith(db, "discord-user", "");
    expect(mocks.createFirebaseCustomToken).toHaveBeenCalledWith("new-discord-account");
    const redirect = new URL(response.headers.get("location")!);
    expect(redirect.pathname).toBe("/link-device");
    expect(redirect.searchParams.get("session")).toBe("session-1");
    expect(redirect.searchParams.get("discord")).toBe("complete");
  });

  it("returns public sign-up to account profile completion without creating a desktop link", async () => {
    mocks.unsealDiscordAccountValue.mockReturnValue({ state: "oauth-state", sessionId: "", code: "", returnTo: "/hubs/invite/invite-1" });
    const response = await GET(request());
    expect(mocks.validateDiscordDesktopLink).not.toHaveBeenCalled();
    expect(mocks.resolveDiscordAccountUid).toHaveBeenCalledWith(db, "discord-user", "");
    const redirect = new URL(response.headers.get("location")!);
    expect(redirect.pathname).toBe("/account");
    expect(redirect.searchParams.get("returnTo")).toBe("/hubs/invite/invite-1");
    expect(redirect.searchParams.has("session")).toBe(false);
  });

  it("rejects mismatched OAuth state before exchanging or creating an identity", async () => {
    mocks.unsealDiscordAccountValue.mockReturnValue({ state: "other-state", sessionId: "", code: "" });
    await GET(request());
    expect(mocks.exchangeDiscordAccountCode).not.toHaveBeenCalled();
    expect(mocks.resolveDiscordAccountUid).not.toHaveBeenCalled();
    expect(mocks.createFirebaseCustomToken).not.toHaveBeenCalled();
  });

  it("rejects a pinned-account mismatch without issuing a credential", async () => {
    mocks.resolveDiscordAccountUid.mockRejectedValue(new Error("Account stored on this device does not match."));
    await GET(request());
    expect(mocks.claimLinkedIdentityAssociation).not.toHaveBeenCalled();
    expect(mocks.createFirebaseCustomToken).not.toHaveBeenCalled();
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
