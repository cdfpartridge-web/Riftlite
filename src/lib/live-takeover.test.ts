import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIVE_TAKEOVER_CONFIG,
  liveTakeoverStorageFromConfig,
  normalizeLiveTakeoverConfig,
  publicLiveTakeoverFromStatus,
} from "@/lib/live-takeover";

describe("live takeover configuration", () => {
  it("uses a safe, disabled BMU Twitch default", () => {
    expect(normalizeLiveTakeoverConfig(null)).toEqual(DEFAULT_LIVE_TAKEOVER_CONFIG);
  });

  it("normalizes only supported provider-owned fields", () => {
    expect(liveTakeoverStorageFromConfig({
      enabled: true,
      provider: "youtube",
      channelLogin: "  BMUCasts  ",
      title: "  Sunday   community\nstream  ",
      embedUrl: "https://evil.example/player",
      html: "<iframe src='https://evil.example'>",
    })).toEqual({
      enabled: false,
      provider: "twitch",
      channelLogin: "bmucasts",
      title: "Sunday community stream",
    });
  });

  it("falls back from invalid channels and empty or overlong titles", () => {
    const config = normalizeLiveTakeoverConfig({
      enabled: "true",
      channelLogin: "not/a/channel",
      title: "x".repeat(140),
    });

    expect(config.enabled).toBe(false);
    expect(config.channelLogin).toBe("bmucasts");
    expect(config.title).toHaveLength(120);
    expect(normalizeLiveTakeoverConfig({ channelLogin: "abc" }).channelLogin)
      .toBe("bmucasts");
    expect(normalizeLiveTakeoverConfig({
      enabled: true,
      channelLogin: "not/a/channel",
    }).enabled).toBe(false);
  });

  it("activates only when both the master switch and Twitch status are live", () => {
    const liveStatus = {
      state: "live" as const,
      isLive: true,
      tooltip: "bmucasts is live on Twitch",
      channelLogin: "bmucasts",
      channelUrl: "https://www.twitch.tv/bmucasts",
    };

    expect(publicLiveTakeoverFromStatus({ enabled: true }, liveStatus)).toMatchObject({
      enabled: true,
      active: true,
      status: "live",
    });
    expect(publicLiveTakeoverFromStatus({ enabled: false }, liveStatus)).toMatchObject({
      active: false,
      status: "disabled",
    });
    expect(publicLiveTakeoverFromStatus({
      enabled: true,
      channelLogin: "someone_else",
    }, liveStatus)).toMatchObject({
      active: false,
      status: "unavailable",
      channelUrl: "https://www.twitch.tv/someone_else",
    });
  });

  it("publishes only a valid audit timestamp", () => {
    const offlineStatus = {
      state: "offline" as const,
      isLive: false,
      tooltip: "bmucasts is offline on Twitch",
      channelLogin: "bmucasts",
      channelUrl: "https://www.twitch.tv/bmucasts",
    };

    expect(publicLiveTakeoverFromStatus({ enabled: true }, offlineStatus, 1234.9))
      .toMatchObject({ status: "offline", updatedAt: 1234 });
    expect(publicLiveTakeoverFromStatus({ enabled: true }, offlineStatus, "1234"))
      .not.toHaveProperty("updatedAt");
  });
});
