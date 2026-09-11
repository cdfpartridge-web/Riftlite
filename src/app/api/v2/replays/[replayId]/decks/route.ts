import {
  isReplayId,
  noStoreJson,
  readBoundedJson,
  readOwnerReplayDecks,
  replayApiError,
  ReplayV2Error,
  requireReplayUser,
  requireReplayViewerUser,
  saveOwnerReplayDecks,
} from "@/lib/replay-v2-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ replayId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { replayId } = await context.params;
    if (!isReplayId(replayId)) throw new ReplayV2Error(400, "invalid_replay_id", "Replay ID is invalid.");
    const uid = await requireReplayViewerUser(request);
    return noStoreJson({ history: await readOwnerReplayDecks(uid, replayId) });
  } catch (error) {
    return replayApiError(error);
  }
}
export async function PUT(request: Request, context: Context) {
  try {
    const { replayId } = await context.params;
    if (!isReplayId(replayId)) throw new ReplayV2Error(400, "invalid_replay_id", "Replay ID is invalid.");
    const uid = await requireReplayUser(request);
    const body = (await readBoundedJson(request, 128_000)) as { history?: unknown; matchId?: unknown };
    if (!body || typeof body.matchId !== "string" || body.matchId.length > 160)
      throw new ReplayV2Error(400, "invalid_match_id", "Match ID is invalid.");
    await saveOwnerReplayDecks(uid, replayId, body.matchId, body.history);
    return noStoreJson({ ok: true });
  } catch (error) {
    return replayApiError(error);
  }
}
