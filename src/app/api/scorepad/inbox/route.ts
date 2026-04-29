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
  if (!deviceId || !secret) {
    return scorepadJson({ error: "Body must include deviceId and secret" }, 400);
  }

  const secretHash = hashSecret(secret);
  const snapshot = await db
    .collection("scorepad_devices")
    .doc(deviceId)
    .collection("entries")
    .limit(100)
    .get();

  const entries = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as {
      id: string;
      secretHash?: string;
      status?: string;
      submittedAt?: number;
      match?: unknown;
    })
    .filter((doc) => doc.secretHash === secretHash && doc.status === "pending")
    .sort((a, b) => Number(a.submittedAt ?? 0) - Number(b.submittedAt ?? 0))
    .map((doc) => ({
      id: doc.id,
      submittedAt: Number(doc.submittedAt ?? 0),
      match: doc.match ?? {},
    }));

  return scorepadJson({ entries });
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
