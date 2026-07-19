import {
  ReplayV2Error,
  isReplayId,
  readOwnerRawReplay,
  replayApiError,
  requireReplayUser,
} from "@/lib/replay-v2-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ replayId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { replayId } = await context.params;
    if (!isReplayId(replayId)) {
      throw new ReplayV2Error(400, "invalid_replay_id", "Replay id is invalid.");
    }
    const ownerUid = await requireReplayUser(request);
    const { record, bytes } = await readOwnerRawReplay(ownerUid, replayId);
    return new Response(Uint8Array.from(bytes).buffer, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/gzip",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${replayId}-raw.json.gz"`,
        "X-Replay-SHA256": record.rawArtifact!.sha256,
        Vary: "Authorization, Cookie",
      },
    });
  } catch (error) {
    return replayApiError(error);
  }
}
