import { type NextRequest } from "next/server";

import {
  desktopLinkAnonymousAdoptionSourceUid,
  desktopLinkPinnedExpectedUid,
} from "@/lib/account-link";
import { requireUser, newLinkSession, socialJson } from "@/lib/social/server";
import { canonicalIdentityUid } from "@/lib/identity-server";
import { linkedReplayUid } from "@/lib/replay-v2-server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return privateLinkResponse(auth.error ?? socialJson({ error: "Authentication failed" }, 401));

  const body = await req.json().catch(() => ({})) as { expectedUid?: unknown };
  const requestedExpectedUid = typeof body.expectedUid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(body.expectedUid)
    ? body.expectedUid
    : "";
  const canonicalRequestedUid = requestedExpectedUid
    ? await canonicalIdentityUid(requestedExpectedUid, auth.db)
    : "";
  const authenticatedExpectedUid = linkedReplayUid(auth.decoded);
  const anonymousAdoptionSourceUid = desktopLinkAnonymousAdoptionSourceUid(
    auth.authenticatedUid,
    auth.decoded.uid,
    authenticatedExpectedUid,
    canonicalRequestedUid,
    auth.decoded.firebase?.sign_in_provider,
  );
  const expectedUid = anonymousAdoptionSourceUid
    ? ""
    : desktopLinkPinnedExpectedUid(
      auth.authenticatedUid,
      auth.decoded.uid,
      authenticatedExpectedUid,
      canonicalRequestedUid,
    );

  const session = {
    // Keep ownership bound to the exact Firebase identity that opened this
    // session. `decoded.uid` may already have been canonicalized by requireUser.
    ...newLinkSession(auth.authenticatedUid),
    desktopUidBindingVersion: 2,
    // A remembered desktop UID only narrows which signed-in website account may
    // complete this session. It never grants access to that UID.
    expectedUid,
    // This is server-derived proof that an old desktop copied its own
    // unassociated anonymous UID into the account field. The completed status
    // lets that exact desktop preserve and rebind its local setup safely.
    anonymousAdoptionSourceUid,
  };
  await auth.db.collection("desktopLinkSessions").doc(session.sessionId).set(session);
  const origin = req.nextUrl.origin;
  const loginUrl = `${origin}/link-device?session=${encodeURIComponent(session.sessionId)}&code=${encodeURIComponent(session.code)}`;
  return linkStartJson({
    ok: true,
    sessionId: session.sessionId,
    code: session.code,
    expiresAt: session.expiresAt,
    loginUrl,
  });
}

function linkStartJson(body: Record<string, unknown>, status = 200): Response {
  return privateLinkResponse(socialJson(body, status));
}

function privateLinkResponse(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Vary", "Authorization");
  return response;
}
