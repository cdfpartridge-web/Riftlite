import { NextResponse } from "next/server";

import {
  REPLAY_EMBED_COOKIE,
  REPLAY_EMBED_SESSION_SECRET_ENV,
  REPLAY_EMBED_SESSION_TTL_SECONDS,
  ReplayV2Error,
  configuredReplayEmbedSecret,
  replayApiError,
  requireFirebaseBearerUser,
  signReplayEmbedSession,
} from "@/lib/replay-v2-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const uid = await requireFirebaseBearerUser(request);
    let secret = "";
    try {
      secret = configuredReplayEmbedSecret();
    } catch {
      throw new ReplayV2Error(
        503,
        "embed_session_unavailable",
        `${REPLAY_EMBED_SESSION_SECRET_ENV} is not configured.`,
      );
    }
    const token = signReplayEmbedSession(uid, secret);
    const response = NextResponse.json(
      { ok: true, expiresIn: REPLAY_EMBED_SESSION_TTL_SECONDS },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set({
      name: REPLAY_EMBED_COOKIE,
      value: token,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: REPLAY_EMBED_SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    return replayApiError(error);
  }
}
