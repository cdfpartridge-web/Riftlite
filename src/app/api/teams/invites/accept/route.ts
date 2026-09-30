import { type NextRequest } from "next/server";
import { parseBody, requireLinkedProfile } from "@/lib/social-hub";
import { acceptTeamInvite, teamInviteResponse } from "@/lib/team-invites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const body = await parseBody(req);
  return teamInviteResponse(() => acceptTeamInvite(auth, String(body.inviteId ?? "").trim()));
}
