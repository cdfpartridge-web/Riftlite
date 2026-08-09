import "server-only";

import { unstable_cache } from "next/cache";

import { normalizeTwitchChannelLogin } from "@/lib/live-takeover";
import type { StreamStatus } from "@/lib/types";

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const STREAMS_URL = "https://api.twitch.tv/helix/streams";
const STATUS_CACHE_SECONDS = 15;
const REQUEST_TIMEOUT_MS = 2_000;
export const TWITCH_STATUS_CACHE_TAG = "twitch-status";

let cachedToken: { token: string; expiresAt: number } | null = null;

function getTwitchConfig(channelLoginOverride?: string) {
  const environmentChannel = normalizeTwitchChannelLogin(
    process.env.TWITCH_CHANNEL_LOGIN,
  ) || "bmucasts";
  return {
    clientId: process.env.TWITCH_CLIENT_ID ?? "",
    clientSecret: process.env.TWITCH_CLIENT_SECRET ?? "",
    channelLogin: normalizeTwitchChannelLogin(channelLoginOverride)
      || environmentChannel,
  };
}

async function getAppToken(clientId: string, clientSecret: string) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Token request failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  const token = data.access_token ?? "";
  const expiresIn = data.expires_in ?? 3600;
  cachedToken = {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return token;
}

async function getHelixStreamResponse(
  clientId: string,
  clientSecret: string,
  channelLogin: string,
  allowTokenRetry = true,
): Promise<Response> {
  const token = await getAppToken(clientId, clientSecret);
  const response = await fetch(
    `${STREAMS_URL}?${new URLSearchParams({ user_login: channelLogin })}`,
    {
      headers: {
        "Client-Id": clientId,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (response.status === 401 && allowTokenRetry) {
    cachedToken = null;
    return getHelixStreamResponse(clientId, clientSecret, channelLogin, false);
  }
  return response;
}

async function fetchStreamStatus(channelLoginOverride?: string): Promise<StreamStatus> {
  const { clientId, clientSecret, channelLogin } = getTwitchConfig(channelLoginOverride);
  const channelUrl = `https://www.twitch.tv/${channelLogin}`;

  if (!clientId || !clientSecret) {
    return {
      state: "unavailable",
      isLive: false,
      tooltip: "Twitch status unavailable - add Twitch env vars",
      channelLogin,
      channelUrl,
    };
  }

  try {
    const response = await getHelixStreamResponse(
      clientId,
      clientSecret,
      channelLogin,
    );

    if (!response.ok) {
      throw new Error(`Streams request failed: ${response.status}`);
    }

    const data = (await response.json()) as { data?: unknown[] };
    if (!Array.isArray(data.data)) {
      throw new Error("Streams response was malformed");
    }
    const isLive = data.data.length > 0;
    if (isLive) {
      const item = data.data[0];
      const stream = item && typeof item === "object" && !Array.isArray(item)
        ? item as Record<string, unknown>
        : null;
      const confirmed = stream
        && normalizeTwitchChannelLogin(stream.user_login) === channelLogin
        && stream.type === "live"
        && typeof stream.id === "string"
        && Boolean(stream.id.trim())
        && typeof stream.started_at === "string"
        && Number.isFinite(Date.parse(stream.started_at));
      if (!confirmed) {
        throw new Error("Streams response did not confirm the requested live channel");
      }
    }
    return {
      state: isLive ? "live" : "offline",
      isLive,
      tooltip: isLive
        ? `${channelLogin} is live on Twitch`
        : `${channelLogin} is offline on Twitch`,
      channelLogin,
      channelUrl,
    };
  } catch {
    return {
      state: "unavailable",
      isLive: false,
      tooltip: "Twitch status unavailable",
      channelLogin,
      channelUrl,
    };
  }
}

const cachedStreamStatus = unstable_cache(fetchStreamStatus, ["twitch-stream-status-v2"], {
  revalidate: STATUS_CACHE_SECONDS,
  tags: [TWITCH_STATUS_CACHE_TAG],
});

export async function getStreamStatus(channelLogin?: string): Promise<StreamStatus> {
  try {
    return await cachedStreamStatus(channelLogin);
  } catch {
    // unstable_cache throws outside a Next.js request context (vitest).
    return fetchStreamStatus(channelLogin);
  }
}
