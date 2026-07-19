import { type NextRequest } from "next/server";

import {
  accountCloudSyncConflictResponse,
  accountCloudSyncPrivateJson,
  requireCanonicalAccountCloudSyncOwner,
  resolveAccountCloudSyncConflict,
} from "@/lib/account-cloud-sync-conflict-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ conflictId: string }> },
) {
  const owner = await requireCanonicalAccountCloudSyncOwner(req);
  if ("error" in owner) return owner.error;
  const { conflictId } = await context.params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const result = await resolveAccountCloudSyncConflict(
      owner.db,
      owner.uid,
      owner.authenticatedUid,
      String(conflictId ?? "").trim(),
      {
        choice: body.choice === "restore-legacy" ? "restore-legacy" : body.choice === "keep-current" ? "keep-current" : body.choice as never,
        legacyFingerprint: String(body.legacyFingerprint ?? "").trim(),
        currentFingerprint: String(body.currentFingerprint ?? "").trim(),
        stagedManifest: body.stagedManifest,
      },
    );
    return accountCloudSyncPrivateJson({ ok: true, ...result });
  } catch (error) {
    return accountCloudSyncConflictResponse(error);
  }
}
