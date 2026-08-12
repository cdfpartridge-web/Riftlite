import { NextResponse } from "next/server";

import { readMulliganLabResponse } from "@/lib/mulligan-lab/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600",
};

export async function GET() {
  return NextResponse.json(await readMulliganLabResponse(), { headers: HEADERS });
}
