import { NextResponse } from "next/server";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { resolvePublicLiveTakeover } from "@/lib/live-takeover-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, s-maxage=15, stale-while-revalidate=15",
};

export async function GET() {
  const liveTakeover = await resolvePublicLiveTakeover(await readHomeConfig());
  return NextResponse.json({ liveTakeover }, { headers: JSON_HEADERS });
}

async function readHomeConfig(): Promise<Record<string, unknown> | null> {
  const db = getFirestoreAdmin();
  if (!db) return null;
  try {
    const snapshot = await db.collection("app_config").doc("home").get();
    return snapshot.exists ? snapshot.data() ?? null : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/app/live-takeover] Failed to read home config:", message);
    return null;
  }
}
