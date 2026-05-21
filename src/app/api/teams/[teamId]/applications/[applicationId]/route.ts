import { type NextRequest } from "next/server";

import {
  applicationFromDoc,
  assertTeamRole,
  cleanTeamVisibility,
  increment,
  normalizeApplicationStatus,
  parseBody,
  requireLinkedProfile,
  resolveTeamRef,
  socialJson
} from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ teamId: string; applicationId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId, applicationId } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);
  await assertTeamRole(snap.id, auth.decoded.uid, ["owner", "admin"]);
  const body = await parseBody(req);
  const status = normalizeApplicationStatus(body.status);
  if (status !== "accepted" && status !== "declined") {
    return socialJson({ error: "Applications can only be accepted or declined." }, 400);
  }
  const appRef = snap.ref.collection("applications").doc(applicationId);
  const appSnap = await appRef.get();
  if (!appSnap.exists) return socialJson({ error: "Application not found." }, 404);
  const application = applicationFromDoc(appSnap.id, appSnap.data() ?? {});
  if (application.status !== "pending") return socialJson({ error: "Application has already been reviewed." }, 409);

  const team = snap.data() ?? {};
  const isPublicTeam = cleanTeamVisibility(team.visibility) === "public" && !team.hidden;
  const now = Date.now();
  const batch = auth.db.batch();
  batch.set(appRef, { status, reviewedAt: now, reviewedBy: auth.decoded.uid, updatedAt: now }, { merge: true });
  if (status === "accepted") {
    batch.set(snap.ref.collection("members").doc(application.uid), {
      id: application.uid,
      uid: application.uid,
      handle: application.handle,
      displayName: application.displayName,
      role: "member",
      joinedAt: now,
      updatedAt: now
    }, { merge: true });
    batch.set(snap.ref, { memberCount: increment(1), applicationCount: increment(-1), updatedAt: now }, { merge: true });
    if (isPublicTeam) {
      batch.set(auth.db.collection("publicTeams").doc(snap.id), { memberCount: increment(1), applicationCount: increment(-1), updatedAt: now }, { merge: true });
    }
  } else {
    batch.set(snap.ref, { applicationCount: increment(-1), updatedAt: now }, { merge: true });
    if (isPublicTeam) {
      batch.set(auth.db.collection("publicTeams").doc(snap.id), { applicationCount: increment(-1), updatedAt: now }, { merge: true });
    }
  }
  await batch.commit();
  return socialJson({ ok: true, application: { ...application, status, reviewedAt: now, reviewedBy: auth.decoded.uid } });
}
