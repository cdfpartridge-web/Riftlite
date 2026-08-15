import { type NextRequest } from "next/server";

import {
  metaStudioJson,
  requireMetaStudioSession,
} from "@/lib/community/meta-studio-auth";
import { readLiveTakeoverAnalyticsReport } from "@/lib/live-takeover-analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireMetaStudioSession(request);
  if ("error" in auth) return auth.error;

  try {
    const runId = request.nextUrl.searchParams.get("runId") ?? undefined;
    return metaStudioJson({
      ok: true,
      report: await readLiveTakeoverAnalyticsReport(runId),
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Live takeover analytics could not be loaded.";
    console.error("[meta-studio/live-takeover/analytics] Read failed:", message);
    return metaStudioJson({ error: message }, 500);
  }
}
