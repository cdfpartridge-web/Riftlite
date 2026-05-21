import { type NextRequest } from "next/server";

import { assertTeamRole, cleanTeamVisibility, increment, normalizeTeamRole, parseBody, requireLinkedProfile, resolveTeamRef, socialJson } from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ teamId: string; uid: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId, uid } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);
  const role = await assertTeamRole(snap.id, auth.decoded.uid, ["owner", "admin"]);
  const body = await parseBody(req);
  const nextRole = normalizeTeamRole(body.role);
  if (uid === auth.decoded.uid) return socialJson({ error: "You cannot change your own role." }, 400);
  if (role !== "owner" && nextRole !== "member") return socialJson({ error: "Only owners can promote admins." }, 403);
  const memberRef = snap.ref.collection("members").doc(uid);
  const member = await memberRef.get();
  if (!member.exists) return socialJson({ error: "Team member not found." }, 404);
  if (member.data()?.role === "owner") return socialJson({ error: "Team owner cannot be changed here." }, 400);
  await memberRef.set({ role: nextRole, updatedAt: Date.now() }, { merge: true });
  return socialJson({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ teamId: string; uid: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId, uid } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);
  await assertTeamRole(snap.id, auth.decoded.uid, ["owner", "admin"]);
  const memberRef = snap.ref.collection("members").doc(uid);
  const member = await memberRef.get();
  if (!member.exists) return socialJson({ error: "Team member not found." }, 404);
  if (member.data()?.role === "owner") return socialJson({ error: "Team owner cannot be removed." }, 400);
  const now = Date.now();
  const team = snap.data() ?? {};
  const batch = auth.db.batch();
  batch.delete(memberRef);
  batch.set(snap.ref, { memberCount: increment(-1), updatedAt: now }, { merge: true });
  if (cleanTeamVisibility(team.visibility) === "public" && !team.hidden) {
    batch.set(auth.db.collection("publicTeams").doc(snap.id), { memberCount: increment(-1), updatedAt: now }, { merge: true });
  }
  await batch.commit();
  return socialJson({ ok: true });
}
