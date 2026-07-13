import { type NextRequest } from "next/server";

import { linkedReplayUid } from "@/lib/replay-v2-server/identity";
import { bestProfileDisplayName, ensureUserProfile, identityUidsFor, profileIsComplete, repairProfileReferences, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  if (!linkedReplayUid(auth.decoded)) return socialJson({ error: "Create or sign in to a recoverable RiftLite account first." }, 401);
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
  if (!profileIsComplete(profile)) {
    return socialJson({ error: "Choose your RiftLite display name and handle before joining this hub.", code: "profile_incomplete" }, 409);
  }
  const displayName = bestProfileDisplayName(auth.decoded.uid, profile.displayName, profile.handle);
  await repairProfileReferences({ ...profile, displayName }).catch(() => undefined);
  const targetUid = String(invite.targetUid ?? "");
  const identityUids = await identityUidsFor(auth.decoded.uid);
  if (targetUid && !identityUids.includes(targetUid)) {
    return socialJson({ error: "Invite was sent to another profile" }, 403);
  }
  const targetHandle = String(invite.targetHandle ?? "").toLowerCase();
  if (!targetUid && targetHandle && targetHandle !== profile.handleLower) {
    return socialJson({ error: "Invite was sent to another profile" }, 403);
  }
  const hubId = String(invite.hubId ?? "");
  const hubSnap = await auth.db.collection("hubs").doc(hubId).get();
  const hubName = String(hubSnap.data()?.name ?? invite.hubName ?? hubId);
  await auth.db.collection("hubs").doc(hubId).collection("members").doc(auth.decoded.uid).set({
    uid: auth.decoded.uid,
    role: "member",
    handle: profile.handle,
    displayName,
    joinedAt: Date.now(),
    updatedAt: Date.now(),
  }, { merge: true });
  await inviteRef.set({ status: "accepted", acceptedBy: auth.decoded.uid, acceptedAt: Date.now() }, { merge: true });
  await auth.db.collection("users").doc(auth.decoded.uid).collection("inbox").doc(inviteId).set({
    status: "accepted",
    updatedAt: Date.now(),
  }, { merge: true });
  return socialJson({ ok: true, hubId, hub: { id: hubId, name: hubName, role: "member" } });
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
