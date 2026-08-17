import { NextResponse, type NextRequest } from "next/server";

import {
  applyMetaStudioPrivateHeaders,
  requireMetaStudioSession,
} from "@/lib/community/meta-studio-auth";
import {
  ReplayV2Error,
  isReplayId,
  readMetaStudioCanonicalReplay,
  replayApiError,
  serializeReplay,
} from "@/lib/replay-v2-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ replayId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const principal = await requireMetaStudioSession(request);
  if ("error" in principal) return principal.error;

  try {
    const { replayId } = await context.params;
    if (!isReplayId(replayId)) {
      throw new ReplayV2Error(400, "invalid_replay_id", "Replay id is invalid.");
    }

    const { record, bytes } = await readMetaStudioCanonicalReplay(replayId);
    if (!bytes || !record.canonicalArtifact) {
      return applyMetaStudioPrivateHeaders(NextResponse.json(
        { replay: serializeReplay(record, false) },
        { status: 202 },
      ));
    }

    const etag = `"${record.canonicalArtifact.sha256}"`;
    const sharedHeaders: Record<string, string> = {
      ETag: etag,
      "X-RiftLite-Replay-Id": replayId,
      "X-RiftLite-Replay-Visibility": record.visibility,
    };
    if (request.headers.get("if-none-match") === etag) {
      return applyMetaStudioPrivateHeaders(new NextResponse(null, {
        status: 304,
        headers: sharedHeaders,
      }));
    }

    return applyMetaStudioPrivateHeaders(new NextResponse(
      Uint8Array.from(bytes).buffer,
      {
        status: 200,
        headers: {
          ...sharedHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Content-Encoding": "gzip",
          "Content-Length": String(bytes.length),
          "Content-Disposition": `inline; filename="${replayId}.json"`,
        },
      },
    ));
  } catch (error) {
    return applyMetaStudioPrivateHeaders(replayApiError(error));
  }
}
