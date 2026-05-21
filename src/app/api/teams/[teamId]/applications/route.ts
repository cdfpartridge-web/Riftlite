import { type NextRequest } from "next/server";

import {
  applicationFromDoc,
  assertTeamRole,
  cleanLegendList,
  cleanLongText,
  cleanTeamVisibility,
  cleanText,
  increment,
  newId,
  parseBody,
  requireLinkedProfile,
  resolveTeamRef,
  socialJson
} from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);
  const role = await assertTeamRole(snap.id, auth.decoded.uid, ["owner", "admin", "member"]).catch(() => "");
  const query = role === "owner" || role === "admin"
    ? snap.ref.collection("applications").orderBy("createdAt", "desc").limit(80)
    : snap.ref.collection("applications").where("uid", "==", auth.decoded.uid).limit(20);
  const rows = await query.get();
  return socialJson({ ok: true, applications: rows.docs.map((doc) => applicationFromDoc(doc.id, doc.data())) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);
  const team = snap.data() ?? {};
  if (String(team.recruitmentStatus ?? "open") === "closed") {
    return socialJson({ error: "This team is not currently accepting applications." }, 400);
  }
  const member = await snap.ref.collection("members").doc(auth.decoded.uid).get();
  if (member.exists) return socialJson({ error: "You are already a member of this team." }, 409);
  const existing = await snap.ref.collection("applications")
    .where("uid", "==", auth.decoded.uid)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!existing.empty) return socialJson({ error: "You already have a pending application for this team." }, 409);

  const body = await parseBody(req);
  const now = Date.now();
  const id = newId();
  const application = {
    id,
    teamId: snap.id,
    uid: auth.decoded.uid,
    handle: auth.profile.handle,
    displayName: auth.displayName,
    message: cleanLongText(body.message, 1500),
    region: cleanText(body.region, 80),
    preferredLegends: cleanLegendList(body.preferredLegends),
    availability: cleanLongText(body.availability, 500),
    status: "pending",
    createdAt: now,
    updatedAt: now,
    reviewedAt: 0,
    reviewedBy: ""
  };
  const batch = auth.db.batch();
  batch.set(snap.ref.collection("applications").doc(id), application);
  batch.set(snap.ref, { applicationCount: increment(1), updatedAt: now }, { merge: true });
  if (cleanTeamVisibility(team.visibility) === "public" && !team.hidden) {
    batch.set(auth.db.collection("publicTeams").doc(snap.id), { applicationCount: increment(1), updatedAt: now }, { merge: true });
  }
  await batch.commit();
  return socialJson({ ok: true, application });
}
