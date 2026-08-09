import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFirestoreAdmin: vi.fn(),
  get: vi.fn(),
  getStreamStatus: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: mocks.getFirestoreAdmin,
}));

vi.mock("@/lib/twitch/status", () => ({
  getStreamStatus: mocks.getStreamStatus,
}));

import { GET } from "@/app/api/app/live-takeover/route";

describe("public desktop live takeover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFirestoreAdmin.mockReturnValue({
      collection: () => ({
        doc: () => ({ get: mocks.get }),
      }),
    });
    mocks.get.mockResolvedValue({ exists: false, data: () => undefined });
  });

  it("returns a CORS-enabled, short-cached disabled default without calling Twitch", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("s-maxage=15");
    expect(payload.liveTakeover).toEqual({
      enabled: false,
      active: false,
      provider: "twitch",
      channelLogin: "bmucasts",
      title: "BMU Casts is live",
      status: "disabled",
      channelUrl: "https://www.twitch.tv/bmucasts",
    });
    expect(mocks.getStreamStatus).not.toHaveBeenCalled();
  });

  it("returns an active normalized takeover only after Twitch confirms live", async () => {
    mocks.get.mockResolvedValue({
      exists: true,
      data: () => ({
        liveTakeover: {
          enabled: true,
          provider: "twitch",
          channelLogin: "BMUCasts",
          title: "  Live   ladder ",
          embedUrl: "https://evil.example/player",
        },
        liveTakeoverUpdatedAt: 3456,
        liveTakeoverUpdatedBy: "private-user-id",
      }),
    });
    mocks.getStreamStatus.mockResolvedValue({
      state: "live",
      isLive: true,
      tooltip: "bmucasts is live on Twitch",
      channelLogin: "bmucasts",
      channelUrl: "https://www.twitch.tv/bmucasts",
    });

    const payload = await (await GET()).json();

    expect(payload.liveTakeover).toEqual({
      enabled: true,
      active: true,
      provider: "twitch",
      channelLogin: "bmucasts",
      title: "Live ladder",
      status: "live",
      channelUrl: "https://www.twitch.tv/bmucasts",
      updatedAt: 3456,
    });
    expect(payload.liveTakeover).not.toHaveProperty("embedUrl");
    expect(payload.liveTakeover).not.toHaveProperty("updatedBy");
  });

  it.each(["offline", "unavailable"] as const)(
    "fails closed while Twitch is %s",
    async (state) => {
      mocks.get.mockResolvedValue({
        exists: true,
        data: () => ({ liveTakeover: { enabled: true } }),
      });
      mocks.getStreamStatus.mockResolvedValue({
        state,
        isLive: false,
        tooltip: "not live",
        channelLogin: "bmucasts",
        channelUrl: "https://www.twitch.tv/bmucasts",
      });

      const payload = await (await GET()).json();

      expect(payload.liveTakeover).toMatchObject({
        enabled: true,
        active: false,
        status: state,
      });
    },
  );

  it("fails closed without taking the public endpoint down when Twitch throws", async () => {
    mocks.get.mockResolvedValue({
      exists: true,
      data: () => ({ liveTakeover: { enabled: true } }),
    });
    mocks.getStreamStatus.mockRejectedValue(new Error("timeout"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.liveTakeover).toMatchObject({ active: false, status: "unavailable" });
  });
});
