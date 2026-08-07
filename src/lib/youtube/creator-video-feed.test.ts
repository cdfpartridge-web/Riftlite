import type { Firestore } from "firebase-admin/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CREATOR_VIDEO_CAROUSEL_CONFIG,
  type CreatorVideoCarouselConfig,
  normalizeCreatorVideoCarouselConfig,
} from "@/lib/youtube/creator-video-config";
import {
  type CreatorVideo,
  getCreatorVideoCarousel,
  getCreatorVideoCarouselPreview,
  parseYoutubeAtomFeed,
  parseYoutubeAtomFeedPreview,
  selectCreatorVideos,
  youtubeChannelIdFromHtml,
} from "@/lib/youtube/creator-video-feed";

const RIFTLAB = normalizeCreatorVideoCarouselConfig(undefined).creators[0]!;
const RIFTLAB_CHANNEL = {
  ...RIFTLAB,
  youtubeUrl: `https://www.youtube.com/channel/${RIFTLAB.channelId}`,
};

describe("YouTube creator video feeds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T09:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("parses Atom entries into canonical, newest-first public video records", () => {
    const videos = parseYoutubeAtomFeed(atomFeed([
      ["abcdefghijk", "Older &amp; useful", "2026-08-01T12:00:00+00:00"],
      ["12345678901", "Newest guide", "2026-08-03T12:00:00+00:00"],
      ["not-valid", "Ignored", "2026-08-04T12:00:00+00:00"],
    ]), RIFTLAB);

    expect(videos).toHaveLength(2);
    expect(videos[0]).toEqual({
      videoId: "12345678901",
      title: "Newest guide",
      url: "https://www.youtube.com/watch?v=12345678901",
      embedUrl: "https://www.youtube-nocookie.com/embed/12345678901",
      thumbnailUrl: "https://i.ytimg.com/vi/12345678901/hqdefault.jpg",
      creatorId: "riftlab",
      creatorName: "Riftlab",
      channelUrl: "https://www.youtube.com/@RiftlabTCG",
      publishedAt: "2026-08-03T12:00:00.000Z",
    });
    expect(videos[1]?.title).toBe("Older & useful");
  });

  it("resolves channel IDs from common handle-page metadata", () => {
    expect(youtubeChannelIdFromHtml(
      '<meta itemprop="channelId" content="UCDQDmAPxp49TXOK9ZjLbCuA">',
    )).toBe("UCDQDmAPxp49TXOK9ZjLbCuA");
    expect(youtubeChannelIdFromHtml(
      '<script>{"externalId":"UCw6Qfsm4P--Bq2BPKf031SQ"}</script>',
    )).toBe("UCw6Qfsm4P--Bq2BPKf031SQ");
    expect(youtubeChannelIdFromHtml("no channel metadata")).toBe("");
  });

  it("filters mixed channels using both titles and descriptions", () => {
    const mixedCreator = {
      ...RIFTLAB,
      id: "mixed",
      name: "Mixed creator",
      sourceMode: "riftbound" as const,
    };
    const preview = parseYoutubeAtomFeedPreview(atomFeed([
      ["titlematch1", "A RIFTBOUND tournament", "2026-08-04T08:00:00Z", ""],
      ["descmatch01", "Weekly card update", "2026-08-03T08:00:00Z", "Competitive Riftbound coverage"],
      ["nomatch0000", "Marvel Rivals stream", "2026-08-02T08:00:00Z", "Ranked matches"],
      ["excluded001", "Riftbound deck guide", "2026-08-01T08:00:00Z", ""],
    ]), mixedCreator, {
      includedVideoIds: new Set(),
      pinnedVideoIds: new Set(),
      excludedVideoIds: new Set(["excluded001"]),
    });

    expect(preview.map((item) => [item.videoId, item.status])).toEqual([
      ["titlematch1", "included"],
      ["descmatch01", "included"],
      ["nomatch0000", "filtered"],
      ["excluded001", "excluded"],
    ]);
    expect(parseYoutubeAtomFeed(atomFeed([
      ["nomatch0000", "Marvel Rivals", "2026-08-02T08:00:00Z", ""],
      ["manual00001", "General update", "2026-08-01T08:00:00Z", ""],
    ]), mixedCreator, {
      includedVideoIds: new Set(["manual00001"]),
      pinnedVideoIds: new Set(),
      excludedVideoIds: new Set(),
    }).map((item) => item.videoId)).toEqual(["manual00001"]);
  });

  it("spreads weighted creator slots deterministically", () => {
    const config = configForSelection();
    const videos = selectCreatorVideos(config, [
      video("riftlab", "rift-1", "2026-08-04T08:00:00Z"),
      video("riftlab", "rift-2", "2026-08-03T08:00:00Z"),
      video("riftlab", "rift-3", "2026-08-02T08:00:00Z"),
      video("riftlab", "rift-4", "2026-08-01T08:00:00Z"),
      video("creator-a", "aaaaaaa0001", "2026-08-04T07:00:00Z"),
      video("creator-b", "bbbbbbb0001", "2026-08-04T06:00:00Z"),
      video("creator-c", "ccccccc0001", "2026-08-04T05:00:00Z"),
    ]);

    expect(videos.map((item) => item.creatorId)).toEqual([
      "riftlab",
      "creator-a",
      "riftlab",
      "creator-b",
      "riftlab",
      "creator-c",
      "riftlab",
    ]);
    expect(videos).toHaveLength(7);
  });

  it("keeps every weighted slot in the full default creator roster", () => {
    const config = DEFAULT_CREATOR_VIDEO_CAROUSEL_CONFIG;
    const candidates = config.creators.flatMap((creator, creatorIndex) =>
      creator.youtubeUrl
        ? Array.from({ length: creator.videoSlots }, (_, slotIndex) => video(
            creator.id,
            `v${creatorIndex}-${slotIndex}`,
            new Date(Date.UTC(2026, 7, 4, 8, creatorIndex, slotIndex)).toISOString(),
          ))
        : []);

    const videos = selectCreatorVideos(config, candidates);
    const counts = videos.reduce((byCreator, item) => {
      byCreator.set(item.creatorId, (byCreator.get(item.creatorId) ?? 0) + 1);
      return byCreator;
    }, new Map<string, number>());

    expect(videos).toHaveLength(16);
    expect(counts.get("riftlab")).toBe(4);
    expect(counts.get("frodan")).toBe(2);
    expect(config.creators
      .filter((creator) => creator.youtubeUrl && !["riftlab", "frodan"].includes(creator.id))
      .every((creator) => counts.get(creator.id) === 1)).toBe(true);
  });

  it("puts available pins first and always removes exclusions", () => {
    const config = {
      ...configForSelection(),
      maxItems: 4,
      pinnedVideoIds: ["bbbbbbb0001", "rift-2xxxxx"],
      excludedVideoIds: ["rift-1xxxxx"],
    };
    const videos = selectCreatorVideos(config, [
      video("riftlab", "rift-1xxxxx", "2026-08-04T08:00:00Z"),
      video("riftlab", "rift-2xxxxx", "2026-08-03T08:00:00Z"),
      video("riftlab", "rift-3xxxxx", "2026-08-02T08:00:00Z"),
      video("creator-b", "bbbbbbb0001", "2026-08-04T06:00:00Z"),
    ]);

    expect(videos.map((item) => item.videoId)).toEqual([
      "bbbbbbb0001",
      "rift-2xxxxx",
      "rift-3xxxxx",
    ]);
    expect(videos.some((item) => item.videoId === "rift-1xxxxx")).toBe(false);
  });

  it("isolates feed failures and stores the successful aggregate snapshot", async () => {
    const config = normalizeCreatorVideoCarouselConfig({
      maxItems: 2,
      creators: [
        { ...RIFTLAB_CHANNEL, videoSlots: 1 },
        {
          id: "handle",
          name: "Handle",
          spotlightId: "handle",
          youtubeUrl: "https://www.youtube.com/@HandleCreator",
          enabled: true,
          videoSlots: 1,
        },
      ],
    });
    const firestore = fakeFirestore();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes(`channel_id=${RIFTLAB.channelId}`)) {
          return new Response(atomFeed([
            ["abcdefghijk", "Riftlab upload", "2026-08-04T08:00:00Z"],
          ]), { status: 200 });
        }
        if (url === "https://www.youtube.com/@HandleCreator") {
          return new Response("channel page unavailable", { status: 503 });
        }
        throw new Error(`Unexpected request: ${url}`);
      });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await getCreatorVideoCarousel(config, firestore.db);

    expect(result.videos.map((item) => item.videoId)).toEqual(["abcdefghijk"]);
    expect(result.updatedAt).toBe("2026-08-04T09:00:00.000Z");
    expect(firestore.read("app_cache/creator-video-carousel")?.videos).toHaveLength(1);
    const feedCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/feeds/videos.xml"));
    expect(feedCall?.[1]).toMatchObject({
      next: { revalidate: 1800, tags: ["youtube-creator-videos"] },
    });
  });

  it("resolves a handle URL before requesting its cached Atom feed", async () => {
    const config = normalizeCreatorVideoCarouselConfig({
      maxItems: 1,
      creators: [{
        id: "handle",
        name: "Handle",
        youtubeUrl: "https://www.youtube.com/@HandleCreator",
        sourceMode: "all",
        videoSlots: 1,
      }],
    });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        '<meta itemprop="channelId" content="UCDQDmAPxp49TXOK9ZjLbCuA">',
        { status: 200 },
      ))
      .mockResolvedValueOnce(new Response(atomFeed([
        ["abcdefghijk", "Handle upload", "2026-08-04T08:00:00Z"],
      ]), { status: 200 }));

    const result = await getCreatorVideoCarousel(config, null);

    expect(result.videos.map((item) => item.videoId)).toEqual(["abcdefghijk"]);
    expect(fetchMock.mock.calls[0]).toEqual([
      "https://www.youtube.com/@HandleCreator",
      expect.objectContaining({ next: { revalidate: 3600, tags: ["youtube-creator-videos"] } }),
    ]);
    expect(String(fetchMock.mock.calls[1]?.[0]))
      .toContain("channel_id=UCDQDmAPxp49TXOK9ZjLbCuA");
  });

  it("skips featured creators that do not have a YouTube social link", async () => {
    const config = normalizeCreatorVideoCarouselConfig({
      maxItems: 1,
      creators: [
        { id: "no-youtube", name: "No YouTube yet", videoSlots: 1 },
        { ...RIFTLAB_CHANNEL, videoSlots: 1 },
      ],
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(atomFeed([
        ["abcdefghijk", "Riftlab upload", "2026-08-04T08:00:00Z"],
      ]), { status: 200 }),
    );

    const result = await getCreatorVideoCarousel(config, null);

    expect(result.videos.map((item) => item.creatorId)).toEqual(["riftlab"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0]))
      .toContain(`channel_id=${RIFTLAB.channelId}`);
  });

  it("fetches a configured playlist directly and exposes filter decisions for preview", async () => {
    const config = normalizeCreatorVideoCarouselConfig({
      maxItems: 2,
      creators: [{
        id: "playlist-creator",
        name: "Playlist creator",
        sourceMode: "playlist",
        playlistId: "PLQfZRuxub-RU",
        videoSlots: 2,
      }],
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(atomFeed([
      ["general0001", "General card video", "2026-08-04T08:00:00Z", "No keyword needed"],
      ["hidden00001", "Hidden upload", "2026-08-03T08:00:00Z", ""],
    ]), { status: 200 }));
    config.excludedVideoIds = ["hidden00001"];

    const preview = await getCreatorVideoCarouselPreview(config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0]))
      .toBe("https://www.youtube.com/feeds/videos.xml?playlist_id=PLQfZRuxub-RU");
    expect(preview[0]).toMatchObject({
      creatorId: "playlist-creator",
      sourceMode: "playlist",
      succeeded: true,
    });
    expect(preview[0]?.items.map((item) => [item.videoId, item.status])).toEqual([
      ["general0001", "included"],
      ["hidden00001", "excluded"],
    ]);
  });

  it("uses a matching last-known-good snapshot when every feed fails", async () => {
    const config = normalizeCreatorVideoCarouselConfig({
      maxItems: 1,
      creators: [{ ...RIFTLAB_CHANNEL, videoSlots: 1 }],
    });
    const firstFirestore = fakeFirestore();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(atomFeed([
      ["abcdefghijk", "Known good", "2026-08-03T08:00:00Z"],
    ]), { status: 200 }));
    const first = await getCreatorVideoCarousel(config, firstFirestore.db);
    const saved = firstFirestore.read("app_cache/creator-video-carousel");
    expect(first.videos).toHaveLength(1);

    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("offline", { status: 503 }));
    const secondFirestore = fakeFirestore({ "app_cache/creator-video-carousel": saved });
    vi.setSystemTime(new Date("2026-08-05T09:00:00.000Z"));

    const second = await getCreatorVideoCarousel(config, secondFirestore.db);

    expect(second.videos.map((item) => item.videoId)).toEqual(["abcdefghijk"]);
    expect(second.updatedAt).toBe("2026-08-04T09:00:00.000Z");
  });

  it("combines a fresh creator with last-known-good videos for a failed creator", async () => {
    const config = normalizeCreatorVideoCarouselConfig({
      maxItems: 2,
      creators: [
        { ...RIFTLAB_CHANNEL, videoSlots: 1 },
        {
          ...creator("creator-b", 1),
          channelId: "UCw6Qfsm4P--Bq2BPKf031SQ",
        },
      ],
    });
    const firstFirestore = fakeFirestore();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      return url.includes(RIFTLAB.channelId)
        ? new Response(atomFeed([["oldrift0001", "Old Riftlab", "2026-08-03T08:00:00Z"]]), { status: 200 })
        : new Response(atomFeed([["oldother001", "Old other", "2026-08-03T07:00:00Z"]]), { status: 200 });
    });
    await getCreatorVideoCarousel(config, firstFirestore.db);
    const saved = firstFirestore.read("app_cache/creator-video-carousel");

    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      return url.includes(RIFTLAB.channelId)
        ? new Response(atomFeed([["newrift0001", "New Riftlab", "2026-08-05T08:00:00Z"]]), { status: 200 })
        : new Response("offline", { status: 503 });
    });
    vi.setSystemTime(new Date("2026-08-05T09:00:00.000Z"));
    const secondFirestore = fakeFirestore({ "app_cache/creator-video-carousel": saved });

    const result = await getCreatorVideoCarousel(config, secondFirestore.db);

    expect(result.videos.map((item) => item.videoId)).toEqual(["newrift0001", "oldother001"]);
    expect(result.updatedAt).toBe("2026-08-05T09:00:00.000Z");
    expect(secondFirestore.read("app_cache/creator-video-carousel")?.videos).toHaveLength(2);
  });

  it("does not reuse an all-upload snapshot after switching to Riftbound-only filtering", async () => {
    const allConfig = normalizeCreatorVideoCarouselConfig({
      maxItems: 1,
      creators: [{ ...RIFTLAB_CHANNEL, sourceMode: "all", videoSlots: 1 }],
    });
    const firstFirestore = fakeFirestore();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(atomFeed([
      ["general0001", "General upload", "2026-08-03T08:00:00Z", "No Rift topic"],
    ]), { status: 200 }));
    await getCreatorVideoCarousel(allConfig, firstFirestore.db);
    const saved = firstFirestore.read("app_cache/creator-video-carousel");

    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("offline", { status: 503 }));
    const filteredConfig = normalizeCreatorVideoCarouselConfig({
      maxItems: 1,
      creators: [{ ...RIFTLAB_CHANNEL, sourceMode: "riftbound", videoSlots: 1 }],
    });
    const secondFirestore = fakeFirestore({ "app_cache/creator-video-carousel": saved });

    const result = await getCreatorVideoCarousel(filteredConfig, secondFirestore.db);

    expect(result.videos).toEqual([]);
    expect(result.updatedAt).toBe("");
  });
});

function configForSelection(): CreatorVideoCarouselConfig {
  return normalizeCreatorVideoCarouselConfig({
    maxItems: 12,
    creators: [
      { ...RIFTLAB, videoSlots: 4 },
      creator("creator-a", 1),
      creator("creator-b", 1),
      creator("creator-c", 1),
    ],
  });
}

function creator(id: string, videoSlots: number) {
  return {
    id,
    name: id,
    spotlightId: id,
    youtubeUrl: `https://www.youtube.com/@${id.replace(/-/g, "")}`,
    channelId: "UCDQDmAPxp49TXOK9ZjLbCuA",
    sourceMode: "all" as const,
    playlistId: "",
    enabled: true,
    videoSlots,
  };
}

function video(creatorId: string, rawVideoId: string, publishedAt: string): CreatorVideo {
  const videoId = rawVideoId.padEnd(11, "x").slice(0, 11);
  return {
    videoId,
    title: `${creatorId} ${videoId}`,
    url: `https://untrusted.example/${videoId}`,
    embedUrl: "javascript:alert(1)",
    thumbnailUrl: "https://untrusted.example/thumbnail.jpg",
    creatorId,
    creatorName: "Untrusted name",
    channelUrl: "https://untrusted.example",
    publishedAt,
  };
}

function atomFeed(entries: Array<[string, string, string, string?]>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
      ${entries.map(([videoId, title, published, description = ""]) => `
        <entry>
          <yt:videoId>${videoId}</yt:videoId>
          <title>${title}</title>
          <published>${published}</published>
          <media:group>
            <media:description>${description}</media:description>
            <media:thumbnail url="https://example.test/${videoId}.jpg" />
          </media:group>
        </entry>`).join("")}
    </feed>`;
}

function fakeFirestore(initial: Record<string, unknown> = {}) {
  const documents = new Map(Object.entries(initial));
  const db = {
    collection: (collection: string) => ({
      doc: (document: string) => {
        const path = `${collection}/${document}`;
        return {
          get: async () => ({
            exists: documents.has(path),
            data: () => documents.get(path),
          }),
          set: async (value: unknown) => {
            documents.set(path, value);
          },
        };
      },
    }),
  } as unknown as Firestore;
  return {
    db,
    read: (path: string) => documents.get(path) as Record<string, unknown> | undefined,
  };
}
