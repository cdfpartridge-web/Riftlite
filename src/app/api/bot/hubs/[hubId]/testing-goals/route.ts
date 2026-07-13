import { type NextRequest } from "next/server";

import {
  addTestingGoal,
  completeTestingGoal,
  formatTestingGoals,
  getDiscordGuildIdForHub,
  listTestingGoals,
  requireBotRequest,
} from "@/lib/discord/bot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ hubId: string }> }) {
  const auth = requireBotRequest(req);
  if ("error" in auth) return auth.error;
  const { hubId } = await params;
  const guildId = await getDiscordGuildIdForHub(hubId) || hubId;
  const goals = await listTestingGoals(guildId);
  return Response.json({ hubId, text: formatTestingGoals(goals), goals });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ hubId: string }> }) {
  const auth = requireBotRequest(req);
  if ("error" in auth) return auth.error;
  const { hubId } = await params;
  const guildId = await getDiscordGuildIdForHub(hubId) || hubId;
  const body = await readBody(req);
  const goal = await addTestingGoal(guildId, String(body.text ?? ""), "bot");
  return Response.json({ hubId, goal });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ hubId: string }> }) {
  const auth = requireBotRequest(req);
  if ("error" in auth) return auth.error;
  const { hubId } = await params;
  const guildId = await getDiscordGuildIdForHub(hubId) || hubId;
  const body = await readBody(req);
  const id = String(body.id ?? "").trim();
  await completeTestingGoal(guildId, id, "bot");
  return Response.json({ hubId, id, ok: true });
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
