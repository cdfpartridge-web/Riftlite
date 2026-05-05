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
  if (String(invite.status ?? "") !== "open") {
    await auth.db.collection("users").doc(auth.decoded.uid).collection("inbox").doc(inviteId).set({
      status: String(invite.status ?? "closed"),
      updatedAt: Date.now(),
    }, { merge: true });
    return socialJson({ ok: true });
  }

  const now = Date.now();
  await inviteRef.set({ status: "declined", declinedBy: auth.decoded.uid, declinedAt: now }, { merge: true });
  await auth.db.collection("users").doc(auth.decoded.uid).collection("inbox").doc(inviteId).set({
    status: "declined",
    updatedAt: now,
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
