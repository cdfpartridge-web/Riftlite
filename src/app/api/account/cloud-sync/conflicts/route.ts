import { type NextRequest } from "next/server";

import {
  accountCloudSyncConflictResponse,
  accountCloudSyncPrivateJson,
  listAccountCloudSyncConflicts,
  requireCanonicalAccountCloudSyncOwner,
} from "@/lib/account-cloud-sync-conflict-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const owner = await requireCanonicalAccountCloudSyncOwner(req);
  if ("error" in owner) return owner.error;
  try {
    const conflicts = await listAccountCloudSyncConflicts(owner.db, owner.uid);
    return accountCloudSyncPrivateJson({ ok: true, conflicts });
  } catch (error) {
    return accountCloudSyncConflictResponse(error);
  }
}
