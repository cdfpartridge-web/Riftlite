import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getFirestoreAdmin: vi.fn(),
  validateDiscordDesktopLink: vi.fn(),
}));
vi.mock("@/lib/firebase/admin", () => ({ getFirestoreAdmin: mocks.getFirestoreAdmin }));
vi.mock("@/lib/discord/account-auth", async (original) => ({
  ...await original<typeof import("@/lib/discord/account-auth")>(),
  validateDiscordDesktopLink: mocks.validateDiscordDesktopLink,
}));

import { GET } from "./route";
import { DISCORD_ACCOUNT_STATE_COOKIE, unsealDiscordAccountValue, type DiscordAccountState } from "@/lib/discord/account-auth";

describe("Discord sign-up OAuth start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DISCORD_CLIENT_ID", "test-client");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "test-secret");
    vi.stubEnv("DISCORD_OAUTH_REDIRECT_URI", "");
    mocks.getFirestoreAdmin.mockReturnValue({});
    mocks.validateDiscordDesktopLink.mockResolvedValue({ expectedUid: "" });
  });

  it("starts public sign-up without a desktop session and seals the local continuation", async () => {
    const response = await GET(request("?returnTo=%2Fdiscord%2Fverify%3Fcode%3Dinvite"));
    expect(response.status).toBe(307);
    expect(mocks.validateDiscordDesktopLink).not.toHaveBeenCalled();
    const authorize = new URL(response.headers.get("location")!);
    expect(authorize.origin).toBe("https://discord.com");
    expect(authorize.searchParams.get("scope")).toBe("identify");
    expect(authorize.searchParams.get("redirect_uri")).toBe("https://www.riftlite.com/api/auth/discord/callback");
    const cookie = response.headers.get("set-cookie")!;
    const sealed = cookie.match(new RegExp(`${DISCORD_ACCOUNT_STATE_COOKIE}=([^;]+)`))![1];
    const state = unsealDiscordAccountValue<DiscordAccountState>(sealed, "test-secret")!;
    expect(state).toMatchObject({ sessionId: "", code: "", returnTo: "/discord/verify?code=invite" });
    expect(authorize.searchParams.get("state")).toBe(state.state);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });

  it("requires both desktop fields and validates the existing session", async () => {
    expect((await GET(request("?session=one"))).status).toBe(400);
    expect((await GET(request("?code=one"))).status).toBe(400);
    expect(mocks.validateDiscordDesktopLink).not.toHaveBeenCalled();
    expect((await GET(request("?session=one&code=abc"))).status).toBe(307);
    expect(mocks.validateDiscordDesktopLink).toHaveBeenCalledWith({}, "one", "ABC");
  });

  it("does not redirect expired desktop sessions into a public account creation flow", async () => {
    mocks.validateDiscordDesktopLink.mockRejectedValue(new Error("Desktop link session has expired."));
    expect((await GET(request("?session=one&code=abc"))).status).toBe(409);
  });

  it("reports missing provider configuration without starting registration", async () => {
    vi.stubEnv("DISCORD_CLIENT_SECRET", "");
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Discord sign in is not configured." });
  });
});

function request(query = "") {
  return new NextRequest(`https://www.riftlite.com/api/auth/discord/start${query}`);
}
