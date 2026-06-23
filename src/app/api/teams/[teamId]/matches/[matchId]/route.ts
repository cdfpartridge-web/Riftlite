import { type NextRequest } from "next/server";

import { normalizeMatch } from "@/lib/community/data";
import { assertTeamRole, parseBody, requireLinkedProfile, resolveTeamRef, socialJson } from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
  const matchDoc = {
    ...raw,
    id: matchId,
    local_match_id: String(raw.local_match_id ?? raw.localMatchId ?? matchId),
    scope: "team",
    visibility: "team",
    team_id: snap.id,
    team_slug: String(team.slug ?? ""),
    team_name: String(team.name ?? ""),
    uid: auth.decoded.uid,
    owner_uid: auth.decoded.uid,
    owner_handle: auth.profile.handle,
    owner_display_name: auth.displayName,
    username: auth.displayName,
    profile_public: false,
    updated_at: nowSeconds,
    created_at: Number(raw.created_at ?? raw.createdAt ?? nowSeconds)
  };

  await snap.ref.collection("matches").doc(matchId).set(matchDoc, { merge: true });
  await snap.ref.set({ matchCountUpdatedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
  return socialJson({ ok: true, match: normalizeMatch(matchId, matchDoc) });
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
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) return socialJson({ ok: true });
  const data = matchSnap.data() ?? {};
  const ownerUid = String(data.owner_uid ?? data.uid ?? data.submitted_by_uid ?? "");
  if (role !== "owner" && role !== "admin" && ownerUid !== auth.decoded.uid) {
    return socialJson({ error: "Only the uploader or a team admin can remove this match." }, 403);
  }

  await matchRef.delete();
  await snap.ref.set({ matchCountUpdatedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
  return socialJson({ ok: true });
}
