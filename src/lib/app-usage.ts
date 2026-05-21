import "server-only";

import { createHash } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";

import { getFirestoreAdmin } from "@/lib/firebase/admin";

const USAGE_COLLECTION = "app_usage_daily";
const INSTALL_COLLECTION = "app_installs";
const DEFAULT_REPORT_DAYS = 30;
const MAX_REPORT_DAYS = 120;

export type AppUsageInput = {
  installId: string;
  appVersion?: string;
  platform?: string;
  channel?: string;
  linkedAccount?: boolean;
  replayEnabled?: boolean;
  videoReplayEnabled?: boolean;
  activePlatforms?: string[];
  occurredAt?: string;
};

export type AppUsageHeartbeat = {
  installHash: string;
  day: string;
  appVersion: string;
  platform: string;
  channel: string;
  linkedAccount: boolean;
  replayEnabled: boolean;
  videoReplayEnabled: boolean;
  activePlatforms: string[];
};

export type AppUsageReport = {
  days: number;
  generatedAt: string;
  totals: {
    dailyActiveInstalls: number;
    heartbeats: number;
    newInstalls: number;
  };
  daily: Array<{
    date: string;
    dailyActiveInstalls: number;
    heartbeats: number;
    newInstalls: number;
  }>;
  appVersions: Array<{ id: string; total: number }>;
  platforms: Array<{ id: string; total: number }>;
  channels: Array<{ id: string; total: number }>;
  features: Array<{ id: string; total: number }>;
  activePlatforms: Array<{ id: string; total: number }>;
};

type AppUsageDailyDoc = {
  date?: string;
  dailyActiveInstalls?: number;
  heartbeats?: number;
  newInstalls?: number;
  appVersions?: Record<string, number>;
  platforms?: Record<string, number>;
  channels?: Record<string, number>;
  features?: Record<string, number>;
  activePlatforms?: Record<string, number>;
};

function dayKey(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function clampReportDays(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_REPORT_DAYS;
  }
  return Math.min(MAX_REPORT_DAYS, Math.max(1, Math.round(value)));
}

function sanitizeMetricId(value: string | undefined, fallback: string, limit = 64): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, limit);
  return normalized || fallback;
}

function normalizeBoolean(value: boolean | undefined): boolean {
  return value === true;
}

function sortedTotals(record: Record<string, number> | undefined): Array<{ id: string; total: number }> {
  return Object.entries(record ?? {})
    .map(([id, total]) => ({ id, total: Number(total) || 0 }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
}

function installHash(installId: string): string {
  return createHash("sha256").update(`riftlite-app-usage:${installId}`).digest("hex").slice(0, 48);
}

function normalizeActivePlatforms(value: string[] | undefined): string[] {
  return [...new Set((value ?? [])
    .map((item) => sanitizeMetricId(item, "", 32))
    .filter(Boolean))]
    .slice(0, 6);
}

export function normalizeAppUsageHeartbeat(input: AppUsageInput): AppUsageHeartbeat {
  const installId = (input.installId ?? "").trim();
  if (installId.length < 16 || installId.length > 160) {
    throw new Error("Invalid install id");
  }

  return {
    installHash: installHash(installId),
    day: dayKey(input.occurredAt),
    appVersion: sanitizeMetricId(input.appVersion, "unknown-version", 48),
    platform: sanitizeMetricId(input.platform, "unknown-platform", 32),
    channel: sanitizeMetricId(input.channel, "desktop", 32),
    linkedAccount: normalizeBoolean(input.linkedAccount),
    replayEnabled: input.replayEnabled !== false,
    videoReplayEnabled: input.videoReplayEnabled !== false,
    activePlatforms: normalizeActivePlatforms(input.activePlatforms),
  };
}

export async function recordAppUsageHeartbeat(input: AppUsageInput): Promise<AppUsageHeartbeat> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firestore admin is not configured");
  }

  const heartbeat = normalizeAppUsageHeartbeat(input);
  const dailyRef = db.collection(USAGE_COLLECTION).doc(heartbeat.day);
  const dailyInstallRef = dailyRef.collection("installs").doc(heartbeat.installHash);
  const installRef = db.collection(INSTALL_COLLECTION).doc(heartbeat.installHash);

  await db.runTransaction(async (transaction) => {
    const [dailyInstallSnap, installSnap] = await Promise.all([
      transaction.get(dailyInstallRef),
      transaction.get(installRef),
    ]);
    const firstSeenToday = !dailyInstallSnap.exists;
    const newInstall = !installSnap.exists;
    const featureIds = [
      heartbeat.linkedAccount ? "linked-account" : "no-login",
      heartbeat.replayEnabled ? "replay-enabled" : "replay-disabled",
      heartbeat.videoReplayEnabled ? "video-replay-enabled" : "video-replay-disabled",
    ];

    transaction.set(
      dailyRef,
      {
        date: heartbeat.day,
        heartbeats: FieldValue.increment(1),
        dailyActiveInstalls: FieldValue.increment(firstSeenToday ? 1 : 0),
        newInstalls: FieldValue.increment(newInstall ? 1 : 0),
        updatedAt: FieldValue.serverTimestamp(),
        appVersions: {
          [heartbeat.appVersion]: FieldValue.increment(firstSeenToday ? 1 : 0),
        },
        platforms: {
          [heartbeat.platform]: FieldValue.increment(firstSeenToday ? 1 : 0),
        },
        channels: {
          [heartbeat.channel]: FieldValue.increment(firstSeenToday ? 1 : 0),
        },
        features: Object.fromEntries(featureIds.map((id) => [id, FieldValue.increment(firstSeenToday ? 1 : 0)])),
        activePlatforms: Object.fromEntries(heartbeat.activePlatforms.map((id) => [id, FieldValue.increment(firstSeenToday ? 1 : 0)])),
      },
      { merge: true },
    );

    transaction.set(
      dailyInstallRef,
      {
        installHash: heartbeat.installHash,
        appVersion: heartbeat.appVersion,
        platform: heartbeat.platform,
        channel: heartbeat.channel,
        linkedAccount: heartbeat.linkedAccount,
        replayEnabled: heartbeat.replayEnabled,
        videoReplayEnabled: heartbeat.videoReplayEnabled,
        activePlatforms: heartbeat.activePlatforms,
        ...(firstSeenToday ? { firstSeenAt: FieldValue.serverTimestamp() } : {}),
        lastSeenAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    transaction.set(
      installRef,
      {
        installHash: heartbeat.installHash,
        ...(newInstall ? {
          firstSeenAt: FieldValue.serverTimestamp(),
          firstVersion: heartbeat.appVersion,
        } : {}),
        lastSeenAt: FieldValue.serverTimestamp(),
        lastVersion: heartbeat.appVersion,
        platform: heartbeat.platform,
        channel: heartbeat.channel,
      },
      { merge: true },
    );
  });

  return heartbeat;
}

export async function readAppUsageReport(days = DEFAULT_REPORT_DAYS): Promise<AppUsageReport> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firestore admin is not configured");
  }

  const reportDays = clampReportDays(days);
  const snap = await db.collection(USAGE_COLLECTION).orderBy("date", "desc").limit(reportDays).get();

  const byVersion: Record<string, number> = {};
  const byPlatform: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  const byFeature: Record<string, number> = {};
  const byActivePlatform: Record<string, number> = {};
  const daily: AppUsageReport["daily"] = [];
  let activeTotal = 0;
  let heartbeatTotal = 0;
  let newInstallTotal = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as AppUsageDailyDoc;
    const dailyActiveInstalls = Number(data.dailyActiveInstalls ?? 0) || 0;
    const heartbeats = Number(data.heartbeats ?? 0) || 0;
    const newInstalls = Number(data.newInstalls ?? 0) || 0;
    activeTotal += dailyActiveInstalls;
    heartbeatTotal += heartbeats;
    newInstallTotal += newInstalls;
    daily.push({
      date: data.date || doc.id,
      dailyActiveInstalls,
      heartbeats,
      newInstalls,
    });

    for (const [id, count] of Object.entries(data.appVersions ?? {})) {
      byVersion[id] = (byVersion[id] ?? 0) + (Number(count) || 0);
    }
    for (const [id, count] of Object.entries(data.platforms ?? {})) {
      byPlatform[id] = (byPlatform[id] ?? 0) + (Number(count) || 0);
    }
    for (const [id, count] of Object.entries(data.channels ?? {})) {
      byChannel[id] = (byChannel[id] ?? 0) + (Number(count) || 0);
    }
    for (const [id, count] of Object.entries(data.features ?? {})) {
      byFeature[id] = (byFeature[id] ?? 0) + (Number(count) || 0);
    }
    for (const [id, count] of Object.entries(data.activePlatforms ?? {})) {
      byActivePlatform[id] = (byActivePlatform[id] ?? 0) + (Number(count) || 0);
    }
  }

  return {
    days: reportDays,
    generatedAt: new Date().toISOString(),
    totals: {
      dailyActiveInstalls: activeTotal,
      heartbeats: heartbeatTotal,
      newInstalls: newInstallTotal,
    },
    daily: daily.sort((a, b) => a.date.localeCompare(b.date)),
    appVersions: sortedTotals(byVersion),
    platforms: sortedTotals(byPlatform),
    channels: sortedTotals(byChannel),
    features: sortedTotals(byFeature),
    activePlatforms: sortedTotals(byActivePlatform),
  };
}
