import { NextResponse } from "next/server";

import {
  MAX_VISIBILITY_JSON_BYTES,
  ReplayV2Error,
  VisibilityUpdateSchema,
  deleteOwnerReplay,
  isReplayId,
  noStoreJson,
  optionalReplayUser,
  readBoundedJson,
  readCanonicalReplay,
  replayApiError,
  requireReplayUser,
  requireReplayViewerUser,
  serializeReplay,
  updateReplayVisibility,
} from "@/lib/replay-v2-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ replayId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  let requestedReplayId = "";
  try {
    const { replayId } = await context.params;
    requestedReplayId = replayId;
    if (!isReplayId(replayId)) {
      throw new ReplayV2Error(400, "invalid_replay_id", "Replay id is invalid.");
    }
    const viewerUid = await optionalReplayUser(request);
    const { record, bytes } = await readCanonicalReplay(replayId, viewerUid);
    if (!bytes || !record.canonicalArtifact) {
      return NextResponse.json(
        { replay: serializeReplay(record, record.ownerUid === viewerUid) },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }

    const etag = `"${record.canonicalArtifact.sha256}"`;
    const sharedHeaders: Record<string, string> = {
      "Cache-Control": "private, no-store, max-age=0",
      ETag: etag,
      "X-RiftLite-Replay-Id": replayId,
      "X-RiftLite-Replay-Visibility": record.visibility,
      Vary: "Authorization, Cookie",
    };
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: sharedHeaders });
    }

    return new Response(Uint8Array.from(bytes).buffer, {
      status: 200,
      headers: {
        ...sharedHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "gzip",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename="${replayId}.json"`,
      },
    });
  } catch (error) {
    const developmentFallback = await readPublicProductionReplayInDevelopment(
      request,
      requestedReplayId,
      error,
    );
    if (developmentFallback) return developmentFallback;
    return replayApiError(error);
  }
}

/**
 * Local development can read production Firestore metadata without holding a
 * private Vercel Blob token. For public replay testing only, let a loopback
 * server retrieve the already-public canonical artifact through the production
 * API. This branch is unavailable in production and never forwards identity
 * headers or cookies, so private and unlisted replays remain fail-closed.
 */
async function readPublicProductionReplayInDevelopment(
  request: Request,
  replayId: string,
  error: unknown,
): Promise<NextResponse | null> {
  if (
    process.env.NODE_ENV !== "development" ||
    !(error instanceof ReplayV2Error) ||
    !["artifact_read_failed", "firebase_unavailable"].includes(error.code) ||
    !isReplayId(replayId)
  ) {
    return null;
  }
  const hostname = new URL(request.url).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) return null;

  try {
    const response = await fetch(
      `https://www.riftlite.com/api/v2/replays/${encodeURIComponent(replayId)}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );
    if (!response.ok) return null;
    const canonical = await response.json() as unknown;
    return NextResponse.json(canonical, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-RiftLite-Local-Artifact-Source": "public-production-api",
      },
    });
  } catch {
    return null;
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { replayId } = await context.params;
    if (!isReplayId(replayId)) {
      throw new ReplayV2Error(400, "invalid_replay_id", "Replay id is invalid.");
    }
    const ownerUid = await requireReplayUser(request);
    const parsed = VisibilityUpdateSchema.safeParse(
      await readBoundedJson(request, MAX_VISIBILITY_JSON_BYTES),
    );
    if (!parsed.success) {
      throw new ReplayV2Error(400, "invalid_visibility", "Replay visibility is invalid.");
    }
    const record = await updateReplayVisibility(ownerUid, replayId, parsed.data.visibility);
    return NextResponse.json(
      { replay: serializeReplay(record, true) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return replayApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { replayId } = await context.params;
    if (!isReplayId(replayId)) {
      throw new ReplayV2Error(400, "invalid_replay_id", "Replay id is invalid.");
    }
    const ownerUid = await requireReplayViewerUser(request);
    const result = await deleteOwnerReplay(ownerUid, replayId);
    return noStoreJson({
      ok: true,
      replayId: result.replayId,
      cleanupComplete: result.cleanupComplete,
    });
  } catch (error) {
    return replayApiError(error);
  }
}
