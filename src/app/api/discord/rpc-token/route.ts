import { type NextRequest } from "next/server";

import { requireLinkedProfile, socialJson } from "@/lib/social-hub";

const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token/rpc";
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim()
  || process.env.DISCORD_APPLICATION_ID?.trim()
  || "1507035519916179496";

export async function POST(req: NextRequest) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    body = {};
  }

  const code = String(body.code ?? "").trim();
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim() ?? "";
  if (!code) {
    return socialJson({ error: "Missing Discord authorization code." }, 400);
  }
  if (!DISCORD_CLIENT_ID || !clientSecret) {
    return socialJson({ error: "Discord direct voice join is not configured yet." }, 503);
  }

  const form = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code
  });

  const response = await fetch(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = String(payload.error_description ?? payload.error ?? "Discord authorization failed.");
    return socialJson({ error: message }, 502);
  }

  const accessToken = String(payload.access_token ?? "");
  const expiresIn = Number(payload.expires_in ?? 0);
  if (!accessToken) {
    return socialJson({ error: "Discord did not return an access token." }, 502);
  }

  return socialJson({
    accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn || 3600) * 1000
  });
}
