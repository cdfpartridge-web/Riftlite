import { type NextRequest } from "next/server";

import { assertHubRole, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ hubId: string; messageId: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { hubId, messageId } = await params;
  try {
    await assertHubRole(hubId, auth.decoded.uid, ["owner", "admin"]);
    await auth.db.collection("hubs").doc(hubId).collection("messages").doc(messageId).set({
      deleted: true,
      text: "",
      deletedBy: auth.decoded.uid,
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    }, { merge: true });
    return socialJson({ ok: true });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Could not delete message" }, 403);
  }
}
