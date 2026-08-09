import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(callback: T) => callback,
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Twitch stream status", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env.TWITCH_CLIENT_ID;
    delete process.env.TWITCH_CLIENT_SECRET;
    delete process.env.TWITCH_CHANNEL_LOGIN;
  });

  afterEach(() => {
    delete process.env.TWITCH_CLIENT_ID;
    delete process.env.TWITCH_CLIENT_SECRET;
    delete process.env.TWITCH_CHANNEL_LOGIN;
  });

  it("fails closed without Twitch credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { getStreamStatus } = await import("@/lib/twitch/status");

    await expect(getStreamStatus("BMUCasts")).resolves.toMatchObject({
      state: "unavailable",
      isLive: false,
      channelLogin: "bmucasts",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks the normalized requested channel with bounded network calls", async () => {
    process.env.TWITCH_CLIENT_ID = "client";
    process.env.TWITCH_CLIENT_SECRET = "secret";
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: "stream-1",
          user_login: "other_channel",
          type: "live",
          started_at: "2026-08-09T09:00:00.000Z",
        }],
      }));
    const { getStreamStatus } = await import("@/lib/twitch/status");

    await expect(getStreamStatus("Other_Channel")).resolves.toMatchObject({
      state: "live",
      isLive: true,
      channelLogin: "other_channel",
      channelUrl: "https://www.twitch.tv/other_channel",
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("user_login=other_channel");
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("clears a rejected app token and retries Helix only once", async () => {
    process.env.TWITCH_CLIENT_ID = "client";
    process.env.TWITCH_CLIENT_SECRET = "secret";
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ access_token: "stale", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    const { getStreamStatus } = await import("@/lib/twitch/status");

    await expect(getStreamStatus("bmucasts")).resolves.toMatchObject({
      state: "offline",
      isLive: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("oauth2/token")))
      .toHaveLength(2);
  });

  it.each([
    [{ data: [{ id: "stream-1", user_login: "someone_else", type: "live", started_at: "2026-08-09T09:00:00.000Z" }] }],
    [{ data: [{}] }],
    [{ nope: [] }],
  ])("does not confirm malformed or wrong-channel stream data", async (helixBody) => {
    process.env.TWITCH_CLIENT_ID = "client";
    process.env.TWITCH_CLIENT_SECRET = "secret";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(helixBody));
    const { getStreamStatus } = await import("@/lib/twitch/status");

    await expect(getStreamStatus("bmucasts")).resolves.toMatchObject({
      state: "unavailable",
      isLive: false,
    });
  });
});
