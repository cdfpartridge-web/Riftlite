import "server-only";

import { createHash } from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";
import { XMLParser } from "fast-xml-parser";

import {
  CREATOR_VIDEO_FEED_CACHE_TAG,
  type CreatorVideoCarouselConfig,
  type CreatorVideoCreatorConfig,
  type CreatorVideoSourceMode,
  normalizeYoutubeChannelId,
  normalizeYoutubeVideoId,
  youtubeChannelIdFromUrl,
} from "@/lib/youtube/creator-video-config";

export type CreatorVideo = {
  videoId: string;
  title: string;
  url: string;
  embedUrl: string;
  thumbnailUrl: string;
  creatorId: string;
  creatorName: string;
  channelUrl: string;
  publishedAt: string;
};

export type CreatorVideoCarouselResult = {
  videos: CreatorVideo[];
  updatedAt: string;
};

export type CreatorVideoPreviewItem = CreatorVideo & {
  status: "included" | "filtered" | "excluded";
  reason: string;
};

export type CreatorVideoCreatorPreview = {
  creatorId: string;
  creatorName: string;
  sourceMode: CreatorVideoSourceMode;
  playlistId: string;
  succeeded: boolean;
  error: string;
  items: CreatorVideoPreviewItem[];
};

type CreatorFeedOutcome = {
  creatorId: string;
  succeeded: boolean;
  videos: CreatorVideo[];
  preview: CreatorVideoPreviewItem[];
  error: string;
};

type CreatorVideoFilterPolicy = {
  includedVideoIds: ReadonlySet<string>;
  pinnedVideoIds: ReadonlySet<string>;
  excludedVideoIds: ReadonlySet<string>;
};

type CreatorVideoSnapshot = {
  sourceKey: string;
  videos: CreatorVideo[];
  updatedAt: string;
};

const YOUTUBE_FEED_URL = "https://www.youtube.com/feeds/videos.xml";
const SNAPSHOT_COLLECTION = "app_cache";
const SNAPSHOT_DOCUMENT = "creator-video-carousel";
const FEED_CACHE_SECONDS = 1800;
const HANDLE_CACHE_SECONDS = 3600;
const FETCH_TIMEOUT_MS = 6_000;
const MAX_FEED_ITEMS_PER_CREATOR = 15;
const MAX_FEED_RESPONSE_BYTES = 1_000_000;
const MAX_CHANNEL_RESPONSE_BYTES = 5_000_000;
const RIFTBOUND_TOPIC_PATTERN = /(?:^|[^a-z0-9])(?:rift\s*bound|riftbound(?:tcg|s)?|playriftbound)(?:$|[^a-z0-9])/i;

const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
});

export async function getCreatorVideoCarousel(
  config: CreatorVideoCarouselConfig,
  db: Firestore | null,
): Promise<CreatorVideoCarouselResult> {
  const creators = eligibleVideoCreators(config);
  if (!config.enabled || !creators.length) {
    return { videos: [], updatedAt: "" };
  }

  const sourceKey = creatorSourceKey(config, creators);
  const filterPolicy = creatorVideoFilterPolicy(config);
  const snapshotPromise = readSnapshot(db, sourceKey, creators);
  const outcomesPromise = Promise.all(creators.map((creator) =>
    fetchCreatorFeedSafely(creator, filterPolicy)));
  const [snapshot, outcomes] = await Promise.all([snapshotPromise, outcomesPromise]);
  const staleByCreator = groupVideosByCreator(snapshot?.videos ?? []);
  const combined: CreatorVideo[] = [];
  let successfulFeeds = 0;

  for (const outcome of outcomes) {
    if (outcome.succeeded) {
      successfulFeeds += 1;
      combined.push(...outcome.videos);
    } else {
      combined.push(...(staleByCreator.get(outcome.creatorId) ?? []));
    }
  }

  const videos = selectCreatorVideos(config, combined);
  if (!successfulFeeds) {
    return {
      videos,
      updatedAt: videos.length ? snapshot?.updatedAt ?? "" : "",
    };
  }

  const updatedAt = new Date().toISOString();
  if (videos.length) {
    await writeSnapshot(db, { sourceKey, videos, updatedAt });
  }
  return { videos, updatedAt };
}

export async function getCreatorVideoCarouselPreview(
  config: CreatorVideoCarouselConfig,
): Promise<CreatorVideoCreatorPreview[]> {
  const creators = eligibleVideoCreators(config);
  const filterPolicy = creatorVideoFilterPolicy(config);
  const outcomes = await Promise.all(creators.map((creator) =>
    fetchCreatorFeedSafely(creator, filterPolicy)));
  const creatorById = new Map(creators.map((creator) => [creator.id, creator]));
  return outcomes.map((outcome) => {
    const creator = creatorById.get(outcome.creatorId)!;
    return {
      creatorId: creator.id,
      creatorName: creator.name,
      sourceMode: creator.sourceMode,
      playlistId: creator.playlistId,
      succeeded: outcome.succeeded,
      error: outcome.error,
      items: outcome.preview,
    };
  });
}

export function parseYoutubeAtomFeed(
  xml: string,
  creator: CreatorVideoCreatorConfig,
  filterPolicy: CreatorVideoFilterPolicy = emptyCreatorVideoFilterPolicy(),
): CreatorVideo[] {
  return parseYoutubeAtomFeedPreview(xml, creator, filterPolicy)
    .filter((item) => item.status === "included")
    .map(previewItemVideo);
}

export function parseYoutubeAtomFeedPreview(
  xml: string,
  creator: CreatorVideoCreatorConfig,
  filterPolicy: CreatorVideoFilterPolicy = emptyCreatorVideoFilterPolicy(),
): CreatorVideoPreviewItem[] {
  let parsed: unknown;
  try {
    parsed = XML_PARSER.parse(xml);
  } catch {
    return [];
  }
  const feed = recordValue(recordValue(parsed)?.feed);
  const rawEntries = arrayValue(feed?.entry);
  const videos: CreatorVideoPreviewItem[] = [];
  const seen = new Set<string>();

  for (const rawEntry of rawEntries) {
    const entry = recordValue(rawEntry);
    if (!entry) continue;
    const videoId = normalizeYoutubeVideoId(textValue(entry.videoId));
    if (!videoId || seen.has(videoId)) continue;
    const publishedAt = normalizePublishedAt(entry.published);
    if (!publishedAt) continue;
    const title = cleanText(textValue(entry.title), 300) || "Riftbound video";
    const mediaGroup = recordValue(entry.group);
    const description = cleanText(textValue(mediaGroup?.description ?? entry.description), 5_000);
    const decision = creatorVideoFilterDecision(
      creator,
      videoId,
      `${title}\n${description}`,
      filterPolicy,
    );
    seen.add(videoId);
    videos.push({
      ...creatorVideoFromFields(videoId, title, publishedAt, creator),
      ...decision,
    });
    if (videos.length >= MAX_FEED_ITEMS_PER_CREATOR) break;
  }

  return videos.sort(compareCreatorVideos);
}

export function youtubeChannelIdFromHtml(html: string): string {
  const patterns = [
    /<meta\s+[^>]*itemprop=["']channelId["'][^>]*content=["'](UC[A-Za-z0-9_-]{22})["'][^>]*>/i,
    /<meta\s+[^>]*content=["'](UC[A-Za-z0-9_-]{22})["'][^>]*itemprop=["']channelId["'][^>]*>/i,
    /["'](?:channelId|externalId|browseId)["']\s*:\s*["'](UC[A-Za-z0-9_-]{22})["']/,
    /https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/i,
  ];
  for (const pattern of patterns) {
    const channelId = normalizeYoutubeChannelId(html.match(pattern)?.[1]);
    if (channelId) return channelId;
  }
  return "";
}

export function selectCreatorVideos(
  config: CreatorVideoCarouselConfig,
  candidates: CreatorVideo[],
): CreatorVideo[] {
  if (!config.enabled || config.maxItems <= 0) return [];
  const enabledCreators = config.creators.filter((creator) => creator.enabled);
  const creatorById = new Map(enabledCreators.map((creator) => [creator.id, creator]));
  const excluded = new Set(config.excludedVideoIds);
  const unique = new Map<string, CreatorVideo>();

  for (const candidate of [...candidates].sort(compareCreatorVideos)) {
    const creator = creatorById.get(candidate.creatorId);
    if (!creator || excluded.has(candidate.videoId) || unique.has(candidate.videoId)) continue;
    const normalized = normalizeCreatorVideo(candidate, creator);
    if (normalized) unique.set(normalized.videoId, normalized);
  }

  const selected: CreatorVideo[] = [];
  const selectedIds = new Set<string>();
  const pinnedCounts = new Map<string, number>();
  for (const videoId of config.pinnedVideoIds) {
    const video = unique.get(videoId);
    if (!video || selectedIds.has(video.videoId)) continue;
    selected.push(video);
    selectedIds.add(video.videoId);
    pinnedCounts.set(video.creatorId, (pinnedCounts.get(video.creatorId) ?? 0) + 1);
    if (selected.length >= config.maxItems) return selected;
  }

  const queues = enabledCreators.map((creator) => {
    const available = [...unique.values()]
      .filter((video) => video.creatorId === creator.id && !selectedIds.has(video.videoId))
      .sort(compareCreatorVideos);
    const allowance = Math.max(0, creator.videoSlots - (pinnedCounts.get(creator.id) ?? 0));
    return {
      creatorId: creator.id,
      videos: available.slice(0, allowance),
      used: 0,
    };
  }).filter((queue) => queue.videos.length > 0);

  const totalAllocation = queues.reduce((sum, queue) => sum + queue.videos.length, 0);
  for (let position = 0; position < totalAllocation && selected.length < config.maxItems; position += 1) {
    let bestIndex = -1;
    let bestDeficit = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < queues.length; index += 1) {
      const queue = queues[index];
      if (!queue || queue.used >= queue.videos.length) continue;
      const expected = ((position + 1) * queue.videos.length) / totalAllocation;
      const deficit = expected - queue.used;
      if (deficit > bestDeficit + Number.EPSILON) {
        bestDeficit = deficit;
        bestIndex = index;
      }
    }
    const queue = queues[bestIndex];
    const video = queue?.videos[queue.used];
    if (!queue || !video) break;
    queue.used += 1;
    selected.push(video);
  }

  return selected;
}

async function fetchCreatorFeedSafely(
  creator: CreatorVideoCreatorConfig,
  filterPolicy: CreatorVideoFilterPolicy,
): Promise<CreatorFeedOutcome> {
  try {
    const source = await creatorFeedSource(creator);
    const url = `${YOUTUBE_FEED_URL}?${new URLSearchParams(source.params)}`;
    const response = await fetch(url, cachedRequestInit(FEED_CACHE_SECONDS));
    if (!response.ok) throw new Error(`Feed request returned ${response.status}`);
    const xml = await boundedResponseText(response, MAX_FEED_RESPONSE_BYTES, "Feed");
    if (!/<feed(?:\s|>)/i.test(xml) || !/<\/feed>/i.test(xml)) {
      throw new Error("Feed response was not Atom XML");
    }
    const resolvedCreator = { ...creator, channelId: source.channelId || creator.channelId };
    const preview = parseYoutubeAtomFeedPreview(xml, resolvedCreator, filterPolicy);
    if (/<entry(?:\s|>)/i.test(xml) && !preview.length) {
      throw new Error("Feed entries could not be parsed safely");
    }
    const videos = preview
      .filter((item) => item.status === "included")
      .map(previewItemVideo);
    return { creatorId: creator.id, succeeded: true, videos, preview, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[youtube/creator-videos] ${creator.id}: ${message}`);
    return {
      creatorId: creator.id,
      succeeded: false,
      videos: [],
      preview: [],
      error: message,
    };
  }
}

async function creatorFeedSource(creator: CreatorVideoCreatorConfig): Promise<{
  params: Record<string, string>;
  channelId: string;
}> {
  if (creator.sourceMode === "playlist") {
    if (!creator.playlistId) throw new Error("A YouTube playlist is required");
    return { params: { playlist_id: creator.playlistId }, channelId: creator.channelId };
  }

  const directChannelId = youtubeChannelIdFromUrl(creator.youtubeUrl);
  if (directChannelId) {
    return { params: { channel_id: directChannelId }, channelId: directChannelId };
  }

  let resolvedChannelId = "";
  if (creator.youtubeUrl) {
    try {
      resolvedChannelId = await resolveYoutubeHandle(creator.youtubeUrl);
    } catch (error) {
      if (!creator.channelId) throw error;
    }
  }
  const channelId = resolvedChannelId || creator.channelId;
  if (!channelId) throw new Error("Channel ID could not be resolved");
  return { params: { channel_id: channelId }, channelId };
}

async function resolveYoutubeHandle(youtubeUrl: string): Promise<string> {
  const response = await fetch(youtubeUrl, cachedRequestInit(HANDLE_CACHE_SECONDS));
  if (!response.ok) throw new Error(`Channel request returned ${response.status}`);
  return youtubeChannelIdFromHtml(
    await boundedResponseText(response, MAX_CHANNEL_RESPONSE_BYTES, "Channel"),
  );
}

function cachedRequestInit(revalidate: number): RequestInit & {
  next: { revalidate: number; tags: string[] };
} {
  return {
    headers: {
      Accept: "application/atom+xml, application/xml, text/xml, text/html;q=0.8",
      "User-Agent": "RiftLite-CreatorCarousel/1.0",
    },
    next: { revalidate, tags: [CREATOR_VIDEO_FEED_CACHE_TAG] },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  };
}

async function boundedResponseText(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`${label} response exceeded ${maxBytes} bytes`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error(`${label} response exceeded ${maxBytes} bytes`);
  }
  return text;
}

async function readSnapshot(
  db: Firestore | null,
  sourceKey: string,
  creators: CreatorVideoCreatorConfig[],
): Promise<CreatorVideoSnapshot | null> {
  if (!db) return null;
  try {
    const snapshot = await db.collection(SNAPSHOT_COLLECTION).doc(SNAPSHOT_DOCUMENT).get();
    const payload = snapshot.exists ? recordValue(snapshot.data()) : null;
    if (!payload || payload.sourceKey !== sourceKey) return null;
    const creatorById = new Map(creators.map((creator) => [creator.id, creator]));
    const videos = arrayValue(payload.videos)
      .map((value) => {
        const record = recordValue(value);
        const creator = record ? creatorById.get(textValue(record.creatorId)) : undefined;
        return record && creator ? normalizeCreatorVideo(record, creator) : null;
      })
      .filter((video): video is CreatorVideo => Boolean(video));
    const updatedAt = normalizePublishedAt(payload.updatedAt);
    return updatedAt && videos.length ? { sourceKey, videos, updatedAt } : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[youtube/creator-videos] Snapshot read failed: ${message}`);
    return null;
  }
}

async function writeSnapshot(db: Firestore | null, snapshot: CreatorVideoSnapshot): Promise<void> {
  if (!db) return;
  try {
    await db.collection(SNAPSHOT_COLLECTION).doc(SNAPSHOT_DOCUMENT).set({
      sourceKey: snapshot.sourceKey,
      videos: snapshot.videos,
      updatedAt: snapshot.updatedAt,
    }, { merge: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[youtube/creator-videos] Snapshot write failed: ${message}`);
  }
}

function creatorSourceKey(
  config: CreatorVideoCarouselConfig,
  creators: CreatorVideoCreatorConfig[],
): string {
  const sources = {
    maxItems: config.maxItems,
    excludedVideoIds: config.excludedVideoIds,
    includedVideoIds: config.includedVideoIds,
    pinnedVideoIds: config.pinnedVideoIds,
    creators: creators.map((creator) => ({
      id: creator.id,
      youtubeUrl: creator.youtubeUrl,
      channelId: creator.channelId,
      sourceMode: creator.sourceMode,
      playlistId: creator.playlistId,
      videoSlots: creator.videoSlots,
    })),
  };
  return createHash("sha256").update(JSON.stringify(sources)).digest("hex");
}

function eligibleVideoCreators(config: CreatorVideoCarouselConfig): CreatorVideoCreatorConfig[] {
  return config.creators.filter((creator) => {
    if (!creator.enabled) return false;
    return creator.sourceMode === "playlist"
      ? Boolean(creator.playlistId)
      : Boolean(creator.channelId || creator.youtubeUrl);
  });
}

function creatorVideoFilterPolicy(config: CreatorVideoCarouselConfig): CreatorVideoFilterPolicy {
  return {
    includedVideoIds: new Set(config.includedVideoIds),
    pinnedVideoIds: new Set(config.pinnedVideoIds),
    excludedVideoIds: new Set(config.excludedVideoIds),
  };
}

function emptyCreatorVideoFilterPolicy(): CreatorVideoFilterPolicy {
  return {
    includedVideoIds: new Set(),
    pinnedVideoIds: new Set(),
    excludedVideoIds: new Set(),
  };
}

function creatorVideoFilterDecision(
  creator: CreatorVideoCreatorConfig,
  videoId: string,
  metadata: string,
  policy: CreatorVideoFilterPolicy,
): Pick<CreatorVideoPreviewItem, "status" | "reason"> {
  if (policy.excludedVideoIds.has(videoId)) {
    return { status: "excluded", reason: "Hidden manually" };
  }
  if (creator.sourceMode === "all") {
    return { status: "included", reason: "All channel uploads" };
  }
  if (creator.sourceMode === "playlist") {
    return { status: "included", reason: "Selected playlist" };
  }
  if (policy.includedVideoIds.has(videoId)) {
    return { status: "included", reason: "Allowed manually" };
  }
  if (policy.pinnedVideoIds.has(videoId)) {
    return { status: "included", reason: "Pinned manually" };
  }
  return RIFTBOUND_TOPIC_PATTERN.test(metadata)
    ? { status: "included", reason: "Riftbound title or description" }
    : { status: "filtered", reason: "No Riftbound terms found" };
}

function normalizeCreatorVideo(
  value: Record<string, unknown>,
  creator: CreatorVideoCreatorConfig,
): CreatorVideo | null {
  const videoId = normalizeYoutubeVideoId(value.videoId);
  const publishedAt = normalizePublishedAt(value.publishedAt);
  if (!videoId || !publishedAt) return null;
  const title = cleanText(textValue(value.title), 300) || "Riftbound video";
  return creatorVideoFromFields(videoId, title, publishedAt, creator);
}

function creatorVideoFromFields(
  videoId: string,
  title: string,
  publishedAt: string,
  creator: CreatorVideoCreatorConfig,
): CreatorVideo {
  return {
    videoId,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    creatorId: creator.id,
    creatorName: creator.name,
    channelUrl: creator.youtubeUrl,
    publishedAt,
  };
}

function previewItemVideo(item: CreatorVideoPreviewItem): CreatorVideo {
  return {
    videoId: item.videoId,
    title: item.title,
    url: item.url,
    embedUrl: item.embedUrl,
    thumbnailUrl: item.thumbnailUrl,
    creatorId: item.creatorId,
    creatorName: item.creatorName,
    channelUrl: item.channelUrl,
    publishedAt: item.publishedAt,
  };
}

function groupVideosByCreator(videos: CreatorVideo[]): Map<string, CreatorVideo[]> {
  const grouped = new Map<string, CreatorVideo[]>();
  for (const video of videos) {
    const current = grouped.get(video.creatorId) ?? [];
    current.push(video);
    grouped.set(video.creatorId, current);
  }
  return grouped;
}

function compareCreatorVideos(left: CreatorVideo, right: CreatorVideo): number {
  return right.publishedAt.localeCompare(left.publishedAt) || left.videoId.localeCompare(right.videoId);
}

function normalizePublishedAt(value: unknown): string {
  const raw = textValue(value);
  if (!raw) return "";
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const record = recordValue(value);
  return record ? textValue(record["#text"]) : "";
}

function cleanText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
