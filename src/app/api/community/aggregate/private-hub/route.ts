import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import { recordPrivateHubAggregateEvent } from "@/lib/community/data";
import { verifyFirebaseIdToken } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PrivateHubCounterBody = {
  action?: unknown;
  hubId?: unknown;
  matchId?: unknown;
  uid?: unknown;
  username?: unknown;
};

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer (.+)$/i);
  const idToken = match?.[1]?.trim();
  if (!idToken) {
    return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
  }

  const decoded = await verifyFirebaseIdToken(idToken);
  if (!decoded) {
    return NextResponse.json({ error: "Invalid or expired ID token" }, { status: 401 });
  }

  let body: PrivateHubCounterBody;
  try {
    body = (await req.json()) as PrivateHubCounterBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action === "delete" ? "delete" : "upsert";
  const hubId = typeof body.hubId === "string" ? body.hubId.trim() : "";
  const matchId = typeof body.matchId === "string" ? body.matchId.trim() : "";
  const uid = typeof body.uid === "string" && body.uid.trim() ? body.uid.trim() : decoded.uid;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (uid !== decoded.uid) {
    return NextResponse.json({ error: "Token uid does not match body.uid" }, { status: 403 });
  }

  try {
    const result = await recordPrivateHubAggregateEvent({
      action,
      hubId,
      matchId,
      uid,
      username,
    });
    try {
      revalidateTag("community-matches", "max");
    } catch {
      // Cache will naturally expire if the request context cannot revalidate.
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[aggregate/private-hub] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
