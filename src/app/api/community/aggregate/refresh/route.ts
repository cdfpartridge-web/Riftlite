import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import { refreshCommunityAggregate } from "@/lib/community/data";

// Force dynamic so this route never gets cached — each cron run must
// actually execute the refresh.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read the public match window from Firestore, normalize it, count the
 * lifetime public matches via Firestore aggregation, repair the
 * lifetime public player index if needed, and write the result to the
 * `aggregates/community-v1` doc. Triggered by GitHub Actions every 4
 * hours (see .github/workflows/refresh-aggregates.yml).
 *
 * Secret-gated via COMMUNITY_AGGREGATE_SECRET. Accepts either:
 *   Authorization: Bearer <secret>
 *   X-Community-Aggregate-Secret: <secret>
 */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.COMMUNITY_AGGREGATE_SECRET;
  if (!secret) return false;

  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-community-aggregate-secret") === secret) return true;
  return false;
}

async function runRefresh() {
  try {
    const result = await refreshCommunityAggregate();

    // Invalidate the cached match window so user-facing pages pick up
    // the new data on their next request instead of waiting out the
    // 10-minute TTL.
    //
    // Next.js 16 requires a second arg on revalidateTag; "max" means
    // expire the cache immediately (same as the old 1-arg behavior).
    // See https://nextjs.org/docs/messages/revalidate-tag-single-arg.
    try {
      revalidateTag("community-matches", "max");
    } catch {
      // revalidateTag throws outside a request context in some edge
      // runtimes — we don't want that to fail the refresh itself.
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[aggregate/refresh] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runRefresh();
}

// Also accept GET so the cron can be triggered by a simple curl without
// -X POST, and so the route is trivially testable from a browser with
// the right header.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runRefresh();
}
