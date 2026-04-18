import "server-only";

import { TWITCH_STATUS_CACHE_MS } from "@/lib/constants";
import type { StreamStatus } from "@/lib/types";

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const STREAMS_URL = "https://api.twitch.tv/helix/streams";

let cachedToken: { token: string; expiresAt: number } | null = null;
let cachedStatus: { value: StreamStatus; fetchedAt: number } | null = null;

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

export async function getStreamStatus(): Promise<StreamStatus> {
  if (cachedStatus && Date.now() - cachedStatus.fetchedAt < TWITCH_STATUS_CACHE_MS) {
    return cachedStatus.value;
  }

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
    const value: StreamStatus = {
      state: Array.isArray(data.data) && data.data.length > 0 ? "live" : "offline",
      isLive: Array.isArray(data.data) && data.data.length > 0,
      tooltip:
        Array.isArray(data.data) && data.data.length > 0
          ? `${channelLogin} is live on Twitch`
          : `${channelLogin} is offline on Twitch`,
      channelLogin,
      channelUrl,
    };

    cachedStatus = { value, fetchedAt: Date.now() };
    return value;
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
