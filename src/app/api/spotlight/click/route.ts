import { type NextRequest, NextResponse } from "next/server";

import { recordSpotlightClick } from "@/lib/spotlight-clicks";

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
  const spotlightId = String(payload.spotlightId ?? "").trim();
  const linkId = String(payload.linkId ?? "").trim();

  if (!spotlightId || !linkId) {
    return NextResponse.json({ ok: false, error: "spotlightId and linkId are required" }, { status: 400, headers: JSON_HEADERS });
  }

  try {
    const click = await recordSpotlightClick({
      spotlightId,
      linkId,
      appVersion: String(payload.appVersion ?? "").trim(),
      source: String(payload.source ?? "desktop").trim(),
      occurredAt: String(payload.occurredAt ?? "").trim(),
    });
    return NextResponse.json({ ok: true, click }, { headers: JSON_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[spotlight/click] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: JSON_HEADERS });
  }
}
