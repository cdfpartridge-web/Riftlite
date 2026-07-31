import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFirestoreAdmin: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: mocks.getFirestoreAdmin,
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
});
