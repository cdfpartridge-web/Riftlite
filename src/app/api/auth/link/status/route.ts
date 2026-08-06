import { type NextRequest } from "next/server";

import { createFirebaseCustomToken } from "@/lib/firebase/admin";
import { desktopLinkCanReissueToken, desktopLinkSessionOwnedBy } from "@/lib/account-link";
import { canonicalIdentityUid } from "@/lib/identity-server";
import { requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Version-2 sessions are deliberately owned by the raw Firebase UID. Avoid
  // resolving the canonical identity on every 2.5-second pending poll; old
  // sessions pay that cost only when their stored owner does not match raw UID.
  const auth = await requireUser(req, { canonicalize: false });
  if ("error" in auth) return privateLinkResponse(auth.error ?? socialJson({ error: "Authentication failed" }, 401));

  const sessionId = req.nextUrl.searchParams.get("sessionId")?.trim() ?? "";
  if (!sessionId) return linkStatusJson({ error: "Missing sessionId" }, 400);

  const ref = auth.db.collection("desktopLinkSessions").doc(sessionId);
  const snap = await ref.get();
  const data = snap.data();
  if (!snap.exists || !data) return linkStatusJson({ error: "Link session not found" }, 404);
  let canonicalAuthenticatedUid = auth.authenticatedUid;
  if (
    Number(data.desktopUidBindingVersion ?? 0) < 2 &&
    String(data.desktopUid ?? "").trim() !== auth.authenticatedUid
  ) {
    canonicalAuthenticatedUid = await canonicalIdentityUid(auth.authenticatedUid, auth.db);
  }
  if (!desktopLinkSessionOwnedBy(
    data.desktopUid,
    auth.authenticatedUid,
    canonicalAuthenticatedUid,
    data.desktopUidBindingVersion,
  )) {
    return linkStatusJson({ error: "Session belongs to another device" }, 403);
  }
  if (
    Number(data.expiresAt ?? 0) < Date.now() &&
    ["pending", "completing"].includes(String(data.status ?? ""))
  ) {
    return linkStatusJson({ status: "expired" });
  }

  if (String(data.status ?? "") === "complete") {
    const storedLinkedUid = String(data.linkedUid ?? "").trim();
    const linkedUid = await canonicalIdentityUid(storedLinkedUid, auth.db);
    if (!linkedUid) return linkStatusJson({ error: "Link session is missing its linked account" }, 500);
    const storedCustomToken = String(data.customToken ?? "");
    // Tokens written by old versions may target an alias UID. Replace those
    // before returning them so the response UID and exchanged token agree.
    let customToken = storedCustomToken && storedLinkedUid === linkedUid
      ? storedCustomToken
      : "";
    if (!customToken && desktopLinkCanReissueToken(data.status, linkedUid, data.expiresAt)) {
      customToken = await createFirebaseCustomToken(linkedUid) ?? "";
      if (!customToken) return linkStatusJson({ error: "Could not recover desktop sign-in token" }, 500);
      await ref.set({ tokenReissuedAt: Date.now() }, { merge: true });
    }
    if (storedCustomToken) {
      await ref.set({
        customToken: "",
        consumedAt: Date.now(),
        linkedUid,
      }, { merge: true });
    }
    const storedAnonymousAdoptionSourceUid = String(data.anonymousAdoptionSourceUid ?? "").trim();
    const anonymousAdoptionSourceUid = storedAnonymousAdoptionSourceUid &&
      storedAnonymousAdoptionSourceUid === String(data.desktopUid ?? "").trim() &&
      storedAnonymousAdoptionSourceUid !== linkedUid
      ? storedAnonymousAdoptionSourceUid
      : "";
    return linkStatusJson({
      status: "complete",
      uid: linkedUid,
      email: String(data.linkedEmail ?? ""),
      displayName: String(data.linkedName ?? ""),
      customToken,
      ...(anonymousAdoptionSourceUid ? { anonymousAdoptionSourceUid } : {}),
    });
  }

  const status = String(data.status ?? "pending");
  return linkStatusJson({ status: status === "completing" ? "pending" : status });
}

function linkStatusJson(body: Record<string, unknown>, status = 200): Response {
  return privateLinkResponse(socialJson(body, status));
}

function privateLinkResponse(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Authorization");
  response.headers.set("Expires", "0");
  return response;
}
