import { type NextRequest } from "next/server";
import { parseBody, requireLinkedProfile } from "@/lib/social-hub";
import { createTeamInvite, listTeamInvites, teamInviteResponse } from "@/lib/team-invites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ teamId: string }> };

export async function GET(req: NextRequest, { params }: Context) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId } = await params;
  return teamInviteResponse(() => listTeamInvites(auth, teamId));
}

export async function POST(req: NextRequest, { params }: Context) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId } = await params;
  const body = await parseBody(req);
  return teamInviteResponse(async () => {
    const result = await createTeamInvite(auth, teamId, body.targetHandle);
    return { ...result, inviteUrl: `${req.nextUrl.origin}/teams/invite/${result.invite.inviteId}` };
  });
}
