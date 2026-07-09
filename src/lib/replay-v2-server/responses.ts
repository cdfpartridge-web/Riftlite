import { NextResponse } from "next/server";

import { ReplayV2Error } from "@/lib/replay-v2-server/errors";

export function replayApiError(error: unknown): NextResponse {
  if (error instanceof ReplayV2Error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  console.error("Replay v2 API request failed", error);
  return NextResponse.json(
    { error: "Replay request failed.", code: "internal_error" },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
