import { type NextRequest } from "next/server";

import { createFirebaseCustomToken, getFirestoreAdmin, verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { desktopLinkAllowsIdentity } from "@/lib/account-link";
import { linkedReplayUid } from "@/lib/replay-v2-server/identity";
import { associateLinkedIdentity, ensureUserProfile, repairHistoricalDesktopIdentityAssociations, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const db = getFirestoreAdmin();
  if (!db) return socialJson({ error: "Firebase admin is not configured" }, 503);

  const body = await readBody(req);
  const sessionId = String(body.sessionId ?? "").trim();
  const code = String(body.code ?? "").trim().toUpperCase();
  const idToken = String(body.idToken ?? "").trim();
  if (!sessionId || !code || !idToken) {
    return socialJson({ error: "Missing session, code, or id token" }, 400);
  }

  const decoded = await verifyFirebaseIdToken(idToken);
  if (!decoded) return socialJson({ error: "Invalid sign-in token" }, 401);
  if (!linkedReplayUid(decoded)) return socialJson({ error: "Finish Google or email sign in before linking this desktop." }, 401);

  const ref = db.collection("desktopLinkSessions").doc(sessionId);
  const snap = await ref.get();
  const data = snap.data();
  if (!snap.exists || !data) return socialJson({ error: "Link session not found" }, 404);
  if (String(data.status ?? "") !== "pending") return socialJson({ error: "Link session has already been used" }, 409);
  if (String(data.code ?? "").toUpperCase() !== code) return socialJson({ error: "Link code did not match" }, 403);
  if (Number(data.expiresAt ?? 0) < Date.now()) return socialJson({ error: "Link session expired" }, 410);
  if (!desktopLinkAllowsIdentity(String(data.expectedUid ?? ""), decoded.uid)) {
    return socialJson({
      error: "This device must reconnect to the same RiftLite account. Use Switch account in the desktop app if you intend to change accounts.",
    }, 409);
  }

  const profile = await ensureUserProfile(decoded.uid, decoded.name ?? "", decoded.email ?? "");
  await associateLinkedIdentity(String(data.desktopUid ?? ""), decoded.uid);
  await repairHistoricalDesktopIdentityAssociations(decoded.uid);
  const customToken = await createFirebaseCustomToken(decoded.uid);
  if (!customToken) return socialJson({ error: "Could not create desktop sign-in token" }, 500);

  await ref.set({
    status: "complete",
    linkedUid: decoded.uid,
    linkedEmail: decoded.email ?? "",
    linkedName: profile.displayName,
    customToken,
    completedAt: Date.now(),
  }, { merge: true });

  return socialJson({ ok: true });
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
