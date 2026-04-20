import { createClient } from "next-sanity";
import { type NextRequest, NextResponse } from "next/server";

import { buildMetaReport } from "@/lib/community/meta-report";
import {
  previousIsoWeek,
  readWeeklySnapshot,
  weekJustEnded,
} from "@/lib/community/weekly-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.COMMUNITY_AGGREGATE_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-community-aggregate-secret") === secret) return true;
  return false;
}

function getSanityWriteClient() {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? "";
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
  return createClient({
    projectId: projectId || "demo",
    dataset,
    apiVersion: "2026-03-01",
    useCdn: false,
    token: process.env.SANITY_API_TOKEN,
  });
}

/**
 * Read the just-ended week's snapshot + the prior week's (if it exists)
 * and publish a newsPost to Sanity. Idempotent by default: if a post
 * for this week already exists we leave it alone (so humans can edit
 * the article after auto-publish without the next cron clobbering
 * their work). Pass `?force=true` to overwrite instead.
 *
 * Triggered by the Monday morning cron a few hours after the Sunday
 * night snapshot lands.
 */
async function runGenerate(req: NextRequest) {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  if (!projectId) {
    return NextResponse.json(
      { error: "Sanity is not configured" },
      { status: 503 },
    );
  }
  if (!process.env.SANITY_API_TOKEN) {
    return NextResponse.json(
      { error: "SANITY_API_TOKEN is not set (writes require it)" },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const weekParam = url.searchParams.get("week");
  const force = url.searchParams.get("force") === "true";

  let target: { year: number; week: number };
  if (weekParam) {
    const m = weekParam.match(/^(\d{4})-W(\d{1,2})$/);
    if (!m) {
      return NextResponse.json(
        { error: "Invalid week param, expected YYYY-Www" },
        { status: 400 },
      );
    }
    target = { year: Number(m[1]), week: Number(m[2]) };
  } else {
    const ended = weekJustEnded();
    target = { year: ended.year, week: ended.week };
  }

  const current = await readWeeklySnapshot(target.year, target.week);
  if (!current) {
    return NextResponse.json(
      {
        ok: false,
        error: `No snapshot for ${target.year}-W${String(target.week).padStart(2, "0")}. Run /api/community/weekly-snapshot first.`,
      },
      { status: 404 },
    );
  }

  const prior = previousIsoWeek(target.year, target.week);
  const previous = await readWeeklySnapshot(prior.year, prior.week);
  // previous can legitimately be null on the very first report — the
  // generator handles that and just omits week-over-week comparisons.

  const report = buildMetaReport(current, previous);

  const sanity = getSanityWriteClient();
  const docId = `newsPost-${report.slug}`;

  const doc = {
    _id: docId,
    _type: "newsPost",
    title: report.title,
    slug: { _type: "slug", current: report.slug },
    excerpt: report.excerpt,
    publishedAt: new Date().toISOString(),
    body: report.body,
    tags: report.tags,
    featured: false,
  } as const;

  try {
    if (force) {
      // createOrReplace blows away any human edits — only use when the
      // caller explicitly asked for it.
      await sanity.createOrReplace(doc);
    } else {
      await sanity.createIfNotExists(doc);
    }

    return NextResponse.json({
      ok: true,
      published: true,
      docId,
      slug: report.slug,
      title: report.title,
      week: current.week,
      matchCount: current.matchCount,
      hadPriorWeek: previous !== null,
      force,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[meta-report/generate] Sanity write failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runGenerate(req);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runGenerate(req);
}
