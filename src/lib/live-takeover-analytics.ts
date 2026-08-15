import "server-only";

import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import {
  normalizeTwitchChannelLogin,
  type PublicLiveTakeover,
} from "@/lib/live-takeover";

export const LIVE_TAKEOVER_ANALYTICS_RUN_COLLECTION = "live_takeover_analytics_runs";
export const LIVE_TAKEOVER_ANALYTICS_SESSION_COLLECTION = "live_takeover_analytics_sessions";
export const LIVE_TAKEOVER_ANALYTICS_TOKEN_TTL_MS = 48 * 60 * 60 * 1_000;
export const LIVE_TAKEOVER_ANALYTICS_RETENTION_MS = 35 * 24 * 60 * 60 * 1_000;
export const LIVE_TAKEOVER_ANALYTICS_CURRENT_WINDOW_MS = 12 * 60 * 1_000;
export const LIVE_TAKEOVER_ANALYTICS_SESSION_LIMIT = 5_000;

const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]{16,80}$/;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{16,100}$/;
const VERSION_PATTERN = /^[a-zA-Z0-9._+-]{1,48}$/;
const TELEMETRY_EVENTS = new Set([
  "impression",
  "playing",
  "checkpoint",
  "paused",
  "stopped",
  "dismissed",
]);

export type LiveTakeoverTelemetryEvent =
  | "impression"
  | "playing"
  | "checkpoint"
  | "paused"
  | "stopped"
  | "dismissed";

export type LiveTakeoverTelemetryInput = {
  runId: string;
  token: string;
  installId: string;
  sessionId: string;
  channelLogin: string;
  event: LiveTakeoverTelemetryEvent;
  hasPlayed: boolean;
  watchedSeconds: number;
  startedAt: string;
  occurredAt: string;
  appVersion?: string;
  platform?: string;
};

export type LiveTakeoverAnalyticsRun = {
  id: string;
  channelLogin: string;
  title: string;
  startedAt: string | null;
  endedAt: string | null;
};

export type LiveTakeoverAnalyticsReport = {
  generatedAt: string;
  selectedRunId: string | null;
  runs: LiveTakeoverAnalyticsRun[];
  summary: {
    impressions: number;
    uniqueViewers: number;
    playbackStarts: number;
    currentViewers: number;
    totalWatchSeconds: number;
    averageWatchSeconds: number;
    peakConcurrent: number;
    dismissals: number;
  };
  timeline: Array<{ bucket: string; viewers: number }>;
  appVersions: Array<{ id: string; viewers: number }>;
  platforms: Array<{ id: string; viewers: number }>;
  truncated: boolean;
  privacy: "anonymous-run-scoped";
};

type NormalizedTelemetry = Omit<LiveTakeoverTelemetryInput, "token"> & {
  token: string;
  occurredAtMs: number;
  startedAtMs: number;
};

function analyticsSecret(): string {
  return (process.env.LIVE_TAKEOVER_ANALYTICS_SECRET
    || process.env.COMMUNITY_AGGREGATE_SECRET
    || "").trim();
}

function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function hmacId(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 48);
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes);
}

function tokenValue(runId: string, channelLogin: string, expiresAt: number): string {
  return `v1:${runId}:${channelLogin}:${expiresAt}`;
}

export function createLiveTakeoverAnalyticsRunId(): string {
  return randomUUID();
}

export function createLiveTakeoverAnalyticsToken(
  runId: string,
  channelLogin: string,
  now = Date.now(),
): string | null {
  const secret = analyticsSecret();
  const channel = normalizeTwitchChannelLogin(channelLogin);
  if (!secret || !RUN_ID_PATTERN.test(runId) || !channel) return null;
  const expiresAt = now + LIVE_TAKEOVER_ANALYTICS_TOKEN_TTL_MS;
  return `${expiresAt}.${hmac(secret, tokenValue(runId, channel, expiresAt))}`;
}

export function verifyLiveTakeoverAnalyticsToken(
  token: string,
  runId: string,
  channelLogin: string,
  now = Date.now(),
): boolean {
  const secret = analyticsSecret();
  const channel = normalizeTwitchChannelLogin(channelLogin);
  const [expiresRaw, signature, ...extra] = token.split(".");
  const expiresAt = Number(expiresRaw);
  if (
    !secret
    || extra.length
    || !signature
    || !Number.isSafeInteger(expiresAt)
    || expiresAt < now
    || expiresAt > now + LIVE_TAKEOVER_ANALYTICS_TOKEN_TTL_MS + 60_000
    || !RUN_ID_PATTERN.test(runId)
    || !channel
  ) {
    return false;
  }
  return safeEqual(signature, hmac(secret, tokenValue(runId, channel, expiresAt)));
}

export function withLiveTakeoverAnalyticsAccess(
  takeover: PublicLiveTakeover,
  analyticsRunId: unknown,
): PublicLiveTakeover {
  const runId = typeof analyticsRunId === "string" ? analyticsRunId.trim() : "";
  if (!takeover.active || !RUN_ID_PATTERN.test(runId)) return takeover;
  const token = createLiveTakeoverAnalyticsToken(runId, takeover.channelLogin);
  return token
    ? { ...takeover, analytics: { runId, token } }
    : takeover;
}

function cleanString(value: unknown, limit: number): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, limit)
    : "";
}

function dateMillis(value: unknown): number {
  if (typeof value !== "string") return Number.NaN;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : Number.NaN;
}

function normalizeTelemetry(input: unknown, now = Date.now()): NormalizedTelemetry {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("invalid_payload");
  }
  const data = input as Record<string, unknown>;
  const runId = cleanString(data.runId, 80);
  const token = cleanString(data.token, 200);
  const installId = cleanString(data.installId, 160);
  const sessionId = cleanString(data.sessionId, 100);
  const channelLogin = normalizeTwitchChannelLogin(data.channelLogin);
  const event = cleanString(data.event, 20) as LiveTakeoverTelemetryEvent;
  const watchedSeconds = Number(data.watchedSeconds);
  const startedAtMs = dateMillis(data.startedAt);
  const occurredAtMs = dateMillis(data.occurredAt);
  if (
    !RUN_ID_PATTERN.test(runId)
    || !token
    || installId.length < 16
    || !SESSION_ID_PATTERN.test(sessionId)
    || !channelLogin
    || !TELEMETRY_EVENTS.has(event)
    || typeof data.hasPlayed !== "boolean"
    || !Number.isSafeInteger(watchedSeconds)
    || watchedSeconds < 0
    || watchedSeconds > 24 * 60 * 60
    || !Number.isFinite(startedAtMs)
    || !Number.isFinite(occurredAtMs)
    || startedAtMs > occurredAtMs + 60_000
    || occurredAtMs < now - 7 * 24 * 60 * 60 * 1_000
    || occurredAtMs > now + 5 * 60 * 1_000
  ) {
    throw new Error("invalid_payload");
  }
  return {
    runId,
    token,
    installId,
    sessionId,
    channelLogin,
    event,
    hasPlayed: data.hasPlayed,
    watchedSeconds,
    startedAt: new Date(startedAtMs).toISOString(),
    occurredAt: new Date(occurredAtMs).toISOString(),
    occurredAtMs,
    startedAtMs,
    appVersion: VERSION_PATTERN.test(cleanString(data.appVersion, 48))
      ? cleanString(data.appVersion, 48)
      : "unknown",
    platform: cleanString(data.platform, 24).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "unknown",
  };
}

function tenMinuteBucket(millis: number): string {
  const date = new Date(millis);
  date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 10) * 10, 0, 0);
  return date.toISOString();
}

export async function recordLiveTakeoverTelemetry(input: unknown): Promise<void> {
  const now = Date.now();
  const telemetry = normalizeTelemetry(input, now);
  if (!verifyLiveTakeoverAnalyticsToken(
    telemetry.token,
    telemetry.runId,
    telemetry.channelLogin,
    now,
  )) {
    throw new Error("invalid_token");
  }
  const secret = analyticsSecret();
  const db = getFirestoreAdmin();
  if (!secret || !db) throw new Error("analytics_unavailable");

  const viewerHash = hmacId(secret, `viewer:${telemetry.runId}:${telemetry.installId}`);
  const sessionHash = hmacId(
    secret,
    `session:${telemetry.runId}:${viewerHash}:${telemetry.sessionId}`,
  );
  const playing = telemetry.event === "playing" || telemetry.event === "checkpoint";
  const activityBucket = telemetry.hasPlayed && telemetry.watchedSeconds > 0
    ? tenMinuteBucket(telemetry.occurredAtMs)
    : "";

  await db.collection(LIVE_TAKEOVER_ANALYTICS_SESSION_COLLECTION)
    .doc(`${telemetry.runId}_${sessionHash}`)
    .set({
      runId: telemetry.runId,
      channelLogin: telemetry.channelLogin,
      viewerHash,
      sessionHash,
      startedAt: telemetry.startedAt,
      day: telemetry.startedAt.slice(0, 10),
      lastEvent: telemetry.event,
      hasPlayed: telemetry.hasPlayed,
      watchedSeconds: telemetry.watchedSeconds,
      playing,
      appVersion: telemetry.appVersion,
      platform: telemetry.platform,
      lastSeenAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(now + LIVE_TAKEOVER_ANALYTICS_RETENTION_MS),
      ...(telemetry.event === "dismissed" ? { dismissed: true } : {}),
      ...(activityBucket ? { activityBuckets: FieldValue.arrayUnion(activityBucket) } : {}),
    }, { merge: true });
}

function timestampIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(new Date(value).getTime())) {
    return new Date(value).toISOString();
  }
  if (typeof value === "object") {
    const candidate = value as { toDate?: () => Date; toMillis?: () => number };
    if (typeof candidate.toDate === "function") return candidate.toDate().toISOString();
    if (typeof candidate.toMillis === "function") return new Date(candidate.toMillis()).toISOString();
  }
  return null;
}

function timestampMillis(value: unknown): number {
  const iso = timestampIso(value);
  return iso ? new Date(iso).getTime() : 0;
}

function sortedViewerTotals(source: Map<string, Set<string>>): Array<{ id: string; viewers: number }> {
  return [...source.entries()]
    .map(([id, viewers]) => ({ id, viewers: viewers.size }))
    .sort((left, right) => right.viewers - left.viewers || left.id.localeCompare(right.id));
}

function emptySummary(): LiveTakeoverAnalyticsReport["summary"] {
  return {
    impressions: 0,
    uniqueViewers: 0,
    playbackStarts: 0,
    currentViewers: 0,
    totalWatchSeconds: 0,
    averageWatchSeconds: 0,
    peakConcurrent: 0,
    dismissals: 0,
  };
}

export async function readLiveTakeoverAnalyticsReport(
  requestedRunId?: string,
): Promise<LiveTakeoverAnalyticsReport> {
  const db = getFirestoreAdmin();
  if (!db) throw new Error("analytics_unavailable");

  const runSnapshot = await db.collection(LIVE_TAKEOVER_ANALYTICS_RUN_COLLECTION)
    .orderBy("startedAt", "desc")
    .limit(12)
    .get();
  const runs: LiveTakeoverAnalyticsRun[] = runSnapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      channelLogin: normalizeTwitchChannelLogin(data.channelLogin) || "unknown",
      title: cleanString(data.title, 120) || "Live takeover",
      startedAt: timestampIso(data.startedAt),
      endedAt: timestampIso(data.endedAt),
    };
  });
  const normalizedRequested = cleanString(requestedRunId, 80);
  const selectedRunId = RUN_ID_PATTERN.test(normalizedRequested)
    ? normalizedRequested
    : runs[0]?.id ?? null;
  if (!selectedRunId) {
    return {
      generatedAt: new Date().toISOString(),
      selectedRunId: null,
      runs,
      summary: emptySummary(),
      timeline: [],
      appVersions: [],
      platforms: [],
      truncated: false,
      privacy: "anonymous-run-scoped",
    };
  }

  const sessionSnapshot = await db.collection(LIVE_TAKEOVER_ANALYTICS_SESSION_COLLECTION)
    .where("runId", "==", selectedRunId)
    .limit(LIVE_TAKEOVER_ANALYTICS_SESSION_LIMIT)
    .get();
  const viewers = new Set<string>();
  const playbackViewers = new Set<string>();
  const currentViewers = new Set<string>();
  const watchByViewer = new Map<string, number>();
  const buckets = new Map<string, Set<string>>();
  const versions = new Map<string, Set<string>>();
  const platforms = new Map<string, Set<string>>();
  let playbackStarts = 0;
  let dismissals = 0;
  const currentCutoff = Date.now() - LIVE_TAKEOVER_ANALYTICS_CURRENT_WINDOW_MS;

  for (const document of sessionSnapshot.docs) {
    const data = document.data();
    const viewerHash = cleanString(data.viewerHash, 64);
    if (!viewerHash) continue;
    viewers.add(viewerHash);
    const watchedSeconds = Math.min(24 * 60 * 60, Math.max(0, Math.trunc(Number(data.watchedSeconds) || 0)));
    watchByViewer.set(viewerHash, (watchByViewer.get(viewerHash) ?? 0) + watchedSeconds);
    if (data.hasPlayed === true) {
      playbackStarts += 1;
      playbackViewers.add(viewerHash);
    }
    if (data.dismissed === true) dismissals += 1;
    if (data.playing === true && timestampMillis(data.lastSeenAt) >= currentCutoff) {
      currentViewers.add(viewerHash);
    }
    for (const bucket of Array.isArray(data.activityBuckets) ? data.activityBuckets : []) {
      const key = cleanString(bucket, 32);
      if (!key) continue;
      const set = buckets.get(key) ?? new Set<string>();
      set.add(viewerHash);
      buckets.set(key, set);
    }
    const version = cleanString(data.appVersion, 48) || "unknown";
    const versionViewers = versions.get(version) ?? new Set<string>();
    versionViewers.add(viewerHash);
    versions.set(version, versionViewers);
    const platform = cleanString(data.platform, 24) || "unknown";
    const platformViewers = platforms.get(platform) ?? new Set<string>();
    platformViewers.add(viewerHash);
    platforms.set(platform, platformViewers);
  }

  const totalWatchSeconds = [...watchByViewer.values()].reduce((sum, seconds) => sum + seconds, 0);
  const timeline = [...buckets.entries()]
    .map(([bucket, bucketViewers]) => ({ bucket, viewers: bucketViewers.size }))
    .sort((left, right) => left.bucket.localeCompare(right.bucket));
  return {
    generatedAt: new Date().toISOString(),
    selectedRunId,
    runs,
    summary: {
      impressions: sessionSnapshot.size,
      uniqueViewers: viewers.size,
      playbackStarts,
      currentViewers: currentViewers.size,
      totalWatchSeconds,
      averageWatchSeconds: playbackViewers.size
        ? Math.round(totalWatchSeconds / playbackViewers.size)
        : 0,
      peakConcurrent: timeline.reduce((peak, bucket) => Math.max(peak, bucket.viewers), 0),
      dismissals,
    },
    timeline,
    appVersions: sortedViewerTotals(versions),
    platforms: sortedViewerTotals(platforms),
    truncated: sessionSnapshot.size >= LIVE_TAKEOVER_ANALYTICS_SESSION_LIMIT,
    privacy: "anonymous-run-scoped",
  };
}
