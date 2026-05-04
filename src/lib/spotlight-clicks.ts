import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getFirestoreAdmin } from "@/lib/firebase/admin";

const CLICK_COLLECTION = "spotlight_clicks_daily";
const DEFAULT_REPORT_DAYS = 30;
const MAX_REPORT_DAYS = 120;

export type SpotlightClickInput = {
  spotlightId: string;
  linkId: string;
  appVersion?: string;
  source?: string;
  occurredAt?: string;
};

export type SpotlightClick = {
  spotlightId: string;
  linkId: string;
  appVersion: string;
  source: string;
  day: string;
};

export type SpotlightClickReport = {
  days: number;
  total: number;
  generatedAt: string;
  daily: Array<{ date: string; total: number }>;
  spotlights: Array<{
    id: string;
    total: number;
    links: Array<{ id: string; total: number }>;
  }>;
  links: Array<{ id: string; total: number }>;
  sources: Array<{ id: string; total: number }>;
  appVersions: Array<{ id: string; total: number }>;
};

type SpotlightClickDailyDoc = {
  date?: string;
  total?: number;
  spotlights?: Record<string, { total?: number; links?: Record<string, number> }>;
  links?: Record<string, number>;
  sources?: Record<string, number>;
  appVersions?: Record<string, number>;
};

function sanitizeMetricId(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || fallback;
}

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

function sortedTotals(record: Record<string, number> | undefined): Array<{ id: string; total: number }> {
  return Object.entries(record ?? {})
    .map(([id, total]) => ({ id, total: Number(total) || 0 }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
}

export function normalizeSpotlightClick(input: SpotlightClickInput): SpotlightClick {
  return {
    spotlightId: sanitizeMetricId(input.spotlightId, "unknown-spotlight"),
    linkId: sanitizeMetricId(input.linkId, "unknown-link"),
    appVersion: sanitizeMetricId(input.appVersion, "unknown-version"),
    source: sanitizeMetricId(input.source, "desktop"),
    day: dayKey(input.occurredAt),
  };
}

export async function recordSpotlightClick(input: SpotlightClickInput): Promise<SpotlightClick> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firestore admin is not configured");
  }

  const click = normalizeSpotlightClick(input);
  const doc = db.collection(CLICK_COLLECTION).doc(click.day);

  await doc.set(
    {
      date: click.day,
      total: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
      spotlights: {
        [click.spotlightId]: {
          total: FieldValue.increment(1),
          links: {
            [click.linkId]: FieldValue.increment(1),
          },
        },
      },
      links: {
        [click.linkId]: FieldValue.increment(1),
      },
      sources: {
        [click.source]: FieldValue.increment(1),
      },
      appVersions: {
        [click.appVersion]: FieldValue.increment(1),
      },
    },
    { merge: true },
  );

  return click;
}

export async function readSpotlightClickReport(days = DEFAULT_REPORT_DAYS): Promise<SpotlightClickReport> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firestore admin is not configured");
  }

  const reportDays = clampReportDays(days);
  const snap = await db
    .collection(CLICK_COLLECTION)
    .orderBy("date", "desc")
    .limit(reportDays)
    .get();

  const bySpotlight = new Map<string, { total: number; links: Record<string, number> }>();
  const byLink: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byVersion: Record<string, number> = {};
  const daily: Array<{ date: string; total: number }> = [];
  let total = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as SpotlightClickDailyDoc;
    const docTotal = Number(data.total ?? 0) || 0;
    total += docTotal;
    daily.push({ date: data.date || doc.id, total: docTotal });

    for (const [spotlightId, row] of Object.entries(data.spotlights ?? {})) {
      const existing = bySpotlight.get(spotlightId) ?? { total: 0, links: {} };
      existing.total += Number(row.total ?? 0) || 0;
      for (const [linkId, count] of Object.entries(row.links ?? {})) {
        existing.links[linkId] = (existing.links[linkId] ?? 0) + (Number(count) || 0);
      }
      bySpotlight.set(spotlightId, existing);
    }

    for (const [linkId, count] of Object.entries(data.links ?? {})) {
      byLink[linkId] = (byLink[linkId] ?? 0) + (Number(count) || 0);
    }
    for (const [sourceId, count] of Object.entries(data.sources ?? {})) {
      bySource[sourceId] = (bySource[sourceId] ?? 0) + (Number(count) || 0);
    }
    for (const [version, count] of Object.entries(data.appVersions ?? {})) {
      byVersion[version] = (byVersion[version] ?? 0) + (Number(count) || 0);
    }
  }

  return {
    days: reportDays,
    total,
    generatedAt: new Date().toISOString(),
    daily: daily.sort((a, b) => a.date.localeCompare(b.date)),
    spotlights: [...bySpotlight.entries()]
      .map(([id, row]) => ({
        id,
        total: row.total,
        links: sortedTotals(row.links),
      }))
      .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id)),
    links: sortedTotals(byLink),
    sources: sortedTotals(bySource),
    appVersions: sortedTotals(byVersion),
  };
}
