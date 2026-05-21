import { type NextRequest } from "next/server";

import { assertTeamRole, memberFromDoc, requireLinkedProfile, resolveTeamRef, socialJson } from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);
  await assertTeamRole(snap.id, auth.decoded.uid, ["owner", "admin", "member"]);
  const members = await snap.ref.collection("members").orderBy("joinedAt", "asc").limit(150).get();
  return socialJson({ ok: true, members: members.docs.map((doc) => memberFromDoc(doc.id, doc.data())) });
}
