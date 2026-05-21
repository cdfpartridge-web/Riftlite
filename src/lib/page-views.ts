import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getFirestoreAdmin } from "@/lib/firebase/admin";

const PAGE_VIEW_COLLECTION = "page_views_daily";
const DEFAULT_REPORT_DAYS = 30;
const MAX_REPORT_DAYS = 120;

export type PageViewInput = {
  path: string;
  title?: string;
  source?: string;
  referrer?: string;
  occurredAt?: string;
};

export type PageView = {
  path: string;
  pageId: string;
  title: string;
  source: string;
  referrer: string;
  day: string;
};

export type PageViewReport = {
  days: number;
  total: number;
  generatedAt: string;
  daily: Array<{ date: string; total: number }>;
  pages: Array<{ path: string; total: number; title?: string }>;
  sources: Array<{ id: string; total: number }>;
  referrers: Array<{ id: string; total: number }>;
};

type PageViewDailyDoc = {
  date?: string;
  total?: number;
  pages?: Record<string, { path?: string; title?: string; total?: number }>;
  sources?: Record<string, number>;
  referrers?: Record<string, number>;
};

function clampReportDays(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_REPORT_DAYS;
  }
  return Math.min(MAX_REPORT_DAYS, Math.max(1, Math.round(value)));
}

function dayKey(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function normalizePath(value: string | undefined): string {
  const raw = (value ?? "").trim() || "/";
  let path = raw;
  try {
    path = raw.startsWith("http") ? new URL(raw).pathname : new URL(raw, "https://www.riftlite.com").pathname;
  } catch {
    path = raw.split("?")[0] || "/";
  }

  path = path.replace(/\/{2,}/g, "/");
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (path.length > 1) {
    path = path.replace(/\/+$/, "");
  }
  return path.slice(0, 160) || "/";
}

function sanitizeMetricId(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || fallback;
}

function pageIdForPath(path: string): string {
  if (path === "/") return "home";
  return sanitizeMetricId(path.replace(/^\//, ""), "unknown-page").replace(/\//g, "__");
}

function normalizeTitle(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function normalizeSource(value: string | undefined): string {
  return sanitizeMetricId(value, "website").slice(0, 48);
}

function normalizeReferrer(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "direct";
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "");
    if (!host || host.endsWith("riftlite.com")) return "internal";
    return sanitizeMetricId(host, "external").slice(0, 64);
  } catch {
    return sanitizeMetricId(raw, "external").slice(0, 64);
  }
}

function sortedTotals(record: Record<string, number> | undefined): Array<{ id: string; total: number }> {
  return Object.entries(record ?? {})
    .map(([id, total]) => ({ id, total: Number(total) || 0 }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
}

export function normalizePageView(input: PageViewInput): PageView {
  const path = normalizePath(input.path);
  return {
    path,
    pageId: pageIdForPath(path),
    title: normalizeTitle(input.title),
    source: normalizeSource(input.source),
    referrer: normalizeReferrer(input.referrer),
    day: dayKey(input.occurredAt),
  };
}

export async function recordPageView(input: PageViewInput): Promise<PageView> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firestore admin is not configured");
  }

  const pageView = normalizePageView(input);
  const doc = db.collection(PAGE_VIEW_COLLECTION).doc(pageView.day);

  await doc.set(
    {
      date: pageView.day,
      total: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
      pages: {
        [pageView.pageId]: {
          path: pageView.path,
          title: pageView.title,
          total: FieldValue.increment(1),
        },
      },
      sources: {
        [pageView.source]: FieldValue.increment(1),
      },
      referrers: {
        [pageView.referrer]: FieldValue.increment(1),
      },
    },
    { merge: true },
  );

  return pageView;
}

export async function readPageViewReport(days = DEFAULT_REPORT_DAYS): Promise<PageViewReport> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firestore admin is not configured");
  }

  const reportDays = clampReportDays(days);
  const snap = await db.collection(PAGE_VIEW_COLLECTION).orderBy("date", "desc").limit(reportDays).get();

  const pages = new Map<string, { path: string; title?: string; total: number }>();
  const bySource: Record<string, number> = {};
  const byReferrer: Record<string, number> = {};
  const daily: Array<{ date: string; total: number }> = [];
  let total = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as PageViewDailyDoc;
    const docTotal = Number(data.total ?? 0) || 0;
    total += docTotal;
    daily.push({ date: data.date || doc.id, total: docTotal });

    for (const [pageId, row] of Object.entries(data.pages ?? {})) {
      const existing = pages.get(pageId) ?? { path: String(row.path ?? pageId), title: row.title, total: 0 };
      existing.total += Number(row.total ?? 0) || 0;
      existing.path = String(row.path ?? existing.path);
      existing.title = String(row.title ?? existing.title ?? "");
      pages.set(pageId, existing);
    }

    for (const [source, count] of Object.entries(data.sources ?? {})) {
      bySource[source] = (bySource[source] ?? 0) + (Number(count) || 0);
    }
    for (const [referrer, count] of Object.entries(data.referrers ?? {})) {
      byReferrer[referrer] = (byReferrer[referrer] ?? 0) + (Number(count) || 0);
    }
  }

  return {
    days: reportDays,
    total,
    generatedAt: new Date().toISOString(),
    daily: daily.sort((a, b) => a.date.localeCompare(b.date)),
    pages: [...pages.values()].sort((a, b) => b.total - a.total || a.path.localeCompare(b.path)),
    sources: sortedTotals(bySource),
    referrers: sortedTotals(byReferrer),
  };
}
