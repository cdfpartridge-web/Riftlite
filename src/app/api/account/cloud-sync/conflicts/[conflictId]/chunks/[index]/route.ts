import { type NextRequest } from "next/server";

import {
  accountCloudSyncConflictResponse,
  accountCloudSyncPrivateJson,
  getAccountCloudSyncConflictChunk,
  requireCanonicalAccountCloudSyncOwner,
} from "@/lib/account-cloud-sync-conflict-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ conflictId: string; index: string }> },
) {
  const owner = await requireCanonicalAccountCloudSyncOwner(req);
  if ("error" in owner) return owner.error;
  const { conflictId, index } = await context.params;
  try {
    const result = await getAccountCloudSyncConflictChunk(
      owner.db,
      owner.uid,
      String(conflictId ?? "").trim(),
      Number(index),
      req.nextUrl.searchParams.get("legacyFingerprint")?.trim() ?? "",
    );
    return accountCloudSyncPrivateJson({ ok: true, ...result });
  } catch (error) {
    return accountCloudSyncConflictResponse(error);
  }
}
