import "server-only";

import {
  normalizeLiveTakeoverConfig,
  publicLiveTakeoverFromStatus,
  type PublicLiveTakeover,
} from "@/lib/live-takeover";
import { withLiveTakeoverAnalyticsAccess } from "@/lib/live-takeover-analytics";
import { getStreamStatus } from "@/lib/twitch/status";
import type { StreamStatus } from "@/lib/types";

export async function resolvePublicLiveTakeover(
  data: Record<string, unknown> | null,
): Promise<PublicLiveTakeover> {
  const config = normalizeLiveTakeoverConfig(data?.liveTakeover);
  const fallback: StreamStatus = {
    state: "unavailable",
    isLive: false,
    tooltip: config.enabled
      ? "Twitch status unavailable"
      : "Live takeover disabled",
    channelLogin: config.channelLogin,
    channelUrl: `https://www.twitch.tv/${config.channelLogin}`,
  };
  let streamStatus = fallback;
  if (config.enabled) {
    try {
      streamStatus = await getStreamStatus(config.channelLogin);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[live-takeover] Failed to read live stream status:", message);
    }
  }
  return withLiveTakeoverAnalyticsAccess(publicLiveTakeoverFromStatus(
    config,
    streamStatus,
    data?.liveTakeoverUpdatedAt,
  ), config.analyticsRunId);
}
