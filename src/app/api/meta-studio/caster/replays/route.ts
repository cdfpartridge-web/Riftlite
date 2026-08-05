import { type NextRequest } from "next/server";

import {
  applyMetaStudioPrivateHeaders,
  metaStudioJson,
  requireMetaStudioSession,
} from "@/lib/community/meta-studio-auth";
import {
  listOwnerReplays,
  normalizeListLimit,
  replayApiError,
} from "@/lib/replay-v2-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const principal = await requireMetaStudioSession(request);
  if ("error" in principal) return principal.error;

  try {
    const limit = normalizeListLimit(request.nextUrl.searchParams.get("limit"));
    const items = await listOwnerReplays(principal.uid, limit);
    return metaStudioJson({
      items,
      count: items.length,
      scope: "mine",
    });
  } catch (error) {
    return applyMetaStudioPrivateHeaders(replayApiError(error));
  }
}
