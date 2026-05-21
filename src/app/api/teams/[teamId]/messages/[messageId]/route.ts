import { type NextRequest } from "next/server";

import { assertTeamRole, requireLinkedProfile, resolveTeamRef, socialJson } from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ teamId: string; messageId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId, messageId } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);
  await assertTeamRole(snap.id, auth.decoded.uid, ["owner", "admin"]);
  await snap.ref.collection("messages").doc(messageId).set({ deleted: true, text: "Deleted by team admin.", updatedAt: Date.now() }, { merge: true });
  return socialJson({ ok: true });
}
