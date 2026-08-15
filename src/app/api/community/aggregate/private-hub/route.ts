import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import {
  PrivateHubAggregateEventError,
  readPrivateHubAggregateDuplicate,
  recordPrivateHubAggregateEvent,
} from "@/lib/community/data";
import { assertHubCapability, identityUidsFor, requireUser } from "@/lib/social/server";

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
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  let body: PrivateHubCounterBody;
  try {
    body = (await req.json()) as PrivateHubCounterBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action !== "upsert" && body.action !== "delete") {
    return NextResponse.json({ error: "action must be upsert or delete" }, { status: 400 });
  }
  const action = body.action;
  const hubId = typeof body.hubId === "string" ? body.hubId.trim() : "";
  const matchId = typeof body.matchId === "string" ? body.matchId.trim() : "";
  if (
    !hubId || !matchId || hubId.includes("/") || matchId.includes("/") ||
    hubId.length > 128 || matchId.length > 256
  ) {
    return NextResponse.json({ error: "Valid hubId and matchId are required" }, { status: 400 });
  }
  const identityUids = await identityUidsFor(auth.decoded.uid, auth.db);
  const identityUidSet = new Set(identityUids);
  const requestedUid = typeof body.uid === "string" ? body.uid.trim() : "";
  if (requestedUid && !identityUidSet.has(requestedUid)) {
    return NextResponse.json({ error: "Token uid does not match body.uid" }, { status: 403 });
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";

  // Old desktop builds retry the whole hub upload whenever the optional Web
  // Replay attachment fails. A server-owned index hit proves this aggregate
  // upsert already completed, so acknowledge it before repeating hub/profile
  // authorization and the six-document counter transaction. This is a
  // read-only fast path: it neither restores membership nor grants replay
  // access, and foreign/malformed index rows fall through to the full checks.
  if (action === "upsert") {
    const duplicate = await readPrivateHubAggregateDuplicate({
      hubId,
      matchId,
      identityUids,
    }, auth.db);
    if (duplicate) {
      return NextResponse.json({ ok: true, ...duplicate });
    }
  }

  const hubSnap = await auth.db.collection("hubs").doc(hubId).get();
  const hub = hubSnap?.data() ?? {};
  if (!hubSnap?.exists || String(hub.lifecycle_state ?? "") === "deleting") {
    return NextResponse.json({ error: "You do not have permission for this hub action." }, { status: 403 });
  }
  // Legacy password-only hubs intentionally retain their historical
  // signed-in write behavior. Account-managed hubs require membership.
  if (String(hub.role_mode ?? "") === "account") {
    try {
      await assertHubCapability(hubId, auth.decoded.uid, "participate");
    } catch {
      return NextResponse.json({ error: "You do not have permission for this hub action." }, { status: 403 });
    }
  }

  try {
    const result = await recordPrivateHubAggregateEvent({
      action,
      hubId,
      matchId,
      uid: auth.decoded.uid,
      identityUids,
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
    if (error instanceof PrivateHubAggregateEventError) {
      return NextResponse.json({ ok: false, error: message, code: error.code }, { status: error.status });
    }
    console.error("[aggregate/private-hub] Failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
