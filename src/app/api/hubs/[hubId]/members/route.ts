import { type NextRequest } from "next/server";

import { assertHubRole, bestProfileDisplayName, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ hubId: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { hubId } = await params;
  try {
    await assertHubRole(hubId, auth.decoded.uid, ["owner", "admin", "member"]);
    const snap = await auth.db.collection("hubs").doc(hubId).collection("members").orderBy("joinedAt", "asc").limit(200).get();
    return socialJson({
      members: snap.docs.map((doc) => {
        const data = doc.data();
        const handle = String(data.handle ?? "").trim();
        const uid = String(data.uid ?? doc.id);
        return {
          id: doc.id,
          ...data,
          displayName: bestProfileDisplayName(uid, data.displayName, handle),
        };
      }),
    });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Could not load hub members" }, 403);
  }
}
