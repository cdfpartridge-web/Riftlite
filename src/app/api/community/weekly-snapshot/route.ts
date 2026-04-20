import { type NextRequest, NextResponse } from "next/server";

import {
  buildWeeklySnapshot,
  previousIsoWeek,
  weekJustEnded,
  writeWeeklySnapshot,
} from "@/lib/community/weekly-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Reuses the existing aggregate-refresh secret rather than minting a
// new one. Both endpoints are server-to-server cron triggers with the
// same trust level — no benefit to separating the auth material.
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.COMMUNITY_AGGREGATE_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-community-aggregate-secret") === secret) return true;
  return false;
}

/**
 * Freeze the just-ended ISO week into `aggregates/weekly-YYYY-Www`.
 *
 * Runs Sunday night via GitHub Actions. Reads matches directly from
 * the `matches` collection filtered by `created_at` in the week window,
 * so the cost scales with the number of games actually played — not
 * the 500-match ceiling of the rolling aggregate. At low volume that's
 * a few dozen reads; at 1000 matches/week it's 1000. Once per week.
 *
 * Accepts an optional `?week=2026-W16` query param to regenerate a
 * specific past week's snapshot (useful if a cron run failed or the
 * stats schema evolved and we want to rewrite history).
 */
async function runSnapshot(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const weekParam = url.searchParams.get("week");

    let target: { year: number; week: number; startMs: number; endMs: number };
    if (weekParam) {
      const match = weekParam.match(/^(\d{4})-W(\d{1,2})$/);
      if (!match) {
        return NextResponse.json(
          { error: "Invalid week param, expected YYYY-Www (e.g. 2026-W17)" },
          { status: 400 },
        );
      }
      const year = Number(match[1]);
      const week = Number(match[2]);
      // Back-solve the start/end the same way weekJustEnded does, but
      // anchored to any week rather than the one that just closed.
      const jan4 = Date.UTC(year, 0, 4);
      const jan4DayNum = new Date(jan4).getUTCDay() || 7;
      const week01StartMs = jan4 - (jan4DayNum - 1) * 86_400_000;
      const startMs = week01StartMs + (week - 1) * 7 * 86_400_000;
      const endMs = startMs + 7 * 86_400_000;
      target = { year, week, startMs, endMs };
    } else {
      target = weekJustEnded();
    }

    const snapshot = await buildWeeklySnapshot(target);
    if (!snapshot) {
      return NextResponse.json(
        { error: "Firestore admin is not configured" },
        { status: 503 },
      );
    }

    await writeWeeklySnapshot(snapshot);

    // Also note the prior week's id so the caller can eyeball whether
    // the report generator will have both weeks available.
    const prior = previousIsoWeek(target.year, target.week);

    return NextResponse.json({
      ok: true,
      week: snapshot.week,
      matchCount: snapshot.matchCount,
      uniquePlayers: snapshot.uniquePlayers,
      legendCount: snapshot.legends.length,
      deckCount: snapshot.decks.length,
      priorWeek: `${prior.year}-W${String(prior.week).padStart(2, "0")}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[weekly-snapshot] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSnapshot(req);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSnapshot(req);
}
