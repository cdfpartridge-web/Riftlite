import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import {
  appendMatchToAggregate,
  invalidateCommunityMatchMemoryCache,
  normalizeMatch,
} from "@/lib/community/data";
import {
  appendUserPublicMatch,
  bestProfileDisplayName,
  ensureUserProfile,
  identityUidsFor,
  requireUser,
} from "@/lib/social/server";

// Force dynamic — this is a mutation, never cache the response.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Desktop-triggered single-match append. The desktop client calls this
 * right after it successfully writes a match to Firestore so users see
 * their game appear on the site within seconds instead of waiting for
 * the next scheduled full refresh.
 *
 * The append keeps the latest public window fresh immediately and records one
 * idempotent change-journal row. The scheduled refresh consumes that journal
 * instead of rescanning every match in the rolling 30-day statistics window.
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
  // Canonicalize through the same immutable identity mapping used by account,
  // hub, and Web Replay ownership.
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  // A desktop can briefly retain its older credential after linking; reports
  // must still land on the canonical profile rather than splitting history.
  const decoded = auth.decoded;

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

  // The desktop writes this document first. Read that authoritative copy so a
  // caller cannot overwrite another player's aggregate row by reusing a known
  // match id with a forged request body.
  const storedMatchSnapshot = await auth.db.collection("matches").doc(matchId).get();
  if (!storedMatchSnapshot.exists) {
    return NextResponse.json(
      { error: "Write the match to RiftLite before appending it to the community feed" },
      { status: 409 },
    );
  }
  const storedMatch = storedMatchSnapshot.data() ?? {};

  // 4. Enforce: the signed-in account can append only its own stored match.
  const matchUid = String(storedMatch.uid ?? "").trim();
  const identityUids = new Set(await identityUidsFor(decoded.uid, auth.db));
  if (!matchUid || !identityUids.has(matchUid)) {
    return NextResponse.json(
      { error: "Token uid does not match match.uid" },
      { status: 403 },
    );
  }

  // 5. Normalize through the shared pipeline so the aggregate shape is
  // identical to what the cron produces.
  const profile = await ensureUserProfile(decoded.uid, decoded.name ?? "", decoded.email ?? "", auth.db);
  const displayName = bestProfileDisplayName(decoded.uid, profile.displayName, profile.handle);
  const normalized = normalizeMatch(matchId, {
    ...storedMatch,
    uid: decoded.uid,
    owner_uid: decoded.uid,
    username: displayName,
    owner_display_name: displayName,
    owner_handle: profile.handle,
  });

  try {
    const result = await appendMatchToAggregate(normalized);
    await appendUserPublicMatch(normalized).catch(() => undefined);
    invalidateCommunityMatchMemoryCache();

    // Make the new match visible on the next render instead of waiting
    // out the 30-minute server cache TTL.
    try {
      revalidateTag("community-matches", "max");
    } catch {
      // Fine — just means we're not in a request context where the
      // revalidation cache is available. The server TTL will pick it up.
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[aggregate/append] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
