import { randomBytes } from "node:crypto";
import { type NextRequest } from "next/server";

import { assertHubRole, cleanDisplayName, cleanHandle, ensureUserProfile, handleLower, requireUser, socialJson } from "@/lib/social/server";

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
    const hubSnap = await auth.db.collection("hubs").doc(hubId).get();
    const hubData = hubSnap.data() ?? {};
    const hubName = String(hubData.name ?? hubId);
    const senderProfile = await ensureUserProfile(auth.decoded.uid, auth.decoded.name ?? auth.decoded.email ?? "", auth.decoded.email ?? "");
    const targetHandle = cleanHandle(body.targetHandle);
    const targetHandleLower = handleLower(targetHandle);
    let targetUid = "";
    let delivered = false;

    if (targetHandleLower) {
      const handleSnap = await auth.db.collection("handles").doc(targetHandleLower).get();
      const handleData = handleSnap.data() ?? {};
      targetUid = String(handleData.uid ?? "");
      if (!targetUid) {
        return socialJson({ error: `No linked RiftLite profile found for @${targetHandle}. They can still join with hub name/password.` }, 404);
      }
      if (targetUid === auth.decoded.uid) {
        return socialJson({ error: "You are already in this hub." }, 400);
      }
      const memberSnap = await auth.db.collection("hubs").doc(hubId).collection("members").doc(targetUid).get();
      if (memberSnap.exists) {
        return socialJson({ error: `@${targetHandle} is already a member of this hub.` }, 409);
      }
      delivered = true;
    }

    const inviteId = randomBytes(8).toString("hex");
    const now = Date.now();
    const invite = {
      inviteId,
      hubId,
      hubName,
      targetHandle,
      targetUid,
      createdBy: auth.decoded.uid,
      senderUid: auth.decoded.uid,
      senderHandle: senderProfile.handle,
      senderDisplayName: cleanDisplayName(senderProfile.displayName, senderProfile.handle || "RiftLite Player"),
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
      status: "open",
      delivered,
    };
    const batch = auth.db.batch();
    batch.set(auth.db.collection("hubInvites").doc(inviteId), invite);
    if (targetUid) {
      batch.set(auth.db.collection("users").doc(targetUid).collection("inbox").doc(inviteId), {
        id: inviteId,
        type: "hub-invite",
        inviteId,
        hubId,
        hubName,
        targetUid,
        targetHandle,
        senderUid: auth.decoded.uid,
        senderHandle: senderProfile.handle,
        senderDisplayName: cleanDisplayName(senderProfile.displayName, senderProfile.handle || "RiftLite Player"),
        status: "open",
        createdAt: now,
        expiresAt: now + INVITE_TTL_MS,
        readAt: 0,
      });
    }
    await batch.commit();
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
