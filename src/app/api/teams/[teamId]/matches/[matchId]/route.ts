import { type NextRequest } from "next/server";

import { normalizeMatch } from "@/lib/community/data";
import { assertTeamRole, parseBody, requireLinkedProfile, resolveTeamRef, socialJson } from "@/lib/social-hub";
import { identityUidsFor } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function matchOwnerUid(value: Record<string, unknown>): string {
  return String(value.owner_uid ?? value.uid ?? value.submitted_by_uid ?? "").trim();
}

function matchCreatedAt(value: Record<string, unknown>, fallback: number): number {
  const candidate = Number(value.created_at ?? value.createdAt);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
}

function existingOwnership(
  existing: Record<string, unknown>,
  fallback: { uid: string; handle: string; displayName: string },
): Record<string, unknown> {
  const ownerUid = matchOwnerUid(existing) || fallback.uid;
  return {
    uid: String(existing.uid ?? ownerUid).trim() || ownerUid,
    owner_uid: String(existing.owner_uid ?? ownerUid).trim() || ownerUid,
    owner_handle: String(existing.owner_handle ?? fallback.handle),
    owner_display_name: String(existing.owner_display_name ?? fallback.displayName),
    username: String(existing.username ?? fallback.displayName),
    profile_public: existing.profile_public === true,
  };
}

async function getMemberRole(teamId: string, uid: string) {
  try {
    return await assertTeamRole(teamId, uid, ["owner", "admin", "member"]);
  } catch {
    return "";
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ teamId: string; matchId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId, matchId } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);
  const role = await getMemberRole(snap.id, auth.decoded.uid);
  if (!role) return socialJson({ error: "You must be a team member to sync matches." }, 403);

  const body = await parseBody(req);
  const raw = readRecord(body.match ?? body);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const team = snap.data() ?? {};
  const matchRef = snap.ref.collection("matches").doc(matchId);
  const identityUids = new Set([
    auth.decoded.uid,
    ...await identityUidsFor(auth.decoded.uid, auth.db),
  ].map((uid) => String(uid ?? "").trim()).filter(Boolean));

  try {
    const matchDoc = await auth.db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(matchRef);
      const existing = existingSnap.data() ?? {};
      const ownerUid = matchOwnerUid(existing);
      const canManageAnyMatch = role === "owner" || role === "admin";
      if (existingSnap.exists && (!ownerUid || !identityUids.has(ownerUid)) && !canManageAnyMatch) {
        throw new TeamMatchOwnershipConflictError();
      }

      const ownership = existingSnap.exists
        ? existingOwnership(existing, {
          uid: auth.decoded.uid,
          handle: auth.profile.handle,
          displayName: auth.displayName,
        })
        : {
          uid: auth.decoded.uid,
          owner_uid: auth.decoded.uid,
          owner_handle: auth.profile.handle,
          owner_display_name: auth.displayName,
          username: auth.displayName,
          profile_public: false,
        };
      const next = {
        ...raw,
        id: matchId,
        local_match_id: String(raw.local_match_id ?? raw.localMatchId ?? matchId),
        scope: "team",
        visibility: "team",
        team_id: snap.id,
        team_slug: String(team.slug ?? ""),
        team_name: String(team.name ?? ""),
        ...ownership,
        updated_at: nowSeconds,
        created_at: existingSnap.exists
          ? matchCreatedAt(existing, nowSeconds)
          : matchCreatedAt(raw, nowSeconds),
      };

      tx.set(matchRef, next, { merge: true });
      tx.set(snap.ref, { matchCountUpdatedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
      return next;
    });
    return socialJson({ ok: true, match: normalizeMatch(matchId, matchDoc) });
  } catch (error) {
    if (error instanceof TeamMatchOwnershipConflictError) {
      return socialJson({ error: error.message, code: "match_owner_conflict" }, 409);
    }
    throw error;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ teamId: string; matchId: string }> }) {
  const auth = await requireLinkedProfile(_req);
  if ("error" in auth) return auth.error;
  const { teamId, matchId } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);

  const role = await getMemberRole(snap.id, auth.decoded.uid);
  if (!role) return socialJson({ error: "You do not have access to this team." }, 403);

  const matchRef = snap.ref.collection("matches").doc(matchId);
  const identityUids = new Set([
    auth.decoded.uid,
    ...await identityUidsFor(auth.decoded.uid, auth.db),
  ].map((uid) => String(uid ?? "").trim()).filter(Boolean));

  try {
    await auth.db.runTransaction(async (tx) => {
      const matchSnap = await tx.get(matchRef);
      if (!matchSnap.exists) return;
      const ownerUid = matchOwnerUid(matchSnap.data() ?? {});
      if (role !== "owner" && role !== "admin" && (!ownerUid || !identityUids.has(ownerUid))) {
        throw new TeamMatchDeleteForbiddenError();
      }
      tx.delete(matchRef);
      tx.set(snap.ref, { matchCountUpdatedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
    });
    return socialJson({ ok: true });
  } catch (error) {
    if (error instanceof TeamMatchDeleteForbiddenError) {
      return socialJson({ error: error.message }, 403);
    }
    throw error;
  }
}

class TeamMatchOwnershipConflictError extends Error {
  constructor() {
    super("That team match ID already belongs to another uploader. The existing report was left unchanged.");
    this.name = "TeamMatchOwnershipConflictError";
  }
}

class TeamMatchDeleteForbiddenError extends Error {
  constructor() {
    super("Only the uploader or a team admin can remove this match.");
    this.name = "TeamMatchDeleteForbiddenError";
  }
}
