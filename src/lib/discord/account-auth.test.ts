import { beforeEach, describe, expect, it, vi } from "vitest";

const canonicalIdentityUid = vi.hoisted(() => vi.fn(async (uid: unknown) => String(uid ?? "")));

vi.mock("@/lib/identity-server", () => ({ canonicalIdentityUid }));

import {
  discordAccountAuthorizeUrl,
  discordLinkedRiftLiteUid,
  sealDiscordAccountValue,
  unsealDiscordAccountValue,
  validateDiscordDesktopLink,
  type DiscordAccountState,
} from "@/lib/discord/account-auth";

describe("Discord account recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canonicalIdentityUid.mockImplementation(async (uid: unknown) => String(uid ?? ""));
  });

  it("signs short-lived OAuth state and rejects tampering or expiry", () => {
    const state: DiscordAccountState = {
      state: "oauth-state",
      sessionId: "session-1",
      code: "ABC123",
      expiresAt: 2_000,
    };
    const sealed = sealDiscordAccountValue(state, "test-secret");
    expect(unsealDiscordAccountValue<DiscordAccountState>(sealed, "test-secret", 1_000)).toEqual(state);
    expect(unsealDiscordAccountValue<DiscordAccountState>(`${sealed}x`, "test-secret", 1_000)).toBeNull();
    expect(unsealDiscordAccountValue<DiscordAccountState>(sealed, "wrong-secret", 1_000)).toBeNull();
    expect(unsealDiscordAccountValue<DiscordAccountState>(sealed, "test-secret", 2_001)).toBeNull();
  });

  it("requests only Discord identity and binds the registered callback", () => {
    const url = new URL(discordAccountAuthorizeUrl(
      "discord-client",
      "https://www.riftlite.com/api/auth/discord/callback",
      "oauth-state",
    ));
    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(url.searchParams.get("scope")).toBe("identify");
    expect(url.searchParams.get("state")).toBe("oauth-state");
    expect(url.searchParams.get("redirect_uri")).toBe("https://www.riftlite.com/api/auth/discord/callback");
  });

  it("resolves all guild links for one Discord user to one canonical account", async () => {
    canonicalIdentityUid.mockImplementation(async (uid: unknown) => String(uid) === "legacy-uid" ? "account-uid" : String(uid));
    const db = fakeDb({
      links: [{ uid: "legacy-uid" }, { uid: "account-uid" }],
    });

    await expect(discordLinkedRiftLiteUid(db as never, "1234567890")).resolves.toBe("account-uid");
  });

  it("rejects an unlinked Discord identity and ambiguous historical accounts", async () => {
    await expect(discordLinkedRiftLiteUid(fakeDb({ links: [] }) as never, "1234567890"))
      .rejects.toThrow("No existing RiftLite account");
    await expect(discordLinkedRiftLiteUid(fakeDb({ links: [{ uid: "one" }, { uid: "two" }] }) as never, "1234567890"))
      .rejects.toThrow("more than one older RiftLite account");
  });

  it("does not miss a conflicting account beyond an arbitrary guild-link window", async () => {
    const links = [
      ...Array.from({ length: 50 }, () => ({ uid: "account-one" })),
      { uid: "account-two" },
    ];

    await expect(discordLinkedRiftLiteUid(fakeDb({ links }) as never, "1234567890"))
      .rejects.toThrow("more than one older RiftLite account");
  });

  it("requires the exact pending desktop session before starting OAuth", async () => {
    const db = fakeDb({
      session: { code: "ABC123", status: "pending", expiresAt: 5_000, expectedUid: "legacy-uid" },
    });
    await expect(validateDiscordDesktopLink(db as never, "session-1", "abc123", 1_000))
      .resolves.toEqual({ expectedUid: "legacy-uid" });
    await expect(validateDiscordDesktopLink(db as never, "session-1", "wrong", 1_000))
      .rejects.toThrow("did not match");
  });
});

function fakeDb(input: {
  links?: Array<Record<string, unknown>>;
  session?: Record<string, unknown>;
}) {
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({
          exists: Boolean(input.session),
          data: () => input.session,
        }),
      }),
      where: () => ({
        get: async () => ({
          docs: (input.links ?? []).map((link) => ({ data: () => link })),
        }),
        limit: () => ({
          get: async () => ({
            docs: (input.links ?? []).slice(0, 50).map((link) => ({ data: () => link })),
          }),
        }),
      }),
    }),
  };
}
