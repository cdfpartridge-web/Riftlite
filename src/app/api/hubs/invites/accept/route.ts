import { type NextRequest } from "next/server";

import { linkedAccountUidFromCanonicalizedAuth } from "@/lib/account-link";
import { linkedReplayUid } from "@/lib/replay-v2-server/identity";
import type { HubMemberRole } from "@/lib/social/hub-permissions";
import { bestProfileDisplayName, ensureUserProfile, hubRecordOwnedByIdentity, identityUidsFor, profileIsComplete, repairProfileReferences, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  if (!linkedAccountUidFromCanonicalizedAuth(
    auth.authenticatedUid,
    auth.decoded.uid,
    linkedReplayUid(auth.decoded),
  )) return socialJson({ error: "Create or sign in to a recoverable RiftLite account first." }, 401);
  const body = await readBody(req);
  const inviteId = String(body.inviteId ?? "").trim();
  if (!inviteId) return socialJson({ error: "Missing inviteId" }, 400);
  const inviteRef = auth.db.collection("hubInvites").doc(inviteId);
  const snap = await inviteRef.get();
  const invite = snap.data();
  if (!snap.exists || !invite) return socialJson({ error: "Invite not found" }, 404);
  if (!["open", "accepted"].includes(String(invite.status ?? ""))) return socialJson({ error: "Invite is no longer open" }, 409);
  if (Number(invite.expiresAt ?? 0) < Date.now()) return socialJson({ error: "Invite expired" }, 410);

  const profile = await ensureUserProfile(auth.decoded.uid, auth.decoded.name ?? auth.decoded.email ?? "");
  if (!profileIsComplete(profile)) {
    return socialJson({ error: "Choose your RiftLite display name and handle before joining this hub.", code: "profile_incomplete" }, 409);
  }
  const displayName = bestProfileDisplayName(auth.decoded.uid, profile.displayName, profile.handle);
  await repairProfileReferences({ ...profile, displayName }).catch(() => undefined);
  const identityUids = await identityUidsFor(auth.decoded.uid);
  const hubId = String(invite.hubId ?? "");
  if (!hubId || hubId.includes("/")) return socialJson({ error: "Invite is missing its hub" }, 409);
  const hubRef = auth.db.collection("hubs").doc(hubId);
  const memberRef = hubRef.collection("members").doc(auth.decoded.uid);
  const identityMemberRefs = identityUids.map((uid) => hubRef.collection("members").doc(uid));
  const inboxRef = auth.db.collection("users").doc(auth.decoded.uid).collection("inbox").doc(inviteId);
  const outcome = await auth.db.runTransaction(async (tx) => {
    const [currentInviteSnap, hubSnap, members] = await Promise.all([
      tx.get(inviteRef),
      tx.get(hubRef),
      Promise.all(identityMemberRefs.map((ref) => tx.get(ref))),
    ]);
    const currentInvite = currentInviteSnap.data() ?? {};
    const hub = hubSnap.data() ?? {};
    if (!hubSnap.exists || String(hub.lifecycle_state ?? "") === "deleting") {
      return { status: "hub_unavailable" as const };
    }
    if (!currentInviteSnap.exists || String(currentInvite.hubId ?? "") !== hubId) {
      return { status: "invite_closed" as const };
    }
    const now = Date.now();
    if (Number(currentInvite.expiresAt ?? 0) < now) {
      return { status: "invite_expired" as const };
    }
    const targetUid = String(currentInvite.targetUid ?? "");
    const targetHandle = String(currentInvite.targetHandle ?? "").toLowerCase();
    if ((targetUid && !identityUids.includes(targetUid)) ||
        (!targetUid && targetHandle && targetHandle !== profile.handleLower)) {
      return { status: "wrong_profile" as const };
    }
    const role = existingHubRole(hub, identityUids, members);
    const currentStatus = String(currentInvite.status ?? "");
    if (currentStatus !== "open" && !(
      currentStatus === "accepted" && role && identityUids.includes(String(currentInvite.acceptedBy ?? ""))
    )) {
      return { status: "invite_closed" as const };
    }
    const hubName = String(hub.name ?? currentInvite.hubName ?? hubId);
    // An owner/admin checking a link must neither consume it nor lose their
    // role. An accepted link is only a receipt while membership still exists.
    if (role) {
      return { status: "already_member" as const, hubName, role };
    }
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
    return { status: "accepted" as const, hubName, role: "member" as const };
  });
  if (outcome.status === "hub_unavailable") {
    return socialJson({ error: "This hub is no longer available", code: "hub_unavailable" }, 410);
  }
  if (outcome.status === "invite_closed") return socialJson({ error: "Invite is no longer open" }, 409);
  if (outcome.status === "invite_expired") return socialJson({ error: "Invite expired" }, 410);
  if (outcome.status === "wrong_profile") return socialJson({ error: "Invite was sent to another profile" }, 403);
  return socialJson({
    ok: true,
    hubId,
    alreadyMember: outcome.status === "already_member",
    hub: { id: hubId, name: outcome.hubName, role: outcome.role },
  });
}

function existingHubRole(
  hub: Record<string, unknown>,
  identityUids: string[],
  members: Array<{ exists: boolean; data(): Record<string, unknown> | undefined }>,
): HubMemberRole | "" {
  if (hubRecordOwnedByIdentity(hub, identityUids)) return "owner";
  const rank: Record<HubMemberRole, number> = { member: 1, admin: 2, owner: 3 };
  let selected: HubMemberRole | "" = "";
  for (const member of members) {
    const role = member.exists ? member.data()?.role : "";
    if (role !== "member" && role !== "admin" && role !== "owner") continue;
    if (!selected || rank[role] > rank[selected]) selected = role;
  }
  return selected;
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
