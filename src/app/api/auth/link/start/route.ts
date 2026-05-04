import { type NextRequest } from "next/server";

import { requireUser, newLinkSession, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const session = newLinkSession(auth.decoded.uid);
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
