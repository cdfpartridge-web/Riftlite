import { describe, expect, it } from "vitest";

import {
  DEFAULT_CREATOR_VIDEO_CAROUSEL_CONFIG,
  creatorVideoCarouselStorageFromConfig,
  normalizeCreatorVideoCarouselConfig,
  normalizeYoutubeChannelUrl,
  normalizeYoutubePlaylistId,
  youtubeChannelIdFromUrl,
} from "@/lib/youtube/creator-video-config";

describe("creator video carousel config", () => {
  it("derives video sources from the full featured-creator social catalogue", () => {
    const config = normalizeCreatorVideoCarouselConfig(undefined);

    expect(config).toEqual(DEFAULT_CREATOR_VIDEO_CAROUSEL_CONFIG);
    expect(config.creators).toHaveLength(12);
    const videoCreators = config.creators.filter((creator) => creator.youtubeUrl);
    expect(videoCreators).toHaveLength(9);
    expect(config.creators.find((creator) => creator.id === "riftlab")?.videoSlots).toBe(4);
    expect(config.creators.find((creator) => creator.id === "riftlab")?.sourceMode).toBe("all");
    expect(config.creators.find((creator) => creator.id === "winthepanda")?.sourceMode)
      .toBe("riftbound");
    expect(videoCreators.filter((creator) => creator.id !== "riftlab"))
      .toSatisfy((creators: typeof videoCreators) => creators.every((creator) => creator.videoSlots === 1));
    expect(config.creators.find((creator) => creator.id === "ritualtcg")?.youtubeUrl).toBe("");
  });

  it("normalizes bounds, direct channel URLs, and handle URLs", () => {
    const config = normalizeCreatorVideoCarouselConfig({
      enabled: false,
      rotationSeconds: 1,
      maxItems: 500,
      creators: [
        {
          id: "direct",
          name: " Direct creator ",
          spotlightId: " Direct ",
          youtubeUrl: "youtube.com/channel/UCDQDmAPxp49TXOK9ZjLbCuA?view=videos",
          enabled: false,
          videoSlots: 99,
        },
        {
          id: "handle",
          name: "Handle creator",
          youtubeUrl: "https://m.youtube.com/@RiftlabTCG/videos",
          channelId: "UCw6Qfsm4P--Bq2BPKf031SQ",
          videoSlots: 2.4,
        },
      ],
    });

    expect(config).toMatchObject({ enabled: false, rotationSeconds: 5, maxItems: 24 });
    expect(config.creators).toEqual([
      {
        id: "direct",
        name: "Direct creator",
        spotlightId: "direct",
        youtubeUrl: "https://www.youtube.com/channel/UCDQDmAPxp49TXOK9ZjLbCuA",
        channelId: "UCDQDmAPxp49TXOK9ZjLbCuA",
        enabled: false,
        videoSlots: 8,
        sourceMode: "riftbound",
        playlistId: "",
      },
      {
        id: "handle",
        name: "Handle creator",
        spotlightId: "handle",
        youtubeUrl: "https://www.youtube.com/@RiftlabTCG",
        channelId: "UCw6Qfsm4P--Bq2BPKf031SQ",
        enabled: true,
        videoSlots: 2,
        sourceMode: "riftbound",
        playlistId: "",
      },
    ]);
  });

  it("keeps the first valid creator ID and rejects unsafe sources", () => {
    const config = normalizeCreatorVideoCarouselConfig({
      creators: [
        { id: "valid", youtubeUrl: "https://www.youtube.com/@FirstOne", name: "First" },
        { id: "VALID", youtubeUrl: "https://www.youtube.com/@SecondOne", name: "Duplicate" },
        { id: "bad id", youtubeUrl: "https://www.youtube.com/@ThirdOne" },
        { id: "vimeo", youtubeUrl: "https://vimeo.com/channel/example" },
        { id: "from-id", channelId: "UCC5qY4_dp975yikMmtsdNCw", name: "Channel only" },
      ],
    });

    expect(config.creators.map((creator) => creator.id)).toEqual(["valid", "from-id"]);
    expect(config.creators[1]?.youtubeUrl)
      .toBe("https://www.youtube.com/channel/UCC5qY4_dp975yikMmtsdNCw");
  });

  it("deduplicates pin and exclusion lists with exclusions taking precedence", () => {
    const config = normalizeCreatorVideoCarouselConfig({
      excludedVideoIds: ["abcdefghijk", "bad", "abcdefghijk", "ABCDEFGHIJK"],
      includedVideoIds: ["12345678901", "abcdefghijk", "12345678901", "not-valid"],
      pinnedVideoIds: ["12345678901", "abcdefghijk", "12345678901", "not-valid"],
    });

    expect(config.excludedVideoIds).toEqual(["abcdefghijk", "ABCDEFGHIJK"]);
    expect(config.includedVideoIds).toEqual(["12345678901"]);
    expect(config.pinnedVideoIds).toEqual(["12345678901"]);
  });

  it("caps both editorial video ID lists", () => {
    const excludedVideoIds = Array.from(
      { length: 105 },
      (_, index) => `e${String(index).padStart(10, "0")}`,
    );
    const pinnedVideoIds = Array.from(
      { length: 105 },
      (_, index) => `p${String(index).padStart(10, "0")}`,
    );
    const includedVideoIds = Array.from(
      { length: 105 },
      (_, index) => `i${String(index).padStart(10, "0")}`,
    );
    const config = normalizeCreatorVideoCarouselConfig({
      excludedVideoIds,
      includedVideoIds,
      pinnedVideoIds,
    });

    expect(config.excludedVideoIds).toHaveLength(100);
    expect(config.includedVideoIds).toHaveLength(100);
    expect(config.pinnedVideoIds).toHaveLength(100);
    expect(config.excludedVideoIds.at(-1)).toBe("e0000000099");
    expect(config.includedVideoIds.at(-1)).toBe("i0000000099");
    expect(config.pinnedVideoIds.at(-1)).toBe("p0000000099");
  });

  it("normalizes playlist sources and persists feed-only creator overrides", () => {
    const config = normalizeCreatorVideoCarouselConfig({
      includedVideoIds: ["abcdefghijk"],
      creators: [{
        id: "mixed",
        name: "Mixed creator",
        youtubeUrl: "https://www.youtube.com/@MixedCreator",
        sourceMode: "playlist",
        playlistId: "https://www.youtube.com/watch?v=12345678901&list=PLQfZRuxub-RU",
        videoSlots: 2,
      }],
    });

    expect(config.creators[0]).toMatchObject({
      sourceMode: "playlist",
      playlistId: "PLQfZRuxub-RU",
    });
    expect(creatorVideoCarouselStorageFromConfig(config)).toMatchObject({
      includedVideoIds: ["abcdefghijk"],
      creators: [{
        id: "mixed",
        sourceMode: "playlist",
        playlistId: "PLQfZRuxub-RU",
        videoSlots: 2,
      }],
    });
  });

  it("accepts safe YouTube playlist IDs and URLs only", () => {
    expect(normalizeYoutubePlaylistId("PLQfZRuxub-RU")).toBe("PLQfZRuxub-RU");
    expect(normalizeYoutubePlaylistId(
      "https://www.youtube.com/playlist?list=UUDFo4wpERqN20cMxs3WzPsQ",
    )).toBe("UUDFo4wpERqN20cMxs3WzPsQ");
    expect(normalizeYoutubePlaylistId(
      "https://evil.example/playlist?list=PLQfZRuxub-RU",
    )).toBe("");
    expect(normalizeYoutubePlaylistId("https://www.youtube.com/playlist")).toBe("");
  });

  it("uses verified creator mappings and repairs the two legacy assignments", () => {
    const defaults = normalizeCreatorVideoCarouselConfig(undefined);
    expect(defaults.creators.find((creator) => creator.id === "riftlab")?.channelId)
      .toBe("UCDFo4wpERqN20cMxs3WzPsQ");
    expect(defaults.creators.find((creator) => creator.id === "daemonxgg")?.channelId)
      .toBe("UCvrYHVF7XBCnKFCAeRqlmig");

    const repaired = normalizeCreatorVideoCarouselConfig({}, [{
      id: "riftlab",
      name: "Riftlab",
      enabled: true,
      links: { youtube: "https://www.youtube.com/@RiftlabTCG" },
      channelId: "UCDQDmAPxp49TXOK9ZjLbCuA",
    }]);
    expect(repaired.creators[0]?.channelId).toBe("UCDFo4wpERqN20cMxs3WzPsQ");
  });

  it("allows an explicitly empty creator roster", () => {
    expect(normalizeCreatorVideoCarouselConfig({ creators: [] }).creators).toEqual([]);
  });

  it("keeps social links canonical while applying stored weight overrides", () => {
    const config = normalizeCreatorVideoCarouselConfig({
      creators: [{
        id: "riftlab",
        enabled: false,
        videoSlots: 7,
        youtubeUrl: "https://www.youtube.com/@WrongSource",
      }],
    }, [{
      id: "riftlab",
      name: "Riftlab",
      enabled: true,
      links: { youtube: "https://www.youtube.com/@RiftlabTCG" },
      channelId: "UCDQDmAPxp49TXOK9ZjLbCuA",
    }]);

    expect(config.creators).toEqual([expect.objectContaining({
      id: "riftlab",
      youtubeUrl: "https://www.youtube.com/@RiftlabTCG",
      enabled: false,
      videoSlots: 7,
    })]);
  });

  it("exports URL helpers for admin and ingestion callers", () => {
    expect(youtubeChannelIdFromUrl("https://youtube.com/channel/UCARZJejxRnmQ0m_tU7MgRiA"))
      .toBe("UCARZJejxRnmQ0m_tU7MgRiA");
    expect(normalizeYoutubeChannelUrl("youtube.com/@DaemonXGG/videos"))
      .toBe("https://www.youtube.com/@DaemonXGG");
    expect(normalizeYoutubeChannelUrl("https://evil.example/@DaemonXGG")).toBe("");
  });
});
