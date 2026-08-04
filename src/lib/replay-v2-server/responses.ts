import { NextResponse } from "next/server";

import { ReplayV2Error, replayApiProblem } from "@/lib/replay-v2-server/errors";

export function replayApiError(error: unknown): NextResponse {
  if (error instanceof ReplayV2Error) {
    const problem = replayApiProblem(error);
    return NextResponse.json(
      {
        error: problem.message,
        code: problem.code,
        errorClass: problem.class,
        retryable: problem.retryable,
        recommendedAction: problem.recommendedAction,
        ...(problem.retryAfterMs ? { retryAfterMs: problem.retryAfterMs } : {}),
      },
      {
        status: problem.status,
        headers: {
          "Cache-Control": "no-store",
          ...(problem.retryAfterMs
            ? { "Retry-After": String(Math.ceil(problem.retryAfterMs / 1_000)) }
            : {}),
        },
      },
    );
  }
  console.error("Replay v2 API request failed", error);
  const problem = replayApiProblem(error);
  return NextResponse.json(
    {
      error: problem.message,
      code: problem.code,
      errorClass: problem.class,
      retryable: problem.retryable,
      recommendedAction: problem.recommendedAction,
    },
    { status: problem.status, headers: { "Cache-Control": "no-store" } },
  );
}

export function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
