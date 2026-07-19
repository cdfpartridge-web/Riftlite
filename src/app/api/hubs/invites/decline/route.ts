import { type NextRequest } from "next/server";

import { ensureUserProfile, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const body = await readBody(req);
  const inviteId = String(body.inviteId ?? "").trim();
  if (!inviteId) return socialJson({ error: "Missing inviteId" }, 400);

  const inviteRef = auth.db.collection("hubInvites").doc(inviteId);
  const snap = await inviteRef.get();
  const invite = snap.data();
  if (!snap.exists || !invite) return socialJson({ error: "Invite not found" }, 404);

  const profile = await ensureUserProfile(auth.decoded.uid, auth.decoded.name ?? auth.decoded.email ?? "");
  const targetUid = String(invite.targetUid ?? "");
  const targetHandle = String(invite.targetHandle ?? "").toLowerCase();
  if ((targetUid && targetUid !== auth.decoded.uid) || (targetHandle && targetHandle !== profile.handleLower)) {
    return socialJson({ error: "Invite was sent to another profile" }, 403);
  }
  const hubId = String(invite.hubId ?? "").trim();
  if (!hubId) return socialJson({ error: "Invite is missing its hub" }, 409);
  const hubRef = auth.db.collection("hubs").doc(hubId);
  const inboxRef = auth.db.collection("users").doc(auth.decoded.uid).collection("inbox").doc(inviteId);
  const now = Date.now();
  await auth.db.runTransaction(async (tx) => {
    const [currentInviteSnap, hubSnap] = await Promise.all([
      tx.get(inviteRef),
      tx.get(hubRef),
    ]);
    if (!currentInviteSnap.exists) {
      tx.delete(inboxRef);
      return;
    }
    if (!hubSnap.exists || String(hubSnap.data()?.lifecycle_state ?? "") === "deleting") {
      tx.delete(inviteRef);
      tx.delete(inboxRef);
      return;
    }
    const currentStatus = String(currentInviteSnap.data()?.status ?? "closed");
    if (currentStatus !== "open") {
      tx.set(inboxRef, { status: currentStatus, updatedAt: now }, { merge: true });
      return;
    }
    tx.set(inviteRef, { status: "declined", declinedBy: auth.decoded.uid, declinedAt: now }, { merge: true });
    tx.set(inboxRef, { status: "declined", updatedAt: now }, { merge: true });
  });
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
