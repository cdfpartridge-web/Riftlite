import { randomBytes } from "node:crypto";
import { type NextRequest } from "next/server";

import { assertHubRole, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ hubId: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { hubId } = await params;
  const body = await readBody(req);
  try {
    await assertHubRole(hubId, auth.decoded.uid, ["owner", "admin"]);
    const inviteId = randomBytes(8).toString("hex");
    const now = Date.now();
    const invite = {
      inviteId,
      hubId,
      targetHandle: String(body.targetHandle ?? "").trim().replace(/^@/, "").slice(0, 24),
      createdBy: auth.decoded.uid,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
      status: "open",
    };
    await auth.db.collection("hubInvites").doc(inviteId).set(invite);
    const origin = req.nextUrl.origin;
    return socialJson({ ok: true, invite, inviteUrl: `${origin}/hubs/invite/${inviteId}` });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Could not create invite" }, 403);
  }
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
