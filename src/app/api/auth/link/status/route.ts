import { type NextRequest } from "next/server";

import { requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const sessionId = req.nextUrl.searchParams.get("sessionId")?.trim() ?? "";
  if (!sessionId) return socialJson({ error: "Missing sessionId" }, 400);

  const ref = auth.db.collection("desktopLinkSessions").doc(sessionId);
  const snap = await ref.get();
  const data = snap.data();
  if (!snap.exists || !data) return socialJson({ error: "Link session not found" }, 404);
  if (String(data.desktopUid ?? "") !== auth.decoded.uid) return socialJson({ error: "Session belongs to another device" }, 403);
  if (Number(data.expiresAt ?? 0) < Date.now() && String(data.status ?? "") === "pending") {
    return socialJson({ status: "expired" });
  }

  if (String(data.status ?? "") === "complete") {
    const customToken = String(data.customToken ?? "");
    await ref.set({ customToken: "", consumedAt: Date.now() }, { merge: true });
    return socialJson({
      status: "complete",
      uid: String(data.linkedUid ?? ""),
      email: String(data.linkedEmail ?? ""),
      displayName: String(data.linkedName ?? ""),
      customToken,
    });
  }

  return socialJson({ status: String(data.status ?? "pending") });
}
