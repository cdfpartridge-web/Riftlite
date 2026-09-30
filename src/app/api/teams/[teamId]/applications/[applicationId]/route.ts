import { type NextRequest } from "next/server";

import {
  applicationFromDoc,
  cleanTeamVisibility,
  normalizeApplicationStatus,
  parseBody,
  requireLinkedProfile,
  resolveTeamRef,
  socialJson
} from "@/lib/social-hub";
import { canonicalIdentityUid } from "@/lib/identity-server";
import { identityUidsFor } from "@/lib/social/server";
import { readTeamRole, TeamInviteError, teamInviteResponse } from "@/lib/team-invites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ teamId: string; applicationId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId, applicationId } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);
  const body = await parseBody(req);
  const status = normalizeApplicationStatus(body.status);
  if (status !== "accepted" && status !== "declined") {
    return socialJson({ error: "Applications can only be accepted or declined." }, 400);
  }
  const actorUids = await identityUidsFor(auth.decoded.uid, auth.db);
  const actorRole = await auth.db.runTransaction((tx) => readTeamRole(tx, snap.ref, actorUids)).catch(() => "");
  if (actorRole !== "owner" && actorRole !== "admin") {
    return socialJson({ error: "Only team owners and admins can review applications." }, 403);
  }
  const appRef = snap.ref.collection("applications").doc(applicationId);
  const appSnap = await appRef.get();
  if (!appSnap.exists) return socialJson({ error: "Application not found." }, 404);
  const application = applicationFromDoc(appSnap.id, appSnap.data() ?? {});
  if (application.status !== "pending") return socialJson({ error: "Application has already been reviewed." }, 409);

  return teamInviteResponse(async () => {
    const applicantUid = await canonicalIdentityUid(application.uid, auth.db);
    const applicantUids = await identityUidsFor(applicantUid, auth.db);
    return auth.db.runTransaction(async (tx) => {
      const [currentApp, currentTeam, actorRole, applicantRole] = await Promise.all([
        tx.get(appRef), tx.get(snap.ref), readTeamRole(tx, snap.ref, actorUids), readTeamRole(tx, snap.ref, applicantUids),
      ]);
      if (actorRole !== "owner" && actorRole !== "admin") {
        throw new TeamInviteError("Only team owners and admins can review applications.", 403, "team_admin_required");
      }
      const current = applicationFromDoc(currentApp.id, currentApp.data() ?? {});
      if (!currentApp.exists || current.uid !== application.uid || current.status !== "pending") {
        throw new TeamInviteError("Application has already been reviewed or changed.", 409, "application_closed");
      }
      const team = currentTeam.data() ?? {};
      const now = Date.now();
      const joining = status === "accepted" && !applicantRole;
      if (joining) {
        tx.set(snap.ref.collection("members").doc(applicantUid), {
          id: applicantUid, uid: applicantUid, handle: current.handle, displayName: current.displayName,
          role: "member", joinedAt: now, updatedAt: now,
        });
      }
      const counters = {
        applicationCount: Math.max(0, (Number(team.applicationCount) || 0) - 1),
        ...(joining ? { memberCount: Math.max(0, Number(team.memberCount) || 0) + 1 } : {}),
        updatedAt: now,
      };
      tx.set(appRef, { status, reviewedAt: now, reviewedBy: auth.decoded.uid, updatedAt: now }, { merge: true });
      tx.set(snap.ref, counters, { merge: true });
      if (cleanTeamVisibility(team.visibility) === "public" && !team.hidden) {
        tx.set(auth.db.collection("publicTeams").doc(snap.id), counters, { merge: true });
      }
      return { ok: true, application: { ...current, status, reviewedAt: now, reviewedBy: auth.decoded.uid } };
    });
  });
}
