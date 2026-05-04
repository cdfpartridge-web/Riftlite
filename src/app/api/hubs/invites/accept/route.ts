import { type NextRequest } from "next/server";

import { cleanDisplayName, ensureUserProfile, requireUser, socialJson } from "@/lib/social/server";

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
  if (String(invite.status ?? "") !== "open") return socialJson({ error: "Invite is no longer open" }, 409);
  if (Number(invite.expiresAt ?? 0) < Date.now()) return socialJson({ error: "Invite expired" }, 410);

  const profile = await ensureUserProfile(auth.decoded.uid, auth.decoded.name ?? auth.decoded.email ?? "");
  const targetHandle = String(invite.targetHandle ?? "").toLowerCase();
  if (targetHandle && targetHandle !== profile.handleLower) {
    return socialJson({ error: "Invite was sent to another profile" }, 403);
  }
  const hubId = String(invite.hubId ?? "");
  await auth.db.collection("hubs").doc(hubId).collection("members").doc(auth.decoded.uid).set({
    uid: auth.decoded.uid,
    role: "member",
    handle: profile.handle,
    displayName: cleanDisplayName(profile.displayName),
    joinedAt: Date.now(),
    updatedAt: Date.now(),
  }, { merge: true });
  await inviteRef.set({ status: "accepted", acceptedBy: auth.decoded.uid, acceptedAt: Date.now() }, { merge: true });
  return socialJson({ ok: true, hubId });
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
