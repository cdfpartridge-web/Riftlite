import { type NextRequest } from "next/server";

import { HubLifecycleError, leavePrivateHub } from "@/lib/social/hub-lifecycle";
import { identityUidsFor, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ hubId: string }> },
) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { hubId } = await params;

  try {
    const identityUids = await identityUidsFor(auth.decoded.uid);
    const result = await leavePrivateHub(auth.db, hubId, identityUids);
    return socialJson({ ok: true, ...result });
  } catch (error) {
    if (error instanceof HubLifecycleError) {
      return socialJson({ error: error.message, code: error.code }, error.status);
    }
    console.error("[hubs/membership] Leave failed", error);
    return socialJson({ error: "Could not leave hub", code: "hub_leave_failed" }, 500);
  }
}
