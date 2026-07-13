import { type NextRequest } from "next/server";

import { requireUser, newLinkSession, socialJson } from "@/lib/social/server";
import { linkedReplayUid } from "@/lib/replay-v2-server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({})) as { expectedUid?: unknown };
  const requestedExpectedUid = typeof body.expectedUid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(body.expectedUid)
    ? body.expectedUid
    : "";
  const authenticatedExpectedUid = linkedReplayUid(auth.decoded);

  const session = {
    ...newLinkSession(auth.decoded.uid),
    // A remembered desktop UID only narrows which signed-in website account may
    // complete this session. It never grants access to that UID.
    expectedUid: authenticatedExpectedUid || requestedExpectedUid,
  };
  await auth.db.collection("desktopLinkSessions").doc(session.sessionId).set(session);
  const origin = req.nextUrl.origin;
  const loginUrl = `${origin}/link-device?session=${encodeURIComponent(session.sessionId)}&code=${encodeURIComponent(session.code)}`;
  return socialJson({
    ok: true,
    sessionId: session.sessionId,
    code: session.code,
    expiresAt: session.expiresAt,
    loginUrl,
  });
}
