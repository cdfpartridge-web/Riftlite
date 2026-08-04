import {
  ReplayV2Error,
  isReplayId,
  noStoreJson,
  readOwnerReplayDeliveryStatus,
  replayApiError,
  requireReplayUser,
} from "@/lib/replay-v2-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const replay = await readOwnerReplayDeliveryStatus(ownerUid, replayId);
    return noStoreJson({ replay });
  } catch (error) {
    return replayApiError(error);
  }
}
