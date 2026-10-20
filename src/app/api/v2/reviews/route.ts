import { requireReplayViewerUser } from "@/lib/replay-v2-server/auth";
import { listSavedReplayReviews } from "@/lib/replay-v2-server/reviews";
import { reviewError, reviewJson } from "@/lib/replay-v2-server/reviews-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  let accountId: string | undefined;
  try {
    accountId = await requireReplayViewerUser(request);
    const url = new URL(request.url);
    const page = await listSavedReplayReviews(accountId, url.searchParams.get("limit"), url.searchParams.get("cursor"));
    return reviewJson({ accountId, ...page });
  } catch (error) {
    return reviewError(error, accountId);
  }
}
