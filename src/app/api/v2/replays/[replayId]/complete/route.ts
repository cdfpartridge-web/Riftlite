import {
  CompleteReplaySchema,
  MAX_COMPLETE_JSON_BYTES,
  ReplayV2Error,
  REPLAY_PROCESSING_RETRY_STATUS,
  completeReplay,
  isReplayId,
  noStoreJson,
  readBoundedJson,
  replayApiError,
  requireReplayUser,
  serializeReplay,
} from "@/lib/replay-v2-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ replayId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { replayId } = await context.params;
    if (!isReplayId(replayId)) {
      throw new ReplayV2Error(400, "invalid_replay_id", "Replay id is invalid.");
    }
    const ownerUid = await requireReplayUser(request);
    const parsed = request.body
      ? CompleteReplaySchema.safeParse(await readBoundedJson(request, MAX_COMPLETE_JSON_BYTES))
      : CompleteReplaySchema.safeParse({});
    if (!parsed.success) {
      throw new ReplayV2Error(400, "invalid_completion", "Replay completion options are invalid.");
    }
    const record = await completeReplay(ownerUid, replayId, parsed.data);
    if (record.status !== "ready" || !record.canonicalArtifact) {
      throw new ReplayV2Error(
        REPLAY_PROCESSING_RETRY_STATUS,
        "replay_processing",
        "Replay processing is still in progress. Retry shortly.",
      );
    }
    return noStoreJson({
      replay: serializeReplay(record, true),
      canonicalEndpoint: `/api/v2/replays/${encodeURIComponent(replayId)}`,
      playerPath: `/replays/${encodeURIComponent(replayId)}`,
    });
  } catch (error) {
    return replayApiError(error);
  }
}
