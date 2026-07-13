import { type NextRequest } from "next/server";

import { completeDiscordVerification } from "@/lib/discord/bot";
import { linkedReplayUid } from "@/lib/replay-v2-server/identity";
import { ensureUserProfile, profileIsComplete, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  if (!linkedReplayUid(auth.decoded)) return socialJson({ error: "Create or sign in to a recoverable RiftLite account first." }, 401);
  const body = await readBody(req);
  const code = String(body.code ?? "").trim();
  if (!code) return socialJson({ error: "Verification code is required." }, 400);

  try {
    const profile = await ensureUserProfile(auth.decoded.uid, auth.decoded.name ?? auth.decoded.email ?? "", auth.decoded.email ?? "");
    if (!profileIsComplete(profile)) {
      return socialJson({ error: "Choose your RiftLite display name and handle before verifying Discord.", code: "profile_incomplete" }, 409);
    }
    const result = await completeDiscordVerification(code, auth.decoded.uid, {
      handle: profile.handle,
      displayName: profile.displayName,
    });
    return socialJson({ ok: true, ...result });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Discord verification failed." }, 400);
  }
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
