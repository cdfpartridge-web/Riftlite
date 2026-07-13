import { type NextRequest } from "next/server";

import { formatRecentMatches, loadHubMatches, requireBotRequest } from "@/lib/discord/bot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ hubId: string }> }) {
  const auth = requireBotRequest(req);
  if ("error" in auth) return auth.error;
  const { hubId } = await params;
  const count = Math.max(1, Math.min(10, Number(req.nextUrl.searchParams.get("count") ?? 5)));
  const matches = await loadHubMatches(hubId);
  return Response.json({ hubId, text: formatRecentMatches(matches, count), matches: matches.slice(0, count) });
}
