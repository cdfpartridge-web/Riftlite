import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import {
  invalidateCommunityMatchMemoryCache,
  refreshCommunityAggregate,
} from "@/lib/community/data";
import { getFirestoreAdmin } from "@/lib/firebase/admin";

// Force dynamic so this route never gets cached — each cron run must
// actually execute the refresh.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AGGREGATE_COLLECTION = "aggregates";
const AGGREGATE_DOCUMENT = "community-v1";
const REFRESH_STATE_DOCUMENT = "community-refresh-state-v1";
const REFRESH_STATE_VERSION = 1;

/**
 * Read the public match window from Firestore, normalize it, count the
 * lifetime public matches via Firestore aggregation, repair the
 * lifetime public player index if needed, and write the result to the
 * `aggregates/community-v1` doc. Triggered daily by GitHub Actions
 * (see .github/workflows/refresh-aggregates.yml).
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

async function runRefresh(request: NextRequest) {
  try {
    const force = isTrue(new URL(request.url).searchParams.get("force"));
    if (!force) {
      const skipped = await communityRefreshAlreadyCompletedToday();
      if (skipped) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          skipReason: "already-repaired-today",
          publicLifetimeMatchCount: skipped.publicLifetimeMatchCount,
          completedOn: skipped.completedOn,
        });
      }
    }

    const result = await refreshCommunityAggregate();
    invalidateCommunityMatchMemoryCache();
    await recordCommunityRefresh(result.publicLifetimeMatchCount);

    // Invalidate the cached match window so user-facing pages pick up
    // the new data on their next request instead of waiting out the
    // server cache TTL.
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

    return NextResponse.json({ ok: true, skipped: false, ...result });
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
  return runRefresh(req);
}

// Also accept GET so the cron can be triggered by a simple curl without
// -X POST, and so the route is trivially testable from a browser with
// the right header.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runRefresh(req);
}

async function communityRefreshAlreadyCompletedToday(): Promise<{
  completedOn: string;
  publicLifetimeMatchCount: number;
} | null> {
  const db = getFirestoreAdmin();
  if (!db) return null;
  try {
    const [stateSnapshot, aggregateSnapshot] = await Promise.all([
      db.collection(AGGREGATE_COLLECTION).doc(REFRESH_STATE_DOCUMENT).get(),
      db.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOCUMENT).get(),
    ]);
    const state = stateSnapshot.data() ?? {};
    const aggregate = aggregateSnapshot.data() ?? {};
    const completedOn = typeof state.completedOn === "string" ? state.completedOn : "";
    const stateCount = nonNegativeInteger(state.publicLifetimeMatchCount);
    const aggregateCount = nonNegativeInteger(aggregate.publicLifetimeMatchCount);
    if (
      state.version !== REFRESH_STATE_VERSION ||
      completedOn !== new Date().toISOString().slice(0, 10) ||
      stateCount === null ||
      aggregateCount === null ||
      stateCount !== aggregateCount
    ) return null;
    return { completedOn, publicLifetimeMatchCount: aggregateCount };
  } catch (error) {
    // The guard is an optimization only. If its two bounded reads fail, retain
    // the existing full repair behavior instead of losing the safety net.
    console.error("[aggregate/refresh] Refresh guard failed:", safeError(error));
    return null;
  }
}

async function recordCommunityRefresh(publicLifetimeMatchCount: number): Promise<void> {
  const db = getFirestoreAdmin();
  if (!db) return;
  const completedAt = new Date();
  try {
    await db.collection(AGGREGATE_COLLECTION).doc(REFRESH_STATE_DOCUMENT).set({
      version: REFRESH_STATE_VERSION,
      completedOn: completedAt.toISOString().slice(0, 10),
      completedAt,
      publicLifetimeMatchCount,
    });
  } catch (error) {
    // The aggregate itself is already repaired. A failed optimization marker
    // should not turn the webhook red and invite an expensive retry.
    console.error("[aggregate/refresh] Refresh marker write failed:", safeError(error));
  }
}

function nonNegativeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function isTrue(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
