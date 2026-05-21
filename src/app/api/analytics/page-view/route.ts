import { type NextRequest, NextResponse } from "next/server";

import { recordPageView } from "@/lib/page-views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JSON_HEADERS = {
  "Cache-Control": "no-store",
};

function isLikelySameSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin") ?? "";
  if (!origin) return true;

  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host.endsWith("riftlite.com") || host === req.nextUrl.hostname;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!isLikelySameSite(req)) {
    return NextResponse.json({ ok: false, error: "Invalid origin" }, { status: 403, headers: JSON_HEADERS });
  }

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
  const path = String(payload.path ?? "").trim();
  if (!path) {
    return NextResponse.json({ ok: false, error: "path is required" }, { status: 400, headers: JSON_HEADERS });
  }

  try {
    const pageView = await recordPageView({
      path,
      title: String(payload.title ?? "").trim(),
      source: String(payload.source ?? "website").trim(),
      referrer: String(payload.referrer ?? "").trim(),
      occurredAt: String(payload.occurredAt ?? "").trim(),
    });
    return NextResponse.json({ ok: true, pageView }, { headers: JSON_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[analytics/page-view] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: JSON_HEADERS });
  }
}
