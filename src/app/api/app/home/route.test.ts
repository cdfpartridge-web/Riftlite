import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFirestoreAdmin: vi.fn(),
  get: vi.fn(),
  getCreatorVideoCarousel: vi.fn(),
  getStreamStatus: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: mocks.getFirestoreAdmin,
}));

vi.mock("@/lib/youtube/creator-video-feed", () => ({
  getCreatorVideoCarousel: mocks.getCreatorVideoCarousel,
}));

vi.mock("@/lib/twitch/status", () => ({
  getStreamStatus: mocks.getStreamStatus,
}));

import { GET } from "@/app/api/app/home/route";

describe("desktop homepage config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RIFTLITE_HOME_VIDEO_TITLE;
    delete process.env.RIFTLITE_HOME_VIDEO_URL;
    delete process.env.RIFTLITE_HOME_VIDEO_EMBED_URL;
    delete process.env.RIFTLITE_HOME_VIDEO_2_TITLE;
    delete process.env.RIFTLITE_HOME_VIDEO_2_URL;
    delete process.env.RIFTLITE_HOME_VIDEO_2_EMBED_URL;
    mocks.getFirestoreAdmin.mockReturnValue({
      collection: () => ({
        doc: () => ({ get: mocks.get }),
      }),
    });
    mocks.getCreatorVideoCarousel.mockResolvedValue({
      videos: [],
      updatedAt: "",
    });
    mocks.getStreamStatus.mockImplementation(async (channelLogin = "bmucasts") => ({
      state: "offline",
      isLive: false,
      tooltip: `${channelLogin} is offline on Twitch`,
      channelLogin,
      channelUrl: `https://www.twitch.tv/${channelLogin}`,
    }));
  });

  it("returns both configured videos in order and retains the legacy singular field", async () => {
    mocks.get.mockResolvedValue({
      exists: true,
      data: () => ({
        featuredVideos: [
          {
            title: "First video",
            url: "https://www.youtube.com/watch?v=4n0x_t-wprg",
          },
          {
            title: "Second video",
            url: "https://www.youtube.com/watch?v=gUHFg8zSnSY",
          },
          {
            title: "Ignored third video",
            url: "https://www.youtube.com/watch?v=XPvo24lfN9A",
          },
        ],
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(body.featuredVideos).toEqual([
      {
        title: "First video",
        url: "https://www.youtube.com/watch?v=4n0x_t-wprg",
        embedUrl: "https://www.youtube-nocookie.com/embed/4n0x_t-wprg",
      },
      {
        title: "Second video",
        url: "https://www.youtube.com/watch?v=gUHFg8zSnSY",
        embedUrl: "https://www.youtube-nocookie.com/embed/gUHFg8zSnSY",
      },
    ]);
    expect(body.featuredVideo).toEqual(body.featuredVideos[0]);
    expect(body.creatorVideos).toEqual([]);
    expect(body.creatorVideoCarousel).toEqual({
      enabled: true,
      rotationSeconds: 10,
      maxItems: 17,
    });
    expect(body.creatorVideosUpdatedAt).toBe("");
    expect(body.liveTakeover).toEqual({
      enabled: false,
      active: false,
      provider: "twitch",
      channelLogin: "bmucasts",
      title: "BMU Casts is live",
      status: "disabled",
      channelUrl: "https://www.twitch.tv/bmucasts",
    });
    expect(mocks.getStreamStatus).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("s-maxage=1800");
  });

  it("keeps legacy single-video config working and fills the second slot", async () => {
    mocks.get.mockResolvedValue({
      exists: true,
      data: () => ({
        featuredVideo: {
          title: "Legacy first video",
          url: "https://youtu.be/abcdefghijk",
        },
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(body.featuredVideos).toHaveLength(2);
    expect(body.featuredVideos[0].title).toBe("Legacy first video");
    expect(body.featuredVideos[0].url).toBe("https://www.youtube.com/watch?v=abcdefghijk");
    expect(body.featuredVideos[1].url).toBe("https://www.youtube.com/watch?v=gUHFg8zSnSY");
  });

  it("preserves slot positions when one configured value is invalid", async () => {
    mocks.get.mockResolvedValue({
      exists: true,
      data: () => ({
        featuredVideos: [
          { url: "https://www.youtube.com/watch?v=not-valid" },
          { title: "Valid second video", url: "https://www.youtube.com/watch?v=gUHFg8zSnSY" },
        ],
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(body.featuredVideos[0].url).toBe("https://www.youtube.com/watch?v=4n0x_t-wprg");
    expect(body.featuredVideos[1].url).toBe("https://www.youtube.com/watch?v=gUHFg8zSnSY");
  });

  it("canonicalizes the public URL from the validated embed ID", async () => {
    mocks.get.mockResolvedValue({
      exists: true,
      data: () => ({
        featuredVideos: [{
          title: "Safe video",
          url: "javascript:alert('not allowed')",
          embedUrl: "https://www.youtube.com/embed/gUHFg8zSnSY",
        }],
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(body.featuredVideos[0]).toMatchObject({
      url: "https://www.youtube.com/watch?v=gUHFg8zSnSY",
      embedUrl: "https://www.youtube-nocookie.com/embed/gUHFg8zSnSY",
    });
  });

  it("rejects malformed video IDs and falls back without failing the endpoint", async () => {
    mocks.get.mockResolvedValue({
      exists: true,
      data: () => ({
        featuredVideos: [{ url: "https://www.youtube.com/watch?v=not-valid" }],
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.featuredVideos.map((video: { url: string }) => video.url)).toEqual([
      "https://www.youtube.com/watch?v=4n0x_t-wprg",
      "https://www.youtube.com/watch?v=gUHFg8zSnSY",
    ]);
  });

  it("normalizes carousel config and adds creator videos without changing legacy fields", async () => {
    const creatorVideos = [{
      videoId: "abcdefghijk",
      title: "Creator guide",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      embedUrl: "https://www.youtube-nocookie.com/embed/abcdefghijk",
      thumbnailUrl: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
      creatorId: "creator",
      creatorName: "Creator",
      channelUrl: "https://www.youtube.com/@CreatorOne",
      publishedAt: "2026-08-04T08:00:00.000Z",
    }];
    mocks.get.mockResolvedValue({
      exists: true,
      data: () => ({
        featuredVideos: [{
          title: "Legacy remains",
          url: "https://www.youtube.com/watch?v=4n0x_t-wprg",
        }],
        creatorVideoCarousel: {
          enabled: true,
          rotationSeconds: 30,
          maxItems: 6,
          excludedVideoIds: ["12345678901"],
          pinnedVideoIds: ["abcdefghijk"],
          creators: [{
            id: "creator",
            videoSlots: 2,
          }],
        },
        communitySpotlights: [{
          id: "creator",
          name: "Creator",
          enabled: true,
          links: { youtube: "https://www.youtube.com/@CreatorOne" },
          channelId: "UCDQDmAPxp49TXOK9ZjLbCuA",
        }],
      }),
    });
    mocks.getCreatorVideoCarousel.mockResolvedValue({
      videos: creatorVideos,
      updatedAt: "2026-08-04T09:00:00.000Z",
    });

    const response = await GET();
    const body = await response.json();

    expect(body.featuredVideo.title).toBe("Legacy remains");
    expect(body.featuredVideos).toHaveLength(2);
    expect(body.creatorVideos).toEqual(creatorVideos);
    expect(body.creatorVideoCarousel).toEqual({
      enabled: true,
      rotationSeconds: 30,
      maxItems: 6,
    });
    expect(body.creatorVideosUpdatedAt).toBe("2026-08-04T09:00:00.000Z");
    expect(mocks.getCreatorVideoCarousel).toHaveBeenCalledWith(
      expect.objectContaining({
        excludedVideoIds: ["12345678901"],
        pinnedVideoIds: ["abcdefghijk"],
        creators: [expect.objectContaining({ id: "creator", videoSlots: 2 })],
      }),
      expect.anything(),
    );
  });

  it("keeps the legacy response available when creator ingestion fails unexpectedly", async () => {
    mocks.get.mockResolvedValue({ exists: false, data: () => null });
    mocks.getCreatorVideoCarousel.mockRejectedValue(new Error("feed unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.featuredVideo).toEqual(body.featuredVideos[0]);
    expect(body.featuredVideos).toHaveLength(2);
    expect(body.creatorVideos).toEqual([]);
    expect(body.creatorVideosUpdatedAt).toBe("");
  });

  it("publishes a takeover only when it is enabled and Twitch verifies it is live", async () => {
    mocks.get.mockResolvedValue({
      exists: true,
      data: () => ({
        liveTakeover: {
          enabled: true,
          provider: "twitch",
          channelLogin: "BMUCasts",
          title: "  Riftbound   ranked night ",
          embedUrl: "https://evil.example/player",
        },
        liveTakeoverUpdatedAt: 9876,
      }),
    });
    mocks.getStreamStatus.mockResolvedValue({
      state: "live",
      isLive: true,
      tooltip: "bmucasts is live on Twitch",
      channelLogin: "bmucasts",
      channelUrl: "https://www.twitch.tv/bmucasts",
    });

    const response = await GET();
    const body = await response.json();

    expect(body.liveTakeover).toEqual({
      enabled: true,
      active: true,
      provider: "twitch",
      channelLogin: "bmucasts",
      title: "Riftbound ranked night",
      status: "live",
      channelUrl: "https://www.twitch.tv/bmucasts",
      updatedAt: 9876,
    });
    expect(body.liveTakeover).not.toHaveProperty("embedUrl");
    expect(mocks.getStreamStatus).toHaveBeenCalledWith("bmucasts");
  });

  it.each(["offline", "unavailable"] as const)(
    "fails closed when Twitch status is %s",
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

      const body = await (await GET()).json();

      expect(body.liveTakeover).toMatchObject({
        enabled: true,
        active: false,
        status: state,
      });
    },
  );

  it("keeps legacy Home content available when the Twitch lookup throws", async () => {
    mocks.get.mockResolvedValue({
      exists: true,
      data: () => ({ liveTakeover: { enabled: true } }),
    });
    mocks.getStreamStatus.mockRejectedValue(new Error("Twitch timed out"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.featuredVideos).toHaveLength(2);
    expect(body.creatorVideos).toEqual([]);
    expect(body.liveTakeover).toMatchObject({
      enabled: true,
      active: false,
      status: "unavailable",
    });
  });
});
