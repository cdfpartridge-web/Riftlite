import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";

import { canonicalIdentityUid } from "@/lib/identity-server";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";

export const DISCORD_ACCOUNT_STATE_COOKIE = "riftlite_discord_account_state";
export const DISCORD_ACCOUNT_RESULT_COOKIE = "riftlite_discord_account_result";
export const DISCORD_ACCOUNT_CALLBACK_PATH = "/api/auth/discord/callback";
export const DISCORD_ACCOUNT_TOKEN_PATH = "/api/auth/discord/token";

export type DiscordAccountState = {
  state: string;
  sessionId: string;
  code: string;
  expiresAt: number;
};

export type DiscordAccountResult = {
  customToken?: string;
  uid?: string;
  error?: string;
  expiresAt: number;
};

export function discordAccountClientId(): string {
  return process.env.DISCORD_CLIENT_ID?.trim()
    || process.env.DISCORD_APPLICATION_ID?.trim()
    || "1507035519916179496";
}

export function discordAccountClientSecret(): string {
  return process.env.DISCORD_CLIENT_SECRET?.trim() ?? "";
}

export function discordAccountRedirectUri(origin: string): string {
  return process.env.DISCORD_OAUTH_REDIRECT_URI?.trim()
    || new URL(DISCORD_ACCOUNT_CALLBACK_PATH, origin).toString();
}

export function newDiscordAccountState(sessionId: string, code: string, now = Date.now()): DiscordAccountState {
  return {
    state: randomBytes(24).toString("base64url"),
    sessionId,
    code,
    expiresAt: now + 10 * 60 * 1000,
  };
}

export function discordAccountAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    state,
  }).toString();
  return url.toString();
}

export function sealDiscordAccountValue(value: DiscordAccountState | DiscordAccountResult, secret: string): string {
  if (!secret) return "";
  const body = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function unsealDiscordAccountValue<T extends DiscordAccountState | DiscordAccountResult>(
  value: string,
  secret: string,
  now = Date.now(),
): T | null {
  if (!value || !secret) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const body = value.slice(0, separator);
  const supplied = Buffer.from(value.slice(separator + 1), "base64url");
  const expected = createHmac("sha256", secret).update(body).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    return Number(parsed.expiresAt ?? 0) >= now ? parsed : null;
  } catch {
    return null;
  }
}

export async function exchangeDiscordAccountCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<string> {
  const response = await fetch(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const accessToken = String(payload.access_token ?? "").trim();
  if (!response.ok || !accessToken) {
    throw new Error("Discord sign in could not be completed. Please try again.");
  }
  return accessToken;
}

export async function readDiscordAccountUserId(accessToken: string): Promise<string> {
  const response = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const userId = String(payload.id ?? "").trim();
  if (!response.ok || !/^\d{5,30}$/.test(userId)) {
    throw new Error("Discord did not return a valid account identity.");
  }
  return userId;
}

export async function discordLinkedRiftLiteUid(db: Firestore, discordUserId: string): Promise<string> {
  const links = await db.collection("discordLinks")
    .where("discordUserId", "==", discordUserId)
    .get();
  const rawUids = Array.from(new Set(links.docs
    .map((doc) => String(doc.data().uid ?? "").trim())
    .filter(Boolean)));
  const canonicalUids = Array.from(new Set((await Promise.all(
    rawUids.map((uid) => canonicalIdentityUid(uid, db)),
  )).filter(Boolean)));
  if (!canonicalUids.length) {
    throw new Error("No existing RiftLite account is linked to this Discord user. Use Google or email for a new account.");
  }
  if (canonicalUids.length > 1) {
    throw new Error("This Discord user is linked to more than one older RiftLite account. Contact RiftLite support before continuing.");
  }
  return canonicalUids[0];
}

export async function validateDiscordDesktopLink(
  db: Firestore,
  sessionId: string,
  code: string,
  now = Date.now(),
): Promise<{ expectedUid: string }> {
  const snap = await db.collection("desktopLinkSessions").doc(sessionId).get();
  const data = snap.data();
  if (!snap.exists || !data) throw new Error("Desktop link session was not found.");
  if (String(data.code ?? "").trim().toUpperCase() !== code.trim().toUpperCase()) {
    throw new Error("Desktop link code did not match.");
  }
  if (String(data.status ?? "pending") !== "pending") {
    throw new Error("Desktop link session has already been used.");
  }
  if (Number(data.expiresAt ?? 0) < now) throw new Error("Desktop link session has expired.");
  return { expectedUid: await canonicalIdentityUid(data.expectedUid, db) };
}
