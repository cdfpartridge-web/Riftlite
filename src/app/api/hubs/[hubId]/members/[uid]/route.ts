import { type NextRequest } from "next/server";

import {
  assertHubMemberRemovalAllowed,
  assertHubMemberRoleChangeAllowed,
  normalizeHubMemberRole,
} from "@/lib/social/hub-permissions";
import { assertHubCapability, identityUidsFor, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ hubId: string; uid: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { hubId, uid } = await params;
  const body = await readBody(req);
  const role = String(body.role ?? "");
  if (!["admin", "member"].includes(role)) return socialJson({ error: "Role must be admin or member" }, 400);
  try {
    const actorRole = normalizeHubMemberRole(await assertHubCapability(hubId, auth.decoded.uid, "appoint_coowners"));
    const hubRef = auth.db.collection("hubs").doc(hubId);
    const targetIdentityUids = await identityUidsFor(uid);
    const memberRefs = targetIdentityUids.map((identityUid) => hubRef.collection("members").doc(identityUid));
    const memberSnaps = memberRefs.length ? await auth.db.getAll(...memberRefs) : [];
    const existing = memberSnaps.filter((member) => member.exists);
    if (!existing.length) return socialJson({ error: "Hub member was not found" }, 404);
    const hubData = (await hubRef.get()).data() ?? {};
    const targetRole = existing.reduce(
      (selected, member) => strongerRole(selected, normalizeHubMemberRole(member.data()?.role)),
      "member" as ReturnType<typeof normalizeHubMemberRole>,
    );
    const ownerUids = [hubData.owner_uid, hubData.ownerUid, hubData.created_by, hubData.createdBy]
      .map((value) => String(value ?? ""))
      .filter(Boolean);
    assertHubMemberRoleChangeAllowed({
      actorRole,
      targetRole,
      nextRole: role as "admin" | "member",
      targetIsHubOwner: ownerUids.some((ownerUid) => targetIdentityUids.includes(ownerUid)),
    });
    const batch = auth.db.batch();
    for (const member of existing) batch.set(member.ref, { role, updatedAt: Date.now() }, { merge: true });
    await batch.commit();
    return socialJson({ ok: true });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Could not update role" }, 403);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ hubId: string; uid: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { hubId, uid } = await params;
  try {
    const actorRole = normalizeHubMemberRole(await assertHubCapability(hubId, auth.decoded.uid, "manage_members"));
    const hubRef = auth.db.collection("hubs").doc(hubId);
    const targetIdentityUids = await identityUidsFor(uid);
    const memberRefs = targetIdentityUids.map((identityUid) => hubRef.collection("members").doc(identityUid));
    const memberSnaps = memberRefs.length ? await auth.db.getAll(...memberRefs) : [];
    const existing = memberSnaps.filter((member) => member.exists);
    if (!existing.length) return socialJson({ error: "Hub member was not found" }, 404);
    const hubData = (await hubRef.get()).data() ?? {};
    const targetRole = existing.reduce(
      (selected, member) => strongerRole(selected, normalizeHubMemberRole(member.data()?.role)),
      "member" as ReturnType<typeof normalizeHubMemberRole>,
    );
    const ownerUids = [hubData.owner_uid, hubData.ownerUid, hubData.created_by, hubData.createdBy]
      .map((value) => String(value ?? ""))
      .filter(Boolean);
    assertHubMemberRemovalAllowed({
      actorRole,
      targetRole,
      targetIsHubOwner: ownerUids.some((ownerUid) => targetIdentityUids.includes(ownerUid)),
    });
    const batch = auth.db.batch();
    for (const member of existing) batch.delete(member.ref);
    await batch.commit();
    return socialJson({ ok: true });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Could not remove member" }, 403);
  }
}

function strongerRole(left: ReturnType<typeof normalizeHubMemberRole>, right: ReturnType<typeof normalizeHubMemberRole>) {
  const rank = { member: 1, admin: 2, owner: 3 } as const;
  return rank[left] >= rank[right] ? left : right;
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
