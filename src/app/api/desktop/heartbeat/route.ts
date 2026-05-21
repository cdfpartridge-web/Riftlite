import { type NextRequest, NextResponse } from "next/server";

import { recordAppUsageHeartbeat } from "@/lib/app-usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JSON_HEADERS = {
  "Cache-Control": "no-store",
};

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400, headers: JSON_HEADERS });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400, headers: JSON_HEADERS });
  }

  const payload = body as Record<string, unknown>;
  try {
    const heartbeat = await recordAppUsageHeartbeat({
      installId: String(payload.installId ?? "").trim(),
      appVersion: String(payload.appVersion ?? "").trim(),
      platform: String(payload.platform ?? "").trim(),
      channel: String(payload.channel ?? "desktop").trim(),
      linkedAccount: payload.linkedAccount === true,
      replayEnabled: payload.replayEnabled !== false,
      videoReplayEnabled: payload.videoReplayEnabled !== false,
      activePlatforms: Array.isArray(payload.activePlatforms)
        ? payload.activePlatforms.filter((item): item is string => typeof item === "string")
        : [],
      occurredAt: String(payload.occurredAt ?? "").trim(),
    });
    return NextResponse.json({ ok: true, heartbeat }, { headers: JSON_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[desktop/heartbeat] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: JSON_HEADERS });
  }
}
