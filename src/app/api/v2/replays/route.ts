import { NextResponse } from "next/server";

import {
  ReplayV2Error,
  listOwnerReplays,
  listPublicReplays,
  normalizeListLimit,
  replayApiError,
  requireReplayViewerUser,
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
      // Listing is read-only and may use the short-lived HttpOnly desktop embed
      // session. Uploads and mutations continue to require a Firebase bearer token.
      const ownerUid = await requireReplayViewerUser(request);
      const items = await listOwnerReplays(ownerUid, limit);
      return NextResponse.json(
        { items, count: items.length, scope },
        { headers: { "Cache-Control": "no-store", Vary: "Authorization, Cookie" } },
      );
    }
    const page = await listPublicReplays(limit, url.searchParams.get("cursor") ?? "");
    return NextResponse.json(
      {
        items: page.items,
        count: page.items.length,
        scope,
        pageInfo: {
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const developmentFallback = await readPublicProductionReplayListInDevelopment(
      request,
      error,
    );
    if (developmentFallback) return developmentFallback;
    return replayApiError(error);
  }
}

/**
 * Keep the public replay library usable in a local UI checkout that does not
 * carry production Firebase credentials. Identity is never forwarded and the
 * fixed upstream endpoint can only return already-public replay summaries.
 */
async function readPublicProductionReplayListInDevelopment(
  request: Request,
  error: unknown,
): Promise<NextResponse | null> {
  if (
    process.env.NODE_ENV !== "development" ||
    !(error instanceof ReplayV2Error) ||
    error.code !== "firebase_unavailable"
  ) {
    return null;
  }
  const requestUrl = new URL(request.url);
  if (!["127.0.0.1", "localhost", "::1"].includes(requestUrl.hostname.toLowerCase())) {
    return null;
  }
  if (requestUrl.searchParams.get("mine") === "1" || requestUrl.searchParams.get("scope") === "mine") {
    return null;
  }

  const upstream = new URL("https://www.riftlite.com/api/v2/replays");
  upstream.searchParams.set("scope", "public");
  for (const key of ["limit", "cursor"] as const) {
    const value = requestUrl.searchParams.get(key);
    if (value) upstream.searchParams.set(key, value);
  }
  try {
    const response = await fetch(upstream, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = await response.json() as unknown;
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
        "X-RiftLite-Local-Artifact-Source": "public-production-api",
      },
    });
  } catch {
    return null;
  }
}
