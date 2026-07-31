import { type NextRequest, NextResponse } from "next/server";

import {
  DISCORD_ACCOUNT_CALLBACK_PATH,
  DISCORD_ACCOUNT_RESULT_COOKIE,
  DISCORD_ACCOUNT_STATE_COOKIE,
  DISCORD_ACCOUNT_TOKEN_PATH,
  discordAccountClientId,
  discordAccountClientSecret,
  discordAccountRedirectUri,
  discordLinkedRiftLiteUid,
  exchangeDiscordAccountCode,
  readDiscordAccountUserId,
  sealDiscordAccountValue,
  unsealDiscordAccountValue,
  validateDiscordDesktopLink,
  type DiscordAccountResult,
  type DiscordAccountState,
} from "@/lib/discord/account-auth";
import { createFirebaseCustomToken, getFirestoreAdmin } from "@/lib/firebase/admin";
import { claimLinkedIdentityAssociation } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const db = getFirestoreAdmin();
  const clientId = discordAccountClientId();
  const clientSecret = discordAccountClientSecret();
  const state = unsealDiscordAccountValue<DiscordAccountState>(
    req.cookies.get(DISCORD_ACCOUNT_STATE_COOKIE)?.value ?? "",
    clientSecret,
  );
  if (!db || !clientId || !clientSecret || !state) {
    return Response.json({ error: "Discord account recovery expired. Start again from RiftLite." }, { status: 400 });
  }

  const finish = (result: Omit<DiscordAccountResult, "expiresAt">) => {
    const redirect = new URL("/link-device", req.nextUrl.origin);
    redirect.search = new URLSearchParams({
      session: state.sessionId,
      code: state.code,
      provider: "discord",
      discord: "complete",
    }).toString();
    const response = NextResponse.redirect(redirect);
    response.cookies.set(DISCORD_ACCOUNT_STATE_COOKIE, "", {
      httpOnly: true,
      maxAge: 0,
      path: DISCORD_ACCOUNT_CALLBACK_PATH,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
    });
    response.cookies.set(DISCORD_ACCOUNT_RESULT_COOKIE, sealDiscordAccountValue({
      ...result,
      expiresAt: Date.now() + 2 * 60 * 1000,
    }, clientSecret), {
      httpOnly: true,
      maxAge: 2 * 60,
      path: DISCORD_ACCOUNT_TOKEN_PATH,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
    });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  };

  try {
    if (req.nextUrl.searchParams.get("state") !== state.state) {
      throw new Error("Discord sign-in state did not match. Start again from RiftLite.");
    }
    const authorizationCode = req.nextUrl.searchParams.get("code")?.trim() ?? "";
    if (!authorizationCode) throw new Error("Discord sign in was cancelled or did not return a code.");
    const link = await validateDiscordDesktopLink(db, state.sessionId, state.code);
    const accessToken = await exchangeDiscordAccountCode({
      code: authorizationCode,
      clientId,
      clientSecret,
      redirectUri: discordAccountRedirectUri(req.nextUrl.origin),
    });
    const discordUserId = await readDiscordAccountUserId(accessToken);
    const uid = await discordLinkedRiftLiteUid(db, discordUserId);
    if (link.expectedUid && link.expectedUid !== uid) {
      throw new Error("This Discord user is linked to a different RiftLite account than the one stored on this device.");
    }
    await claimLinkedIdentityAssociation(db, uid, uid);
    const customToken = await createFirebaseCustomToken(uid);
    if (!customToken) throw new Error("RiftLite could not prepare the recovered account sign-in.");
    return finish({ customToken, uid });
  } catch (error) {
    return finish({ error: error instanceof Error ? error.message : "Discord account recovery failed." });
  }
}
