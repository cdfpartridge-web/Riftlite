import { type NextRequest } from "next/server";

import {
  applyMetaStudioPrivateHeaders,
  metaStudioJson,
  requireMetaStudioSession,
} from "@/lib/community/meta-studio-auth";
import { readMetaStudioReplayLibrary } from "@/lib/community/meta-studio-replay-library";
import { replayApiError } from "@/lib/replay-v2-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const principal = await requireMetaStudioSession(request);
  if ("error" in principal) return principal.error;

  try {
    const items = await readMetaStudioReplayLibrary();
    return metaStudioJson({
      items,
      count: items.length,
      scope: "private-meta-studio-corpus",
    });
  } catch (error) {
    return applyMetaStudioPrivateHeaders(replayApiError(error));
  }
}
