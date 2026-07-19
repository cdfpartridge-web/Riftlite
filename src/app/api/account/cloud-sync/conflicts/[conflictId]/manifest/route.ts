import { type NextRequest } from "next/server";

import {
  accountCloudSyncConflictResponse,
  accountCloudSyncPrivateJson,
  getAccountCloudSyncConflictManifest,
  requireCanonicalAccountCloudSyncOwner,
} from "@/lib/account-cloud-sync-conflict-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ conflictId: string }> },
) {
  const owner = await requireCanonicalAccountCloudSyncOwner(req);
  if ("error" in owner) return owner.error;
  const { conflictId } = await context.params;
  try {
    const result = await getAccountCloudSyncConflictManifest(owner.db, owner.uid, String(conflictId ?? "").trim());
    return accountCloudSyncPrivateJson({ ok: true, ...result });
  } catch (error) {
    return accountCloudSyncConflictResponse(error);
  }
}
