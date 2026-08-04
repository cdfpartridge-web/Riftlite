export type CreatorVideoCreatorConfig = {
  id: string;
  name: string;
  spotlightId: string;
  youtubeUrl: string;
  channelId: string;
  enabled: boolean;
  videoSlots: number;
};

export type CommunitySpotlightVideoProfile = {
  id: string;
  name: string;
  enabled: boolean;
  links: {
    youtube: string;
  };
  channelId: string;
};

export type CreatorVideoCarouselConfig = {
  enabled: boolean;
  rotationSeconds: number;
  maxItems: number;
  excludedVideoIds: string[];
  pinnedVideoIds: string[];
  creators: CreatorVideoCreatorConfig[];
};

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const CREATOR_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const YOUTUBE_HANDLE_PATTERN = /^@[A-Za-z0-9._-]{3,100}$/;

const DEFAULT_ROTATION_SECONDS = 10;
const DEFAULT_MAX_ITEMS = 12;
const MIN_ROTATION_SECONDS = 5;
const MAX_ROTATION_SECONDS = 120;
const MIN_MAX_ITEMS = 1;
const MAX_MAX_ITEMS = 24;
const MIN_VIDEO_SLOTS = 1;
const MAX_VIDEO_SLOTS = 8;
const MAX_VIDEO_ID_LIST_ITEMS = 100;

export const CREATOR_VIDEO_FEED_CACHE_TAG = "youtube-creator-videos";

export const DEFAULT_COMMUNITY_SPOTLIGHT_VIDEO_PROFILES: CommunitySpotlightVideoProfile[] = [
  spotlight("riftlab", "Riftlab", "https://www.youtube.com/@RiftlabTCG", "UCDQDmAPxp49TXOK9ZjLbCuA"),
  spotlight("runesandrift", "Runes & Rift", "https://www.youtube.com/@RunesAndRift", "UCw6Qfsm4P--Bq2BPKf031SQ"),
  spotlight("challengertcg", "Challenger TCG", "https://www.youtube.com/@ChallengerTCG", "UCC5qY4_dp975yikMmtsdNCw"),
  spotlight("noveggies", "NoVeggies"),
  spotlight("dunc", "Dunc", "https://www.youtube.com/@dunctcg", "UCiM8nhAwh94QqH9qm9yjKYA"),
  spotlight("ritualtcg", "Ritual_TCG"),
  spotlight("winthepanda", "WinThePanda", "https://www.youtube.com/channel/UCRC9Y9QDdw-8OpZcehO42pg", "UCRC9Y9QDdw-8OpZcehO42pg"),
  spotlight("agitoswiftly", "AgitoSwiftly", "https://www.youtube.com/@AgitoswiftlyIsRiftbound", "UCoGg-z_wT5LUl-HKj53zN7w"),
  spotlight("mrtoolshed", "Mrtoolshed"),
  spotlight("daemonxgg", "DaemonXGG", "https://www.youtube.com/@DaemonXGG", "UCARZJejxRnmQ0m_tU7MgRiA"),
  spotlight("maskedswan", "MaskedSwan", "https://www.youtube.com/@MaskedSwanRiftbound", "UCbpB82os6Y9LEXIpSl6FaGA"),
  spotlight("arg0ntcg", "Arg0n", "https://www.youtube.com/@arg0nTCG", "UCpVmfDlTNEZJ3T41Lgixu1A"),
];

export const DEFAULT_CREATOR_VIDEO_CAROUSEL_CONFIG: CreatorVideoCarouselConfig = {
  enabled: true,
  rotationSeconds: DEFAULT_ROTATION_SECONDS,
  maxItems: DEFAULT_MAX_ITEMS,
  excludedVideoIds: [],
  pinnedVideoIds: [],
  creators: creatorConfigsFromSpotlights(DEFAULT_COMMUNITY_SPOTLIGHT_VIDEO_PROFILES),
};

export function normalizeYoutubeVideoId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().match(YOUTUBE_VIDEO_ID_PATTERN)?.[0] ?? "";
}

export function normalizeYoutubeChannelId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().match(YOUTUBE_CHANNEL_ID_PATTERN)?.[0] ?? "";
}

export function youtubeChannelIdFromUrl(value: unknown): string {
  const url = parseYoutubeUrl(value);
  if (!url) return "";
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0]?.toLowerCase() !== "channel") return "";
  return normalizeYoutubeChannelId(parts[1]);
}

export function normalizeYoutubeChannelUrl(value: unknown): string {
  const url = parseYoutubeUrl(value);
  if (!url) return "";
  const parts = url.pathname.split("/").filter(Boolean);
  const first = parts[0] ?? "";
  if (first.toLowerCase() === "channel") {
    const channelId = normalizeYoutubeChannelId(parts[1]);
    return channelId ? `https://www.youtube.com/channel/${channelId}` : "";
  }
  if (YOUTUBE_HANDLE_PATTERN.test(first)) {
    return `https://www.youtube.com/${first}`;
  }
  return "";
}

export function normalizeCommunitySpotlightVideoProfiles(
  value: unknown,
): CommunitySpotlightVideoProfile[] {
  const values = Array.isArray(value)
    ? value
    : DEFAULT_COMMUNITY_SPOTLIGHT_VIDEO_PROFILES;
  const profiles: CommunitySpotlightVideoProfile[] = [];
  const seen = new Set<string>();
  for (const item of values.slice(0, 40)) {
    const profile = normalizeCommunitySpotlightVideoProfile(item);
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    profiles.push(profile);
  }
  return profiles;
}

export function normalizeCreatorVideoCarouselConfig(
  value: unknown,
  spotlightProfiles?: unknown,
): CreatorVideoCarouselConfig {
  const payload = recordValue(value);
  const defaults = DEFAULT_CREATOR_VIDEO_CAROUSEL_CONFIG;
  const excludedVideoIds = normalizeVideoIdList(payload?.excludedVideoIds);
  const excludedSet = new Set(excludedVideoIds);
  const pinnedVideoIds = normalizeVideoIdList(payload?.pinnedVideoIds)
    .filter((videoId) => !excludedSet.has(videoId));
  const profileSource = spotlightProfiles === undefined
    ? Array.isArray(payload?.creators)
      ? payload.creators
      : DEFAULT_COMMUNITY_SPOTLIGHT_VIDEO_PROFILES
    : spotlightProfiles;
  const profiles = normalizeCommunitySpotlightVideoProfiles(profileSource);
  const overrides = creatorOverrides(payload?.creators);
  const creators = creatorConfigsFromSpotlights(profiles, overrides);

  return {
    enabled: typeof payload?.enabled === "boolean" ? payload.enabled : defaults.enabled,
    rotationSeconds: boundedInteger(
      payload?.rotationSeconds,
      defaults.rotationSeconds,
      MIN_ROTATION_SECONDS,
      MAX_ROTATION_SECONDS,
    ),
    maxItems: boundedInteger(
      payload?.maxItems,
      defaults.maxItems,
      MIN_MAX_ITEMS,
      MAX_MAX_ITEMS,
    ),
    excludedVideoIds,
    pinnedVideoIds,
    creators,
  };
}

export function communitySpotlightVideoProfilesFromConfig(
  config: CreatorVideoCarouselConfig,
): CommunitySpotlightVideoProfile[] {
  return config.creators.map((creator) => ({
    id: creator.id,
    name: creator.name,
    enabled: creator.enabled,
    links: { youtube: creator.youtubeUrl },
    channelId: creator.channelId,
  }));
}

export function creatorVideoCarouselStorageFromConfig(
  config: CreatorVideoCarouselConfig,
) {
  return {
    enabled: config.enabled,
    rotationSeconds: config.rotationSeconds,
    maxItems: config.maxItems,
    excludedVideoIds: [...config.excludedVideoIds],
    pinnedVideoIds: [...config.pinnedVideoIds],
    creators: config.creators.map((creator) => ({
      id: creator.id,
      enabled: creator.enabled,
      videoSlots: creator.videoSlots,
    })),
  };
}

function creatorConfigsFromSpotlights(
  profiles: CommunitySpotlightVideoProfile[],
  overrides = new Map<string, { enabled?: boolean; videoSlots?: number }>(),
): CreatorVideoCreatorConfig[] {
  return profiles.map((profile) => {
    const override = overrides.get(profile.id);
    return {
      id: profile.id,
      name: profile.name,
      spotlightId: profile.id,
      youtubeUrl: profile.links.youtube,
      channelId: profile.channelId,
      enabled: override?.enabled ?? profile.enabled,
      videoSlots: boundedInteger(
        override?.videoSlots,
        profile.id === "riftlab" ? 4 : 1,
        MIN_VIDEO_SLOTS,
        MAX_VIDEO_SLOTS,
      ),
    };
  });
}

function normalizeCommunitySpotlightVideoProfile(
  value: unknown,
): CommunitySpotlightVideoProfile | null {
  const payload = recordValue(value);
  if (!payload) return null;
  const id = cleanText(payload.id, 40).toLowerCase();
  if (!CREATOR_ID_PATTERN.test(id)) return null;
  const links = recordValue(payload.links);
  const explicitChannelId = normalizeYoutubeChannelId(payload.channelId);
  const rawYoutubeUrl = payload.youtubeUrl ?? links?.youtube;
  let youtubeUrl = normalizeYoutubeChannelUrl(rawYoutubeUrl);
  const urlChannelId = youtubeChannelIdFromUrl(youtubeUrl);
  const channelId = explicitChannelId || urlChannelId;
  if (typeof rawYoutubeUrl === "string" && rawYoutubeUrl.trim() && !youtubeUrl && !channelId) {
    return null;
  }
  if (!youtubeUrl && channelId) {
    youtubeUrl = `https://www.youtube.com/channel/${channelId}`;
  }
  const name = cleanText(payload.name, 100) || id;
  return {
    id,
    name,
    links: { youtube: youtubeUrl },
    channelId,
    enabled: typeof payload.enabled === "boolean" ? payload.enabled : true,
  };
}

function creatorOverrides(value: unknown) {
  const result = new Map<string, { enabled?: boolean; videoSlots?: number }>();
  if (!Array.isArray(value)) return result;
  for (const item of value.slice(0, 40)) {
    const payload = recordValue(item);
    const id = cleanText(payload?.id, 40).toLowerCase();
    if (!payload || !CREATOR_ID_PATTERN.test(id) || result.has(id)) continue;
    result.set(id, {
      enabled: typeof payload.enabled === "boolean" ? payload.enabled : undefined,
      videoSlots: typeof payload.videoSlots === "number" ? payload.videoSlots : undefined,
    });
  }
  return result;
}

function normalizeVideoIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const id = normalizeYoutubeVideoId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_VIDEO_ID_LIST_ITEMS) break;
  }
  return ids;
}

function parseYoutubeUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" || !["youtube.com", "m.youtube.com"].includes(host)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function spotlight(
  id: string,
  name: string,
  youtube = "",
  channelId = "",
): CommunitySpotlightVideoProfile {
  return {
    id,
    name,
    enabled: true,
    links: { youtube },
    channelId,
  };
}
