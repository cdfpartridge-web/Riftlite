import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  batchSet: vi.fn(),
  batchCommit: vi.fn(),
  requireMetaStudioSession: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  getStreamStatus: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  revalidateTag: mocks.revalidateTag,
  unstable_cache: (callback: (...args: unknown[]) => unknown) => callback,
}));

vi.mock("@/lib/community/meta-studio-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/community/meta-studio-auth")>();
  return {
    ...actual,
    requireMetaStudioSession: mocks.requireMetaStudioSession,
  };
});

vi.mock("@/lib/twitch/status", () => ({
  getStreamStatus: mocks.getStreamStatus,
  TWITCH_STATUS_CACHE_TAG: "twitch-status",
}));

import { GET, PUT } from "@/app/api/meta-studio/live-takeover/route";

function authorizedDb() {
  const homeRef = { kind: "home", get: mocks.get, set: mocks.set };
  return {
    collection: vi.fn((collection: string) => {
      if (collection === "live_takeover_analytics_runs") {
        return {
          doc: vi.fn((document: string) => ({ kind: "run", id: document })),
        };
      }
      expect(collection).toBe("app_config");
      return {
        doc: vi.fn((document: string) => {
          expect(document).toBe("home");
          return homeRef;
        }),
      };
    }),
    batch: vi.fn(() => ({ set: mocks.batchSet, commit: mocks.batchCommit })),
  };
}

function request(method = "GET", body?: unknown) {
  return new NextRequest(
    "https://www.riftlite.com/api/meta-studio/live-takeover",
    {
      method,
      headers: {
        Cookie: "riftlite_meta_studio=signed",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

describe("Meta Studio live takeover route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ exists: false, data: () => undefined });
    mocks.set.mockResolvedValue(undefined);
    mocks.batchCommit.mockResolvedValue(undefined);
    mocks.getStreamStatus.mockImplementation(async (channelLogin: string) => ({
      state: "offline",
      isLive: false,
      tooltip: `${channelLogin} is offline on Twitch`,
      channelLogin,
      channelUrl: `https://www.twitch.tv/${channelLogin}`,
    }));
    mocks.requireMetaStudioSession.mockResolvedValue({
      uid: "canonical-bmu",
      decoded: { uid: "canonical-bmu" },
      db: authorizedDb(),
    });
  });

  it("loads a normalized private config and its fail-closed status", async () => {
    mocks.get.mockResolvedValue({
      exists: true,
      data: () => ({
        liveTakeover: {
          enabled: true,
          provider: "youtube",
          channelLogin: " BMUCasts ",
          title: "  Ranked   night ",
          embedUrl: "https://evil.example/embed",
        },
        liveTakeoverUpdatedAt: 1234,
      }),
    });

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(payload.config).toEqual({
      enabled: false,
      provider: "twitch",
      channelLogin: "bmucasts",
      title: "Ranked night",
    });
    expect(payload.config).not.toHaveProperty("embedUrl");
    expect(payload.liveTakeover).toMatchObject({
      enabled: false,
      active: false,
      status: "disabled",
      updatedAt: 1234,
    });
  });

  it("merge-saves only normalized fields and immediately revalidates Home", async () => {
    mocks.getStreamStatus.mockResolvedValue({
      state: "live",
      isLive: true,
      tooltip: "bmucasts is live on Twitch",
      channelLogin: "bmucasts",
      channelUrl: "https://www.twitch.tv/bmucasts",
    });

    const response = await PUT(request("PUT", {
      config: {
        enabled: true,
        provider: "twitch",
        channelLogin: "BMUCasts",
        title: "  Sunday   stream ",
        embedUrl: "https://evil.example/player",
      },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.config).toMatchObject({
      enabled: true,
      provider: "twitch",
      channelLogin: "bmucasts",
      title: "Sunday stream",
    });
    expect(payload.config.analyticsRunId).toMatch(/^[a-f0-9-]{36}$/);
    expect(payload.liveTakeover).toMatchObject({ active: true, status: "live" });
    expect(mocks.batchSet).toHaveBeenCalledWith(expect.objectContaining({ kind: "home" }), {
      liveTakeover: payload.config,
      liveTakeoverUpdatedAt: expect.any(Number),
      liveTakeoverUpdatedBy: "canonical-bmu",
    }, { merge: true });
    expect(mocks.batchSet).toHaveBeenCalledWith(expect.objectContaining({
      kind: "run",
      id: payload.config.analyticsRunId,
    }), expect.objectContaining({
      channelLogin: "bmucasts",
      title: "Sunday stream",
      enabled: true,
      endedAt: null,
    }), { merge: true });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("twitch-status", "max");
    expect(mocks.revalidateTag).toHaveBeenCalledWith("app-home-config-v1", "max");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/api/app/home");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/api/app/live-takeover");
    expect(payload.message).toMatch(/is on/i);
  });

  it("ends an enabled takeover in one save even if Twitch remains live", async () => {
    mocks.getStreamStatus.mockResolvedValue({
      state: "live",
      isLive: true,
      tooltip: "bmucasts is live on Twitch",
      channelLogin: "bmucasts",
      channelUrl: "https://www.twitch.tv/bmucasts",
    });

    const payload = await (await PUT(request("PUT", {
      config: { enabled: false, provider: "twitch", channelLogin: "bmucasts" },
    }))).json();

    expect(payload.liveTakeover).toMatchObject({
      enabled: false,
      active: false,
      status: "disabled",
    });
    expect(payload.message).toMatch(/ended/i);
    expect(mocks.getStreamStatus).not.toHaveBeenCalled();
  });

  it.each([
    [{ provider: "youtube", channelLogin: "bmucasts" }, /only supported/i],
    [{ provider: "twitch", channelLogin: "https://evil.example/embed" }, /valid Twitch channel/i],
    [{ provider: "twitch", channelLogin: "abc" }, /valid Twitch channel/i],
  ])("rejects unsupported provider input without writing", async (config, error) => {
    const response = await PUT(request("PUT", { config }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(error) });
    expect(mocks.batchSet).not.toHaveBeenCalled();
  });

  it("rejects cross-origin writes even with an authenticated session", async () => {
    const response = await PUT(new NextRequest(
      "https://www.riftlite.com/api/meta-studio/live-takeover",
      {
        method: "PUT",
        headers: {
          Cookie: "riftlite_meta_studio=signed",
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ config: { enabled: true } }),
      },
    ));

    expect(response.status).toBe(403);
    expect(mocks.batchSet).not.toHaveBeenCalled();
  });

  it("does not read or write Firestore without a Meta Studio session", async () => {
    mocks.requireMetaStudioSession.mockResolvedValue({
      error: NextResponse.json({ error: "Sign in" }, { status: 401 }),
    });

    expect((await GET(request())).status).toBe(401);
    expect((await PUT(request("PUT", { config: {} }))).status).toBe(401);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.batchSet).not.toHaveBeenCalled();
  });
});
