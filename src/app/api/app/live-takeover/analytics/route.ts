import { type NextRequest, NextResponse } from "next/server";

import { recordLiveTakeoverTelemetry } from "@/lib/live-takeover-analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...JSON_HEADERS,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    await recordLiveTakeoverTelemetry(body);
    return NextResponse.json({ ok: true }, { headers: JSON_HEADERS });
  } catch (error) {
    const code = error instanceof Error ? error.message : "analytics_unavailable";
    const status = code === "invalid_payload" || code === "invalid_token" ? 400 : 503;
    if (status === 503) {
      console.error("[live-takeover/analytics] Ingestion failed:", code);
    }
    return NextResponse.json({ ok: false, error: code }, {
      status,
      headers: JSON_HEADERS,
    });
  }
}
