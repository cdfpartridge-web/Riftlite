import { type NextRequest } from "next/server";
import { requireLinkedProfile } from "@/lib/social-hub";
import { revokeTeamInvite, teamInviteResponse } from "@/lib/team-invites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ teamId: string; inviteId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId, inviteId } = await params;
  return teamInviteResponse(() => revokeTeamInvite(auth, teamId, inviteId));
}
