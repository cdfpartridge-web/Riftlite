import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import { refreshMulliganLabAggregate } from "@/lib/mulligan-lab/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const requested = Number(new URL(request.url).searchParams.get("limit") ?? "");
    const result = await refreshMulliganLabAggregate(
      Number.isInteger(requested) && requested > 0 ? requested : undefined,
    );
    // Only evict a still-valid public snapshot after its v2 replacement has
    // actually been persisted. A failed/empty repair keeps the prior cache.
    if (result.published) revalidatePath("/api/app/mulligan-lab");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/app/mulligan-lab/refresh] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.MULLIGAN_LAB_REFRESH_SECRET
    ?? process.env.COMMUNITY_AGGREGATE_SECRET;
  if (!secret) return false;
  const authorization = request.headers.get("authorization") ?? "";
  return authorization === `Bearer ${secret}`
    || request.headers.get("x-mulligan-lab-refresh-secret") === secret;
}
