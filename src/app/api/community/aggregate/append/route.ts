import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import { appendMatchToAggregate, normalizeMatch } from "@/lib/community/data";
import { verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { appendUserPublicMatch } from "@/lib/social/server";

// Force dynamic — this is a mutation, never cache the response.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Desktop-triggered single-match append. The desktop client calls this
 * right after it successfully writes a match to Firestore so users see
 * their game appear on the site within seconds instead of waiting for
 * the next scheduled full refresh.
 *
 * Cost per call: 1 Firestore read (current aggregate) + 1 write. Massive
 * win over the 500-read full refresh when only one new match has arrived.
 *
 * Auth: requires a valid Firebase ID token for the user whose match is
 * being appended. No shared bearer secret — the desktop app ships to
 * users, so any embedded secret is effectively public. The ID token is
 * per-user, expires in 1h, and can only be minted by actually signing
 * in, which bounds abuse to the signed-in user's own matches.
 *
 * Request shape:
 *   POST /api/community/aggregate/append
 *   Authorization: Bearer <firebase_id_token>
 *   Body: { id: string, match: Record<string, unknown> }
 *
 * The `match` body is the raw Firestore document shape (same as what
 * the desktop wrote to the matches collection) — the server normalizes
 * it through the exact same path the cron uses so the aggregate stays
 * consistent.
 */
export async function POST(req: NextRequest) {
  // 1. Pull the ID token out of the Authorization header.
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer (.+)$/i);
  const idToken = match?.[1]?.trim();
  if (!idToken) {
    return NextResponse.json(
      { error: "Missing Authorization: Bearer <idToken>" },
      { status: 401 },
    );
  }

  // 2. Verify the token. verifyFirebaseIdToken returns null on any
  // failure mode (expired, bad signature, wrong project, admin not
  // configured). No Firestore reads here — pure JWT verification.
  const decoded = await verifyFirebaseIdToken(idToken);
  if (!decoded) {
    return NextResponse.json(
      { error: "Invalid or expired ID token" },
      { status: 401 },
    );
  }

  // 3. Parse the body.
  let body: { id?: unknown; match?: unknown };
  try {
    body = (await req.json()) as { id?: unknown; match?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const matchId = typeof body.id === "string" ? body.id.trim() : "";
  const rawMatch =
    body.match && typeof body.match === "object" && !Array.isArray(body.match)
      ? (body.match as Record<string, unknown>)
      : null;

  if (!matchId || !rawMatch) {
    return NextResponse.json(
      { error: "Body must include { id: string, match: object }" },
      { status: 400 },
    );
  }

  // 4. Enforce: the signed-in user can only append their own matches.
  // Without this, anyone with a valid token could inject matches
  // claiming to be another player.
  const matchUid = String(rawMatch.uid ?? "").trim();
  if (matchUid && matchUid !== decoded.uid) {
    return NextResponse.json(
      { error: "Token uid does not match match.uid" },
      { status: 403 },
    );
  }

  // 5. Normalize through the shared pipeline so the aggregate shape is
  // identical to what the cron produces.
  const normalized = normalizeMatch(matchId, { ...rawMatch, uid: decoded.uid });

  try {
    const result = await appendMatchToAggregate(normalized);
    await appendUserPublicMatch(normalized).catch(() => undefined);

    // Make the new match visible on the next render instead of waiting
    // out the 10-minute unstable_cache TTL.
    try {
      revalidateTag("community-matches", "max");
    } catch {
      // Fine — just means we're not in a request context where the
      // revalidation cache is available. The 10-min TTL will pick it up.
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[aggregate/append] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
