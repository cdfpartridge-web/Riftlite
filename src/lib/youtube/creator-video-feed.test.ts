import { createHash } from "node:crypto";

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

const RIFTLAB = normalizeCreatorVideoCarouselConfig(undefined).creators.find((creator) => creator.id === "riftlab")!;
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

  it.each(["all", "riftbound", "playlist"] as const)(
    "filters Shorts from %s sources even when manually included and pinned",
    (sourceMode) => {
      const preview = parseYoutubeAtomFeedPreview(atomFeed([
        ["shortnew001", "Riftbound timing trap", "2026-08-04T08:00:00Z", "", [
          { href: "https://www.youtube.com/shorts/shortnew001", rel: "alternate" },
        ]],
        ["longform001", "Riftbound guide", "2026-08-03T08:00:00Z", "", [
          { href: "https://www.youtube.com/watch?v=longform001", rel: "alternate" },
        ]],
      ]), { ...RIFTLAB, sourceMode }, {
        includedVideoIds: new Set(["shortnew001"]),
        pinnedVideoIds: new Set(["shortnew001"]),
        excludedVideoIds: new Set(),
      });

      expect(preview.map((item) => [item.videoId, item.status])).toEqual([
        ["shortnew001", "filtered"],
        ["longform001", "included"],
      ]);
      expect(preview[0]?.reason).toMatch(/short/i);
    },
  );

  it("preserves manual exclusion as the preview reason for an excluded Short", () => {
    const preview = parseYoutubeAtomFeedPreview(atomFeed([
      ["shortnew001", "Riftbound timing trap", "2026-08-04T08:00:00Z", "", [
        { href: "https://www.youtube.com/shorts/shortnew001", rel: "alternate" },
      ]],
    ]), RIFTLAB, {
      includedVideoIds: new Set(["shortnew001"]),
      pinnedVideoIds: new Set(["shortnew001"]),
      excludedVideoIds: new Set(["shortnew001"]),
    });

    expect(preview[0]).toMatchObject({ status: "excluded", reason: "Hidden manually" });
  });

  it("finds a matching Shorts alternate URL among multiple Atom links", () => {
    const preview = parseYoutubeAtomFeedPreview(atomFeed([
      ["shortnew001", "Riftbound timing trap", "2026-08-04T08:00:00Z", "", [
        { href: "https://www.youtube.com/feeds/videos.xml?channel_id=example", rel: "self" },
        { href: "https://m.youtube.com/shorts/shortnew001?feature=share", rel: "alternate" },
      ]],
    ]), RIFTLAB);

    expect(preview[0]?.status).toBe("filtered");
  });

  it("keeps normal videos that discuss Shorts or link to another Short", () => {
    const videos = parseYoutubeAtomFeed(atomFeed([
      ["longform001", "How I make Riftbound Shorts", "2026-08-04T08:00:00Z",
        "#shorts Related example: https://www.youtube.com/shorts/shortnew001", [
          { href: "https://www.youtube.com/watch?v=longform001", rel: "alternate" },
          { href: "https://www.youtube.com/shorts/shortnew001", rel: "related" },
        ]],
    ]), RIFTLAB);

    expect(videos.map((item) => item.videoId)).toEqual(["longform001"]);
  });

  it.each([
    { href: "https://www.youtube.com/shorts/otherid0001", rel: "alternate" },
    { href: "https://example.test/shorts/longform001", rel: "alternate" },
    { href: "https://www.youtube.com/shorts/longform001", rel: "related" },
  ])("does not classify an unrelated Atom link as this video's format: $href ($rel)", (link) => {
    expect(parseYoutubeAtomFeed(atomFeed([
      ["longform001", "Riftbound guide", "2026-08-04T08:00:00Z", "", [link]],
    ]), RIFTLAB).map((item) => item.videoId)).toEqual(["longform001"]);
  });

  it("keeps the older long-form BMUCasts video first when newer uploads are Shorts", async () => {
    const bmu = DEFAULT_CREATOR_VIDEO_CAROUSEL_CONFIG.creators.find((item) => item.id === "bmucasts")!;
    const config = normalizeCreatorVideoCarouselConfig({
      creators: [{ ...bmu, youtubeUrl: `https://www.youtube.com/channel/${bmu.channelId}` }],
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(atomFeed([
      ["shortnew001", "Timing trap", "2026-08-04T08:00:00Z", "", [
        { href: "https://www.youtube.com/shorts/shortnew001", rel: "alternate" },
      ]],
      ["longform001", "Complete rules guide", "2026-08-03T08:00:00Z", "", [
        { href: "https://www.youtube.com/watch?v=longform001", rel: "alternate" },
      ]],
    ]), { status: 200 }));

    const result = await getCreatorVideoCarousel(config, null);

    expect(result.videos.map((item) => item.videoId)).toEqual(["longform001"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0]))
      .toBe(`https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${bmu.channelId.slice(2)}`);
  });

  it("accepts a Shorts-only playlist as successfully filtered with no carousel candidates", async () => {
    const config = normalizeCreatorVideoCarouselConfig({
      creators: [{ ...RIFTLAB_CHANNEL, sourceMode: "playlist", playlistId: "PLshortsonly" }],
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(atomFeed([
      ["shortnew001", "Riftbound timing trap", "2026-08-04T08:00:00Z", "", [
        { href: "https://www.youtube.com/shorts/shortnew001", rel: "alternate" },
      ]],
    ]), { status: 200 }));
    const firestore = fakeFirestore();

    const preview = await getCreatorVideoCarouselPreview(config);
    const result = await getCreatorVideoCarousel(config, firestore.db);

    expect(preview[0]).toMatchObject({ succeeded: true, error: "" });
    expect(preview[0]?.items[0]?.status).toBe("filtered");
    expect(result.videos).toEqual([]);
    expect(firestore.read("app_cache/creator-video-carousel")).toBeUndefined();
  });

  it("does not fall back to mixed channel uploads when the long-form feed is unavailable", async () => {
    const config = normalizeCreatorVideoCarouselConfig({ creators: [RIFTLAB_CHANNEL] });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("unavailable", { status: 404 }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await getCreatorVideoCarousel(config, null);

    expect(result.videos).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0]))
      .toBe(`https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${RIFTLAB.channelId.slice(2)}`);
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

    expect(videos).toHaveLength(18);
    expect(videos[0]?.creatorId).toBe("bmucasts");
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

  it("opens with the latest BMUCasts upload before other pins and weighted slots, without duplicating it", () => {
    const config = {
      ...configForSelection(),
      maxItems: 6,
      pinnedVideoIds: ["bbbbbbb0001", "bmulatest01"],
    };
    config.creators.push(creator("bmucasts", 1));
    const videos = selectCreatorVideos(config, [
      video("riftlab", "rift-1", "2026-08-04T08:00:00Z"),
      video("riftlab", "rift-2", "2026-08-04T07:00:00Z"),
      video("riftlab", "rift-3", "2026-08-04T06:00:00Z"),
      video("riftlab", "rift-4", "2026-08-04T05:00:00Z"),
      video("creator-b", "bbbbbbb0001", "2026-08-04T09:00:00Z"),
      video("bmucasts", "bmuolder001", "2026-08-01T07:00:00Z"),
      video("bmucasts", "bmulatest01", "2026-08-02T07:00:00Z"),
    ]);

    expect(videos.slice(0, 2).map((item) => item.videoId))
      .toEqual(["bmulatest01", "bbbbbbb0001"]);
    expect(videos).toHaveLength(6);
    expect(videos.filter((item) => item.creatorId === "bmucasts")).toHaveLength(1);
    expect(videos.filter((item) => item.creatorId === "riftlab")).toHaveLength(4);
    expect(new Set(videos.map((item) => item.videoId)).size).toBe(videos.length);
  });

  it("updates the first slot to a new BMUCasts upload without a new pinned video ID", () => {
    const config = configForSelection();
    config.creators.push(creator("bmucasts", 1));
    const candidates = [
      video("riftlab", "rift-1", "2026-08-04T08:00:00Z"),
      video("bmucasts", "bmuolder001", "2026-08-01T07:00:00Z"),
    ];

    expect(selectCreatorVideos(config, candidates)[0]?.videoId).toBe("bmuolder001");
    expect(selectCreatorVideos(config, [
      ...candidates,
      video("bmucasts", "bmulatest01", "2026-08-03T07:00:00Z"),
    ]).map((item) => item.videoId)).toEqual(["bmulatest01", "rift-1xxxxx"]);
  });

  it("uses an older eligible BMUCasts upload when the newest upload is excluded", () => {
    const config = configForSelection();
    config.creators.push(creator("bmucasts", 1));
    config.excludedVideoIds = ["bmulatest01"];
    config.pinnedVideoIds = ["bmulatest01", "bbbbbbb0001"];

    const videos = selectCreatorVideos(config, [
      video("creator-b", "bbbbbbb0001", "2026-08-04T09:00:00Z"),
      video("bmucasts", "bmuolder001", "2026-08-01T07:00:00Z"),
      video("bmucasts", "bmulatest01", "2026-08-02T07:00:00Z"),
    ]);

    expect(videos.map((item) => item.videoId)).toEqual(["bmuolder001", "bbbbbbb0001"]);
  });

  it.each(["disabled", "absent", "excluded", "unavailable"])("preserves the other pins when BMUCasts is %s", (state) => {
    const config = configForSelection();
    if (state !== "absent") {
      config.creators.push({ ...creator("bmucasts", 1), enabled: state !== "disabled" });
    }
    config.excludedVideoIds = state === "excluded" ? ["bmulatest01"] : [];
    config.pinnedVideoIds = ["bbbbbbb0001"];

    const videos = selectCreatorVideos(config, [
      video("riftlab", "rift-1", "2026-08-04T08:00:00Z"),
      video("creator-b", "bbbbbbb0001", "2026-08-04T07:00:00Z"),
      ...(state === "unavailable" ? [] : [video("bmucasts", "bmulatest01", "2026-08-02T07:00:00Z")]),
    ]);

    expect(videos.map((item) => item.videoId)).toEqual(["bbbbbbb0001", "rift-1xxxxx"]);
  });

  it("honours the carousel switch and item limit with a first BMUCasts slot", () => {
    const config = configForSelection();
    config.creators.push(creator("bmucasts", 1));
    config.maxItems = 1;
    config.pinnedVideoIds = ["bbbbbbb0001"];
    const candidates = [
      video("creator-b", "bbbbbbb0001", "2026-08-04T09:00:00Z"),
      video("bmucasts", "bmulatest01", "2026-08-02T07:00:00Z"),
    ];

    expect(selectCreatorVideos(config, candidates).map((item) => item.videoId))
      .toEqual(["bmulatest01"]);
    expect(selectCreatorVideos({ ...config, enabled: false }, candidates)).toEqual([]);
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
        if (url.includes(`playlist_id=UULF${RIFTLAB.channelId.slice(2)}`)) {
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
      .toContain("playlist_id=UULFDQDmAPxp49TXOK9ZjLbCuA");
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
      .toContain(`playlist_id=UULF${RIFTLAB.channelId.slice(2)}`);
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
      return url.includes(`UULF${RIFTLAB.channelId.slice(2)}`)
        ? new Response(atomFeed([["oldrift0001", "Old Riftlab", "2026-08-03T08:00:00Z"]]), { status: 200 })
        : new Response(atomFeed([["oldother001", "Old other", "2026-08-03T07:00:00Z"]]), { status: 200 });
    });
    await getCreatorVideoCarousel(config, firstFirestore.db);
    const saved = firstFirestore.read("app_cache/creator-video-carousel");

    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      return url.includes(`UULF${RIFTLAB.channelId.slice(2)}`)
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

  it("does not resurrect a legacy mixed-upload snapshot when long-form feeds fail", async () => {
    const config = normalizeCreatorVideoCarouselConfig({
      maxItems: 1,
      creators: [{ ...RIFTLAB_CHANNEL, videoSlots: 1 }],
    });
    // The source key shipped before long-form filtering had no format-policy version.
    const legacySourceKey = createHash("sha256").update(JSON.stringify({
      maxItems: config.maxItems,
      excludedVideoIds: config.excludedVideoIds,
      includedVideoIds: config.includedVideoIds,
      pinnedVideoIds: config.pinnedVideoIds,
      creators: config.creators.map((item) => ({
        id: item.id,
        youtubeUrl: item.youtubeUrl,
        channelId: item.channelId,
        sourceMode: item.sourceMode,
        playlistId: item.playlistId,
        videoSlots: item.videoSlots,
      })),
    })).digest("hex");
    const firestore = fakeFirestore({
      "app_cache/creator-video-carousel": {
        sourceKey: legacySourceKey,
        videos: [video("riftlab", "shortnew001", "2026-08-03T08:00:00Z")],
        updatedAt: "2026-08-03T09:00:00.000Z",
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("offline", { status: 503 }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await getCreatorVideoCarousel(config, firestore.db);

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

function atomFeed(entries: Array<[
  string,
  string,
  string,
  string?,
  Array<{ href: string; rel?: string }>?,
]>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
      ${entries.map(([videoId, title, published, description = "", links = []]) => `
        <entry>
          <yt:videoId>${videoId}</yt:videoId>
          <title>${title}</title>
          <published>${published}</published>
          ${links.map((link) => `<link${link.rel ? ` rel="${link.rel}"` : ""} href="${link.href}" />`).join("")}
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
