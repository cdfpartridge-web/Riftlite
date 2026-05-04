import { type NextRequest } from "next/server";

import {
  cleanDisplayName,
  cleanHandle,
  ensureUserProfile,
  readBool,
  requireUser,
  saveAccountProfile,
  socialJson,
} from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const profile = await ensureUserProfile(auth.decoded.uid, auth.decoded.name ?? auth.decoded.email ?? "", auth.decoded.email ?? "");
  return socialJson({ ok: true, profile });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const body = await readBody(req);
  try {
    const profile = await saveAccountProfile(auth.decoded.uid, {
      handle: body.handle === undefined ? undefined : cleanHandle(body.handle),
      displayName: body.displayName === undefined ? undefined : cleanDisplayName(body.displayName),
      searchable: body.searchable === undefined ? undefined : readBool(body.searchable),
      publicProfile: body.publicProfile === undefined ? undefined : readBool(body.publicProfile),
      showStats: body.showStats === undefined ? undefined : readBool(body.showStats, true),
      showMatches: body.showMatches === undefined ? undefined : readBool(body.showMatches, true),
      showDecks: body.showDecks === undefined ? undefined : readBool(body.showDecks, true),
      showHubBadges: body.showHubBadges === undefined ? undefined : readBool(body.showHubBadges),
      marketingConsent: body.marketingConsent === undefined ? undefined : readBool(body.marketingConsent),
    }, {
      email: auth.decoded.email ?? "",
      consentSource: "desktop-account-profile",
    });
    return socialJson({ ok: true, profile });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Profile update failed" }, 400);
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
