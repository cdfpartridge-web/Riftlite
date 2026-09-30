import "server-only";

import { randomBytes } from "node:crypto";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { cleanText, resolveTeamRef, socialJson, type LinkedSocialAuth } from "@/lib/social-hub";
import { identityUidsFor, validHandle, type TeamMemberRole } from "@/lib/social/server";

const TTL_MS = 14 * 24 * 60 * 60 * 1_000;
const INVITE_ID = /^[a-f0-9]{48}$/;
type Data = Record<string, unknown>;

export type TeamInviteSummary = {
  inviteId: string;
  teamName: string;
  senderName: string;
  targetHandle: string;
  status: string;
  expiresAt: number;
  found: boolean;
};
export type AccountTeamInviteSummary = Omit<TeamInviteSummary, "found"> & { teamId: string; createdAt: number };

export class TeamInviteError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}

export async function teamInviteResponse(action: () => Promise<Record<string, unknown>>) {
  try { return socialJson(await action()); }
  catch (error) {
    if (error instanceof TeamInviteError) return socialJson({ error: error.message, code: error.code }, error.status);
    console.error("[team-invites] Request failed", error);
    return socialJson({ error: "Team invitations are temporarily unavailable. Please try again." }, 503);
  }
}

/** The bearer link reveals only invitation metadata, never team records or identities. */
export async function loadTeamInviteSummary(inviteId: string, providedDb?: Firestore): Promise<TeamInviteSummary> {
  const empty = { inviteId, teamName: "Private team", senderName: "A team admin", targetHandle: "", status: "", expiresAt: 0, found: false };
  if (!INVITE_ID.test(inviteId)) return empty;
  const db = providedDb ?? getFirestoreAdmin();
  if (!db) return empty;
  const invite = await db.collection("teamInvites").doc(inviteId).get();
  if (!invite.exists) return empty;
  const data = invite.data() ?? {};
  const teamId = cleanId(data.teamId);
  if (!teamId) return empty;
  const team = await db.collection("teams").doc(teamId).get();
  if (!team.exists || unavailable(team.data() ?? {})) return empty;
  return { inviteId, ...publicFields(data), found: true };
}

export async function createTeamInvite(auth: LinkedSocialAuth, teamId: string, targetInput: unknown) {
  const team = await requiredTeam(auth.db, teamId);
  const actorUids = await identityUidsFor(auth.decoded.uid, auth.db);
  const targetHandle = String(targetInput ?? "").trim().replace(/^@+/, "");
  if (targetHandle && !validHandle(targetHandle)) {
    throw new TeamInviteError("Enter a valid RiftLite handle.", 400, "invalid_handle");
  }
  const handleRef = targetHandle ? auth.db.collection("handles").doc(targetHandle.toLowerCase()) : null;
  const handle = handleRef ? await handleRef.get() : null;
  const targetUid = String(handle?.data()?.uid ?? "").trim();
  if (targetHandle && !targetUid) throw new TeamInviteError("No RiftLite profile has that handle.", 404, "profile_not_found");
  const targetUids = targetUid ? await identityUidsFor(targetUid, auth.db) : [];
  const inviteId = randomBytes(24).toString("hex");
  const inviteRef = auth.db.collection("teamInvites").doc(inviteId);
  const result = await auth.db.runTransaction(async (tx) => {
    const [currentTeam, actorRole, targetRole, currentHandle] = await Promise.all([
      tx.get(team.ref), readTeamRole(tx, team.ref, actorUids),
      targetUids.length ? readTeamRole(tx, team.ref, targetUids) : Promise.resolve(""),
      handleRef ? tx.get(handleRef) : Promise.resolve(null),
    ]);
    const data = currentTeam.data() ?? {};
    assertAvailable(currentTeam.exists, data);
    assertAdmin(actorRole);
    if (handleRef && String(currentHandle?.data()?.uid ?? "") !== targetUid) {
      throw new TeamInviteError("That handle changed. Create the invitation again.", 409, "profile_changed");
    }
    if (targetRole) throw new TeamInviteError("That player is already a member of this team.", 409, "already_member");
    const now = Date.now();
    const invite = {
      inviteId, teamId: team.id, teamName: cleanText(data.name, 60),
      senderName: cleanText(auth.displayName, 80) || "A team admin",
      createdBy: auth.decoded.uid, targetUid, targetHandle,
      status: "open", createdAt: now, expiresAt: now + TTL_MS,
    };
    tx.set(inviteRef, invite);
    return accountSummary(inviteId, invite);
  });
  return { ok: true, invite: result };
}

export async function listTeamInvites(auth: LinkedSocialAuth, teamId: string) {
  const team = await requiredTeam(auth.db, teamId);
  const identities = await identityUidsFor(auth.decoded.uid, auth.db);
  return auth.db.runTransaction(async (tx) => {
    const [role, rows] = await Promise.all([
      readTeamRole(tx, team.ref, identities),
      tx.get(auth.db.collection("teamInvites").where("teamId", "==", team.id)
        .where("status", "==", "open").where("expiresAt", ">", Date.now()).orderBy("expiresAt", "desc").limit(50)),
    ]);
    assertAdmin(role);
    return { ok: true, invites: pendingSummaries(rows.docs) };
  });
}

export async function listTargetedTeamInvites(auth: LinkedSocialAuth) {
  const identities = await identityUidsFor(auth.decoded.uid, auth.db);
  const rows = await Promise.all(Array.from({ length: Math.ceil(identities.length / 30) }, (_, index) => (
    auth.db.collection("teamInvites").where("targetUid", "in", identities.slice(index * 30, index * 30 + 30))
      .where("status", "==", "open").where("expiresAt", ">", Date.now()).orderBy("expiresAt", "desc").limit(50).get()
  )));
  const pending = pendingSummaries(rows.flatMap((row) => row.docs));
  const teamIds = [...new Set(pending.map((invite) => invite.teamId).filter((id) => cleanId(id)))];
  const teams = teamIds.length ? await auth.db.getAll(...teamIds.map((id) => auth.db.collection("teams").doc(id))) : [];
  const available = new Set(teams.filter((team) => team.exists && !unavailable(team.data() ?? {})).map((team) => team.id));
  return { ok: true, invites: pending.filter((invite) => available.has(invite.teamId)) };
}

export async function revokeTeamInvite(auth: LinkedSocialAuth, teamId: string, inviteId: string) {
  const team = await requiredTeam(auth.db, teamId);
  const identities = await identityUidsFor(auth.decoded.uid, auth.db);
  const inviteRef = invitationRef(auth.db, inviteId);
  await auth.db.runTransaction(async (tx) => {
    const [role, invite] = await Promise.all([readTeamRole(tx, team.ref, identities), tx.get(inviteRef)]);
    assertAdmin(role);
    const data = invite.data() ?? {};
    if (!invite.exists || data.teamId !== team.id) throw new TeamInviteError("Invitation not found.", 404, "invite_not_found");
    if (data.status === "revoked") return;
    if (data.status !== "open") throw new TeamInviteError("This invitation is no longer open.", 409, "invite_closed");
    tx.set(inviteRef, { status: "revoked", revokedAt: Date.now(), revokedBy: auth.decoded.uid }, { merge: true });
  });
  return { ok: true };
}

export async function acceptTeamInvite(auth: LinkedSocialAuth, inviteId: string) {
  const inviteRef = invitationRef(auth.db, inviteId);
  const initial = await inviteRef.get();
  const initialData = initial.data() ?? {};
  if (!initial.exists) throw new TeamInviteError("Invitation not found.", 404, "invite_not_found");
  const teamId = cleanId(initialData.teamId);
  const inviterUid = cleanId(initialData.createdBy);
  if (!teamId || !inviterUid) throw new TeamInviteError("This invitation is unavailable.", 410, "invite_unavailable");
  const [identities, inviterIdentities] = await Promise.all([
    identityUidsFor(auth.decoded.uid, auth.db), identityUidsFor(inviterUid, auth.db),
  ]);
  const teamRef = auth.db.collection("teams").doc(teamId);
  const result = await auth.db.runTransaction(async (tx) => {
    const [invite, team, role, inviterRole] = await Promise.all([
      tx.get(inviteRef), tx.get(teamRef), readTeamRole(tx, teamRef, identities), readTeamRole(tx, teamRef, inviterIdentities),
    ]);
    const data = invite.data() ?? {};
    const teamData = team.data() ?? {};
    assertAvailable(team.exists, teamData);
    if (!invite.exists || data.teamId !== teamId || data.createdBy !== inviterUid) {
      throw new TeamInviteError("This invitation is unavailable.", 410, "invite_unavailable");
    }
    assertTarget(data, identities, auth.profile.handleLower);
    assertNotExpired(data);
    if (data.status !== "open" && !(data.status === "accepted" && role && identities.includes(String(data.acceptedBy ?? "")))) {
      throw new TeamInviteError("This invitation is no longer open. Ask for a fresh invitation.", 409, "invite_closed");
    }
    const teamResult = { id: teamId, name: cleanText(teamData.name, 60), slug: cleanText(teamData.slug, 48), role: role || "member" };
    if (role) return { ok: true, alreadyMember: true, team: teamResult };
    if (inviterRole !== "owner" && inviterRole !== "admin") {
      throw new TeamInviteError("The sender can no longer invite members. Ask a current team admin for a fresh invitation.", 410, "inviter_unavailable");
    }
    const now = Date.now();
    tx.set(teamRef.collection("members").doc(auth.decoded.uid), {
      id: auth.decoded.uid, uid: auth.decoded.uid, handle: auth.profile.handle, displayName: auth.displayName,
      role: "member", joinedAt: now, updatedAt: now,
    });
    const memberCount = Math.max(0, Number(teamData.memberCount) || 0) + 1;
    tx.set(teamRef, { memberCount, updatedAt: now }, { merge: true });
    if (teamData.visibility !== "private" && !teamData.hidden) {
      tx.set(auth.db.collection("publicTeams").doc(teamId), { memberCount, updatedAt: now }, { merge: true });
    }
    tx.set(inviteRef, { status: "accepted", acceptedBy: auth.decoded.uid, acceptedAt: now }, { merge: true });
    return { ok: true, alreadyMember: false, team: teamResult };
  });
  return result;
}

export async function declineTeamInvite(auth: LinkedSocialAuth, inviteId: string) {
  const inviteRef = invitationRef(auth.db, inviteId);
  const identities = await identityUidsFor(auth.decoded.uid, auth.db);
  await auth.db.runTransaction(async (tx) => {
    const invite = await tx.get(inviteRef);
    const data = invite.data() ?? {};
    if (!invite.exists) throw new TeamInviteError("Invitation not found.", 404, "invite_not_found");
    if (!String(data.targetUid ?? "") && !String(data.targetHandle ?? "")) {
      throw new TeamInviteError("Only the invited player can decline a targeted invitation.", 403, "target_required");
    }
    assertTarget(data, identities, auth.profile.handleLower);
    if (data.status === "declined" && identities.includes(String(data.declinedBy ?? ""))) return;
    assertNotExpired(data);
    if (data.status !== "open") throw new TeamInviteError("This invitation is no longer open.", 409, "invite_closed");
    tx.set(inviteRef, { status: "declined", declinedBy: auth.decoded.uid, declinedAt: Date.now() }, { merge: true });
  });
  return { ok: true };
}

/** Reused by admission routes so aliases and authoritative ownership cannot be downgraded. */
export async function readTeamRole(tx: Transaction, teamRef: DocumentReference, identities: readonly string[]): Promise<TeamMemberRole | ""> {
  const [team, members] = await Promise.all([
    tx.get(teamRef), Promise.all(identities.map((uid) => tx.get(teamRef.collection("members").doc(uid)))),
  ]);
  const data = team.data() ?? {};
  assertAvailable(team.exists, data);
  if (identities.includes(String(data.ownerUid ?? data.owner_uid ?? "").trim())) return "owner";
  const rank = { member: 1, admin: 2, owner: 3 };
  let role: TeamMemberRole | "" = "";
  for (const member of members) {
    const candidate: unknown = member.exists ? member.data()?.role : "";
    if (candidate !== "member" && candidate !== "admin" && candidate !== "owner") continue;
    if (!role || rank[candidate] > rank[role]) role = candidate;
  }
  return role;
}

function publicFields(data: Data): Omit<TeamInviteSummary, "found" | "inviteId"> {
  const expiresAt = Number(data.expiresAt) || 0;
  const status = cleanText(data.status, 24);
  return {
    teamName: cleanText(data.teamName, 60) || "Private team",
    senderName: cleanText(data.senderName, 80) || "A team admin",
    targetHandle: cleanText(data.targetHandle, 24),
    status: status === "open" && expiresAt <= Date.now() ? "expired" : status,
    expiresAt,
  };
}
function accountSummary(inviteId: string, data: Data): AccountTeamInviteSummary {
  return { inviteId, ...publicFields(data), teamId: String(data.teamId ?? ""), createdAt: Number(data.createdAt) || 0 };
}
function pendingSummaries(docs: Array<{ id: string; data(): Data }>): AccountTeamInviteSummary[] {
  return docs.map((doc) => accountSummary(doc.id, doc.data())).filter((invite) => invite.status === "open")
    .sort((left, right) => right.createdAt - left.createdAt).slice(0, 50);
}
function unavailable(data: Data) { return data.lifecycle_state === "deleting" || Boolean(data.deletedAt) || data.moderationStatus === "hidden"; }
function assertAvailable(exists: boolean, data: Data) {
  if (!exists || unavailable(data)) throw new TeamInviteError("This team is no longer available.", 410, "team_unavailable");
}
function assertAdmin(role: string) {
  if (role !== "owner" && role !== "admin") throw new TeamInviteError("Only team owners and admins can manage invitations.", 403, "team_admin_required");
}
function assertNotExpired(data: Data) {
  const expiry = Number(data.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new TeamInviteError("This invitation expired. Ask for a fresh link.", 410, "invite_expired");
}
function assertTarget(data: Data, identities: string[], handle: string) {
  const uid = String(data.targetUid ?? "");
  const targetHandle = String(data.targetHandle ?? "").toLowerCase();
  if ((uid && !identities.includes(uid)) || (!uid && targetHandle && targetHandle !== handle)) {
    throw new TeamInviteError("This invitation belongs to another RiftLite account.", 403, "wrong_profile");
  }
}
function cleanId(value: unknown) { const id = String(value ?? "").trim(); return id && !id.includes("/") ? id : ""; }
function invitationRef(db: Firestore, inviteId: string) {
  if (!INVITE_ID.test(inviteId)) throw new TeamInviteError("Invitation not found.", 404, "invite_not_found");
  return db.collection("teamInvites").doc(inviteId);
}
async function requiredTeam(db: Firestore, id: string) {
  if (!cleanId(id)) throw new TeamInviteError("Team not found.", 404, "team_not_found");
  const team = await resolveTeamRef(db, id);
  if (!team) throw new TeamInviteError("Team not found.", 404, "team_not_found");
  assertAvailable(team.exists, team.data() ?? {});
  return team;
}
