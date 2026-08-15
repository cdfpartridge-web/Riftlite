import type { StreamStatus } from "@/lib/types";

export const DEFAULT_LIVE_TAKEOVER_CONFIG = {
  enabled: false,
  provider: "twitch",
  channelLogin: "bmucasts",
  title: "BMU Casts is live",
} as const satisfies LiveTakeoverConfig;

export type LiveTakeoverProvider = "twitch";

export type LiveTakeoverConfig = {
  enabled: boolean;
  provider: LiveTakeoverProvider;
  channelLogin: string;
  title: string;
  /** Server-owned identifier for one armed takeover run. */
  analyticsRunId?: string;
};

export type LiveTakeoverAnalyticsAccess = {
  runId: string;
  token: string;
};

export type PublicLiveTakeover = Omit<LiveTakeoverConfig, "analyticsRunId"> & {
  active: boolean;
  status: StreamStatus["state"] | "disabled";
  channelUrl: string;
  updatedAt?: number;
  analytics?: LiveTakeoverAnalyticsAccess;
};

const TWITCH_LOGIN_PATTERN = /^[a-z0-9_]{4,25}$/;
const ANALYTICS_RUN_ID_PATTERN = /^[a-zA-Z0-9_-]{16,80}$/;
const MAX_TITLE_LENGTH = 120;

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeTwitchChannelLogin(value: unknown): string {
  if (typeof value !== "string") return "";
  const login = value.trim().toLowerCase();
  return TWITCH_LOGIN_PATTERN.test(login) ? login : "";
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_LIVE_TAKEOVER_CONFIG.title;
  const title = value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
  return title || DEFAULT_LIVE_TAKEOVER_CONFIG.title;
}

/**
 * Reduces stored or submitted data to the small provider-owned configuration
 * that desktop clients may trust. In particular, URLs and embed HTML are
 * deliberately never accepted from Firestore or Meta Studio.
 */
export function normalizeLiveTakeoverConfig(value: unknown): LiveTakeoverConfig {
  const data = recordFrom(value);
  const normalizedChannel = normalizeTwitchChannelLogin(data.channelLogin);
  const providerSupported = data.provider === undefined || data.provider === "twitch";
  const channelSupported = data.channelLogin === undefined || Boolean(normalizedChannel);
  const analyticsRunId = typeof data.analyticsRunId === "string"
    && ANALYTICS_RUN_ID_PATTERN.test(data.analyticsRunId.trim())
    ? data.analyticsRunId.trim()
    : "";
  return {
    enabled: data.enabled === true && providerSupported && channelSupported,
    provider: "twitch",
    channelLogin: normalizedChannel
      || DEFAULT_LIVE_TAKEOVER_CONFIG.channelLogin,
    title: normalizeTitle(data.title),
    ...(analyticsRunId ? { analyticsRunId } : {}),
  };
}

export function liveTakeoverStorageFromConfig(
  value: unknown,
): LiveTakeoverConfig {
  const config = normalizeLiveTakeoverConfig(value);
  return {
    enabled: config.enabled,
    provider: config.provider,
    channelLogin: config.channelLogin,
    title: config.title,
    ...(config.analyticsRunId ? { analyticsRunId: config.analyticsRunId } : {}),
  };
}

export function publicLiveTakeoverFromStatus(
  value: unknown,
  streamStatus: StreamStatus,
  updatedAt?: unknown,
): PublicLiveTakeover {
  const config = normalizeLiveTakeoverConfig(value);
  const publicConfig = {
    enabled: config.enabled,
    provider: config.provider,
    channelLogin: config.channelLogin,
    title: config.title,
  };
  const isConfiguredChannel = streamStatus.channelLogin === config.channelLogin;
  const isLive = isConfiguredChannel && streamStatus.state === "live" && streamStatus.isLive;
  const normalizedUpdatedAt = typeof updatedAt === "number"
    && Number.isFinite(updatedAt)
    && updatedAt > 0
    ? Math.trunc(updatedAt)
    : undefined;
  return {
    ...publicConfig,
    active: config.enabled && isLive,
    status: config.enabled
      ? isConfiguredChannel ? streamStatus.state : "unavailable"
      : "disabled",
    channelUrl: `https://www.twitch.tv/${config.channelLogin}`,
    ...(normalizedUpdatedAt ? { updatedAt: normalizedUpdatedAt } : {}),
  };
}
