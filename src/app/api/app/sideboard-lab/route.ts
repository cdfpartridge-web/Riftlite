import { NextResponse } from "next/server";

import { readSideboardLabResponse } from "@/lib/sideboard-lab/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

export async function GET() {
  return NextResponse.json(await readSideboardLabResponse(), { headers: HEADERS });
}
