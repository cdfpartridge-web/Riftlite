import { NextResponse } from "next/server";

import { readMulliganLabResponse } from "@/lib/mulligan-lab/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  // Alpha/testing favors deterministic freshness over one inexpensive cached
  // aggregate-document read. Manual CDN s-maxage responses are not purged by
  // revalidatePath, so no-store guarantees a completed refresh is immediate.
  "Cache-Control": "no-store",
};

export async function GET() {
  return NextResponse.json(await readMulliganLabResponse(), { headers: HEADERS });
}
