import { type NextRequest } from "next/server";

import { assertHubCapability, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ hubId: string; messageId: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { hubId, messageId } = await params;
  try {
    await assertHubCapability(hubId, auth.decoded.uid, "manage_content");
    const hubRef = auth.db.collection("hubs").doc(hubId);
    await auth.db.runTransaction(async (tx) => {
      const hubSnap = await tx.get(hubRef);
      if (!hubSnap.exists || String(hubSnap.data()?.lifecycle_state ?? "") === "deleting") {
        throw new Error("This private hub is being deleted");
      }
      tx.set(hubRef.collection("messages").doc(messageId), {
        deleted: true,
        text: "",
        deletedBy: auth.decoded.uid,
        deletedAt: Date.now(),
        updatedAt: Date.now(),
      }, { merge: true });
    });
    return socialJson({ ok: true });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Could not delete message" }, 403);
  }
}
