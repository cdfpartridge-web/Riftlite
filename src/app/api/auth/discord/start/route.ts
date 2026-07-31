import { type NextRequest, NextResponse } from "next/server";

import {
  DISCORD_ACCOUNT_CALLBACK_PATH,
  DISCORD_ACCOUNT_STATE_COOKIE,
  discordAccountAuthorizeUrl,
  discordAccountClientId,
  discordAccountClientSecret,
  discordAccountRedirectUri,
  newDiscordAccountState,
  sealDiscordAccountValue,
  validateDiscordDesktopLink,
} from "@/lib/discord/account-auth";
import { getFirestoreAdmin } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const db = getFirestoreAdmin();
  const clientId = discordAccountClientId();
  const clientSecret = discordAccountClientSecret();
  if (!db || !clientId || !clientSecret) {
    return Response.json({ error: "Discord account recovery is not configured." }, { status: 503 });
  }
  const sessionId = req.nextUrl.searchParams.get("session")?.trim() ?? "";
  const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase() ?? "";
  if (!sessionId || !code) {
    return Response.json({ error: "Desktop link session and code are required." }, { status: 400 });
  }
  try {
    await validateDiscordDesktopLink(db, sessionId, code);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Desktop link is invalid." }, { status: 409 });
  }

  const state = newDiscordAccountState(sessionId, code);
  const redirectUri = discordAccountRedirectUri(req.nextUrl.origin);
  const response = NextResponse.redirect(discordAccountAuthorizeUrl(clientId, redirectUri, state.state));
  response.cookies.set(DISCORD_ACCOUNT_STATE_COOKIE, sealDiscordAccountValue(state, clientSecret), {
    httpOnly: true,
    maxAge: 10 * 60,
    path: DISCORD_ACCOUNT_CALLBACK_PATH,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
  });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
