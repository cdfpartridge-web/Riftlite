import { NextResponse } from "next/server";

import { getCachedHomeConfig } from "@/lib/home-config";
import { resolvePublicLiveTakeover } from "@/lib/live-takeover-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
};

export async function GET() {
  const liveTakeover = await resolvePublicLiveTakeover(await getCachedHomeConfig());
  return NextResponse.json({ liveTakeover }, { headers: JSON_HEADERS });
}
