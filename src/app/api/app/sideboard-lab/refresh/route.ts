import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import { refreshSideboardLabAggregate } from "@/lib/sideboard-lab/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const requested = Number(new URL(request.url).searchParams.get("limit") ?? "");
    const result = await refreshSideboardLabAggregate(
      Number.isInteger(requested) && requested > 0 ? requested : undefined,
    );
    if (result.published) revalidatePath("/api/app/sideboard-lab");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/app/sideboard-lab/refresh] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.SIDEBOARD_LAB_REFRESH_SECRET
    ?? process.env.COMMUNITY_AGGREGATE_SECRET;
  if (!secret) return false;
  const authorization = request.headers.get("authorization") ?? "";
  return authorization === `Bearer ${secret}`
    || request.headers.get("x-sideboard-lab-refresh-secret") === secret;
}
