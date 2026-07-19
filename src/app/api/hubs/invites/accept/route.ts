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
  const hubRef = auth.db.collection("hubs").doc(hubId);
  const memberRef = hubRef.collection("members").doc(auth.decoded.uid);
  const inboxRef = auth.db.collection("users").doc(auth.decoded.uid).collection("inbox").doc(inviteId);
  const now = Date.now();
  const outcome = await auth.db.runTransaction(async (tx) => {
    const [currentInviteSnap, hubSnap] = await Promise.all([
      tx.get(inviteRef),
      tx.get(hubRef),
    ]);
    const currentInvite = currentInviteSnap.data() ?? {};
    if (!hubSnap.exists || String(hubSnap.data()?.lifecycle_state ?? "") === "deleting") {
      return { status: "hub_unavailable" as const, hubName: "" };
    }
    if (!currentInviteSnap.exists || String(currentInvite.status ?? "") !== "open") {
      return { status: "invite_closed" as const, hubName: "" };
    }
    if (Number(currentInvite.expiresAt ?? 0) < now) {
      return { status: "invite_expired" as const, hubName: "" };
    }
    const hubName = String(hubSnap.data()?.name ?? currentInvite.hubName ?? hubId);
    tx.set(memberRef, {
      uid: auth.decoded.uid,
      role: "member",
      handle: profile.handle,
      displayName,
      joinedAt: now,
      updatedAt: now,
    }, { merge: true });
    tx.set(inviteRef, { status: "accepted", acceptedBy: auth.decoded.uid, acceptedAt: now }, { merge: true });
    tx.set(inboxRef, { status: "accepted", updatedAt: now }, { merge: true });
    return { status: "accepted" as const, hubName };
  });
  if (outcome.status === "hub_unavailable") {
    return socialJson({ error: "This hub is no longer available", code: "hub_unavailable" }, 410);
  }
  if (outcome.status === "invite_closed") return socialJson({ error: "Invite is no longer open" }, 409);
  if (outcome.status === "invite_expired") return socialJson({ error: "Invite expired" }, 410);
  return socialJson({ ok: true, hubId, hub: { id: hubId, name: outcome.hubName, role: "member" } });
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
