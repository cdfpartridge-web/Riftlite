import { type NextRequest } from "next/server";

import { buildHubStats, formatLeaderboard, loadHubMatches, requireBotRequest } from "@/lib/discord/bot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ hubId: string }> }) {
  const auth = requireBotRequest(req);
  if ("error" in auth) return auth.error;
  const { hubId } = await params;
  const rangeDays = Math.max(1, Math.min(30, Number(req.nextUrl.searchParams.get("days") ?? 7)));
  const stats = buildHubStats(hubId, await loadHubMatches(hubId), rangeDays);
  return Response.json({ hubId, text: formatLeaderboard(stats), stats });
}
