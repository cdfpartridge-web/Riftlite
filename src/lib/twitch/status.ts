import "server-only";

import { unstable_cache } from "next/cache";

import type { StreamStatus } from "@/lib/types";

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const STREAMS_URL = "https://api.twitch.tv/helix/streams";
const STATUS_CACHE_SECONDS = 60;

let cachedToken: { token: string; expiresAt: number } | null = null;

function getTwitchConfig() {
  return {
    clientId: process.env.TWITCH_CLIENT_ID ?? "",
    clientSecret: process.env.TWITCH_CLIENT_SECRET ?? "",
    channelLogin: process.env.TWITCH_CHANNEL_LOGIN ?? "bmucasts",
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

async function fetchStreamStatus(): Promise<StreamStatus> {
  const { clientId, clientSecret, channelLogin } = getTwitchConfig();
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
    const token = await getAppToken(clientId, clientSecret);
    const response = await fetch(
      `${STREAMS_URL}?${new URLSearchParams({ user_login: channelLogin })}`,
      {
        headers: {
          "Client-Id": clientId,
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      throw new Error(`Streams request failed: ${response.status}`);
    }

    const data = (await response.json()) as { data?: unknown[] };
    const isLive = Array.isArray(data.data) && data.data.length > 0;
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

const cachedStreamStatus = unstable_cache(fetchStreamStatus, ["twitch-stream-status-v1"], {
  revalidate: STATUS_CACHE_SECONDS,
  tags: ["twitch-status"],
});

export async function getStreamStatus(): Promise<StreamStatus> {
  try {
    return await cachedStreamStatus();
  } catch {
    // unstable_cache throws outside a Next.js request context (vitest).
    return fetchStreamStatus();
  }
}
