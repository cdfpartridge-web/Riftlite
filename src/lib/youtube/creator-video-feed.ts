import "server-only";

import { createHash } from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";
import { XMLParser } from "fast-xml-parser";

import {
  CREATOR_VIDEO_FEED_CACHE_TAG,
  type CreatorVideoCarouselConfig,
  type CreatorVideoCreatorConfig,
  normalizeYoutubeChannelId,
  normalizeYoutubeVideoId,
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

type CreatorFeedOutcome = {
  creatorId: string;
  succeeded: boolean;
  videos: CreatorVideo[];
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
  const creators = config.creators.filter((creator) =>
    creator.enabled && Boolean(creator.channelId || creator.youtubeUrl));
  if (!config.enabled || !creators.length) {
    return { videos: [], updatedAt: "" };
  }

  const sourceKey = creatorSourceKey(creators);
  const snapshotPromise = readSnapshot(db, sourceKey, creators);
  const outcomesPromise = Promise.all(creators.map(fetchCreatorFeedSafely));
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

export function parseYoutubeAtomFeed(
  xml: string,
  creator: CreatorVideoCreatorConfig,
): CreatorVideo[] {
  let parsed: unknown;
  try {
    parsed = XML_PARSER.parse(xml);
  } catch {
    return [];
  }
  const feed = recordValue(recordValue(parsed)?.feed);
  const rawEntries = arrayValue(feed?.entry);
  const videos: CreatorVideo[] = [];
  const seen = new Set<string>();

  for (const rawEntry of rawEntries) {
    const entry = recordValue(rawEntry);
    if (!entry) continue;
    const videoId = normalizeYoutubeVideoId(textValue(entry.videoId));
    if (!videoId || seen.has(videoId)) continue;
    const publishedAt = normalizePublishedAt(entry.published);
    if (!publishedAt) continue;
    const title = cleanText(textValue(entry.title), 300) || "Riftbound video";
    seen.add(videoId);
    videos.push(creatorVideoFromFields(videoId, title, publishedAt, creator));
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
): Promise<CreatorFeedOutcome> {
  try {
    const channelId = creator.channelId || await resolveYoutubeHandle(creator.youtubeUrl);
    if (!channelId) throw new Error("Channel ID could not be resolved");
    const url = `${YOUTUBE_FEED_URL}?${new URLSearchParams({ channel_id: channelId })}`;
    const response = await fetch(url, cachedRequestInit(FEED_CACHE_SECONDS));
    if (!response.ok) throw new Error(`Feed request returned ${response.status}`);
    const xml = await boundedResponseText(response, MAX_FEED_RESPONSE_BYTES, "Feed");
    if (!/<feed(?:\s|>)/i.test(xml) || !/<\/feed>/i.test(xml)) {
      throw new Error("Feed response was not Atom XML");
    }
    const videos = parseYoutubeAtomFeed(xml, { ...creator, channelId });
    if (/<entry(?:\s|>)/i.test(xml) && !videos.length) {
      throw new Error("Feed entries could not be parsed safely");
    }
    return { creatorId: creator.id, succeeded: true, videos };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[youtube/creator-videos] ${creator.id}: ${message}`);
    return { creatorId: creator.id, succeeded: false, videos: [] };
  }
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

function creatorSourceKey(creators: CreatorVideoCreatorConfig[]): string {
  const sources = creators.map((creator) => ({
    id: creator.id,
    youtubeUrl: creator.youtubeUrl,
    channelId: creator.channelId,
  }));
  return createHash("sha256").update(JSON.stringify(sources)).digest("hex");
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
