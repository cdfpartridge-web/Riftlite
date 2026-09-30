import { type NextRequest } from "next/server";
import { requireLinkedProfile } from "@/lib/social-hub";
import { listTargetedTeamInvites, teamInviteResponse } from "@/lib/team-invites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  return teamInviteResponse(() => listTargetedTeamInvites(auth));
}
