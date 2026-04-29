import { createHash } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { getFirestoreAdmin } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const db = getFirestoreAdmin();
  if (!db) {
    return scorepadJson({ error: "Scorepad inbox is not configured" }, 503);
  }

  const body = await readBody(req);
  const deviceId = cleanId(body.deviceId);
  const secret = readString(body.secret);
  const ids = Array.isArray(body.ids) ? body.ids.map(cleanId).filter(Boolean).slice(0, 100) : [];
  if (!deviceId || !secret || !ids.length) {
    return scorepadJson({ error: "Body must include deviceId, secret, and ids" }, 400);
  }

  const secretHash = hashSecret(secret);
  let deleted = 0;
  for (const id of ids) {
    const ref = db.collection("scorepad_devices").doc(deviceId).collection("entries").doc(id);
    const doc = await ref.get();
    if (doc.exists && doc.data()?.secretHash === secretHash) {
      await ref.delete();
      deleted += 1;
    }
  }

  return scorepadJson({ ok: true, deleted });
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readString(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanId(value: unknown): string {
  return readString(value).replace(/[^a-z0-9-]/gi, "").slice(0, 80);
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function scorepadJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}
