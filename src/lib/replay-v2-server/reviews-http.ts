import "server-only";
import { NextResponse } from "next/server";
import { ReplayV2Error } from "@/lib/replay-v2-server/errors";
import { replayApiError } from "@/lib/replay-v2-server/responses";
import { ReplayReviewConflict } from "@/lib/replay-v2-server/reviews";

export function reviewJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization, Cookie" } });
}
export function reviewError(error: unknown, accountId?: string): NextResponse {
  if (error instanceof ReplayReviewConflict) {
    return reviewJson({ accountId: error.accountId, code: error.code, error: error.message, review: error.review }, 409);
  }
  if (error instanceof ReplayV2Error && accountId) {
    return reviewJson({ accountId, code: error.code, error: error.message }, error.status);
  }
  const response = replayApiError(error);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Authorization, Cookie");
  return response;
}
