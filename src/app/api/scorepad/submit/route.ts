import { createHash, randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { getFirestoreAdmin } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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
  const match = normalizeScorepadMatch(body.match);
  if (!deviceId || !secret || !match) {
    return scorepadJson({ error: "Body must include deviceId, secret, and match" }, 400);
  }

  const id = cleanId(match.localId) || randomUUID();
  await db
    .collection("scorepad_devices")
    .doc(deviceId)
    .collection("entries")
    .doc(id)
    .set({
      secretHash: hashSecret(secret),
      status: "pending",
      submittedAt: Date.now(),
      expiresAt: Date.now() + THIRTY_DAYS_MS,
      match,
    });

  return scorepadJson({ ok: true, id });
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeScorepadMatch(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const match = value as Record<string, unknown>;
  const games = Array.isArray(match.games) ? match.games.map(normalizeGame).filter(Boolean) : [];
  return {
    localId: cleanId(match.localId) || randomUUID(),
    capturedAt: readString(match.capturedAt) || new Date().toISOString(),
    format: readString(match.format) === "Bo3" ? "Bo3" : "Bo1",
    result: readResult(match.result),
    myName: readString(match.myName),
    opponentName: readString(match.opponentName),
    myChampion: readString(match.myChampion),
    opponentChampion: readString(match.opponentChampion),
    deckName: readString(match.deckName),
    eventName: readString(match.eventName),
    roundName: readString(match.roundName),
    notes: readString(match.notes).slice(0, 2000),
    games,
  };
}

function normalizeGame(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const game = value as Record<string, unknown>;
  return {
    result: readResult(game.result),
    myPoints: readNumber(game.myPoints),
    oppPoints: readNumber(game.oppPoints),
    wentFirst: readString(game.wentFirst) === "1st" || readString(game.wentFirst) === "2nd" ? readString(game.wentFirst) : "",
    myBattlefield: readString(game.myBattlefield),
    oppBattlefield: readString(game.oppBattlefield),
  };
}

function readString(value: unknown): string {
  return String(value ?? "").trim();
}

function readResult(value: unknown): string {
  const raw = readString(value);
  return raw === "Win" || raw === "Loss" || raw === "Draw" || raw === "Incomplete" ? raw : "Incomplete";
}

function readNumber(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
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
