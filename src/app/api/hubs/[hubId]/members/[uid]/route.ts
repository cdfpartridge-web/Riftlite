import { type NextRequest } from "next/server";

import { assertHubRole, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ hubId: string; uid: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { hubId, uid } = await params;
  const body = await readBody(req);
  const role = String(body.role ?? "");
  if (!["admin", "member"].includes(role)) return socialJson({ error: "Role must be admin or member" }, 400);
  try {
    await assertHubRole(hubId, auth.decoded.uid, ["owner", "admin"]);
    await auth.db.collection("hubs").doc(hubId).collection("members").doc(uid).set({ role, updatedAt: Date.now() }, { merge: true });
    return socialJson({ ok: true });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Could not update role" }, 403);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ hubId: string; uid: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { hubId, uid } = await params;
  try {
    await assertHubRole(hubId, auth.decoded.uid, ["owner", "admin"]);
    await auth.db.collection("hubs").doc(hubId).collection("members").doc(uid).delete();
    return socialJson({ ok: true });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Could not remove member" }, 403);
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
