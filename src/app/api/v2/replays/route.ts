import { NextResponse } from "next/server";

import {
  ReplayV2Error,
  listOwnerReplays,
  listPublicReplays,
  normalizeListLimit,
  replayApiError,
  requireReplayUser,
} from "@/lib/replay-v2-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("mine") === "1" ? "mine" : url.searchParams.get("scope") ?? "public";
    const limit = normalizeListLimit(url.searchParams.get("limit"));
    if (scope !== "public" && scope !== "mine") {
      throw new ReplayV2Error(400, "invalid_scope", "Replay list scope must be public or mine.");
    }
    if (scope === "mine") {
      const ownerUid = await requireReplayUser(request);
      const items = await listOwnerReplays(ownerUid, limit);
      return NextResponse.json(
        { items, count: items.length, scope },
        { headers: { "Cache-Control": "no-store", Vary: "Authorization, Cookie" } },
      );
    }
    const items = await listPublicReplays(limit);
    return NextResponse.json(
      { items, count: items.length, scope },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return replayApiError(error);
  }
}
