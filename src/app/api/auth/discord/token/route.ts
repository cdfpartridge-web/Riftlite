import { type NextRequest, NextResponse } from "next/server";

import {
  DISCORD_ACCOUNT_RESULT_COOKIE,
  DISCORD_ACCOUNT_TOKEN_PATH,
  discordAccountClientSecret,
  unsealDiscordAccountValue,
  type DiscordAccountResult,
} from "@/lib/discord/account-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(req: NextRequest) {
  const result = unsealDiscordAccountValue<DiscordAccountResult>(
    req.cookies.get(DISCORD_ACCOUNT_RESULT_COOKIE)?.value ?? "",
    discordAccountClientSecret(),
  );
  const response = NextResponse.json(
    result?.customToken
      ? { customToken: result.customToken, uid: result.uid ?? "" }
      : { error: result?.error || "Discord account recovery expired. Start again from RiftLite." },
    { status: result?.customToken ? 200 : 409 },
  );
  response.cookies.set(DISCORD_ACCOUNT_RESULT_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: DISCORD_ACCOUNT_TOKEN_PATH,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
  });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
