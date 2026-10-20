import { DeleteReplayReviewSchema, MAX_REVIEW_JSON_BYTES, ReviewReplayIdSchema, SaveReplayReviewSchema } from "@/lib/replay-reviews";
import { requireReplayMutationUser, requireReplayViewerUser } from "@/lib/replay-v2-server/auth";
import { ReplayV2Error } from "@/lib/replay-v2-server/errors";
import { readBoundedJson } from "@/lib/replay-v2-server/http";
import { deleteSavedReplayReview, readSavedReplayReview, saveReplayReview } from "@/lib/replay-v2-server/reviews";
import { reviewError, reviewJson } from "@/lib/replay-v2-server/reviews-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ replayId: string }> };

export async function GET(request: Request, context: Context) {
  let accountId: string | undefined;
  try {
    accountId = await requireReplayViewerUser(request);
    const replayId = await routeReplayId(context);
    return reviewJson({ accountId, review: await readSavedReplayReview(accountId, replayId) });
  } catch (error) { return reviewError(error, accountId); }
}

export async function PUT(request: Request, context: Context) {
  let accountId: string | undefined;
  try {
    accountId = await requireReplayMutationUser(request);
    const replayId = await routeReplayId(context);
    const parsed = SaveReplayReviewSchema.safeParse(await readBoundedJson(request, MAX_REVIEW_JSON_BYTES));
    if (!parsed.success) throw new ReplayV2Error(400, "invalid_review", "The review could not be saved. Check note lengths and reload your account if needed.");
    return reviewJson({ accountId, review: await saveReplayReview(accountId, replayId, parsed.data) });
  } catch (error) { return reviewError(error, accountId); }
}

export async function DELETE(request: Request, context: Context) {
  let accountId: string | undefined;
  try {
    accountId = await requireReplayMutationUser(request);
    const replayId = await routeReplayId(context);
    const parsed = DeleteReplayReviewSchema.safeParse(await readBoundedJson(request, 1024));
    if (!parsed.success) throw new ReplayV2Error(400, "invalid_review", "The review could not be removed. Reload your account and try again.");
    await deleteSavedReplayReview(accountId, replayId, parsed.data);
    return reviewJson({ accountId, deleted: true, replayId });
  } catch (error) { return reviewError(error, accountId); }
}

async function routeReplayId(context: Context) {
  const { replayId } = await context.params;
  if (!ReviewReplayIdSchema.safeParse(replayId).success) throw new ReplayV2Error(400, "invalid_replay_id", "Replay id is invalid.");
  return replayId;
}
