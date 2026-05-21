import { type NextRequest } from "next/server";

import { cleanLongText, cleanText, newId, parseBody, requireLinkedProfile, socialJson } from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const body = await parseBody(req);
  const targetType = cleanText(body.targetType, 40);
  const targetId = cleanText(body.targetId, 120);
  const reason = cleanLongText(body.reason, 1000);
  if (!targetType || !targetId || !reason) {
    return socialJson({ error: "Report target and reason are required." }, 400);
  }
  const id = newId();
  await auth.db.collection("teamReports").doc(id).set({
    id,
    uid: auth.decoded.uid,
    handle: auth.profile.handle,
    displayName: auth.displayName,
    targetType,
    targetId,
    reason,
    status: "open",
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  return socialJson({ ok: true, reportId: id });
}
