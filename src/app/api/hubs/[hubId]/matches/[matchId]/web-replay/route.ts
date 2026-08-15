import { type NextRequest } from "next/server";

import {
  MAX_VISIBILITY_JSON_BYTES,
  ReplayV2Error,
  deleteHubWebReplay,
  noStoreJson,
  putHubWebReplay,
  readBoundedJson,
  replayApiError,
  requireFirebaseBearerUser,
} from "@/lib/replay-v2-server";
import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { identityUidsFor } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ hubId: string; matchId: string }>;
};

// Old desktop builds treat every non-2xx response as a failure of the entire
// private-hub match upload, even though the match and aggregate were already
// stored before this optional attachment is attempted. These outcomes cannot
// become valid by repeating the same request. A 2xx compatibility
// acknowledgement lets those clients commit the base match as synced while
// explicitly reporting that no Web Replay link or access grant was created.
const TERMINAL_COMPATIBILITY_SKIP_CODES = new Set([
  "account_hub_required",
  "hub_deleting",
  "replay_match_mismatch",
]);

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    // Verify the untouched bearer token. `requireUser()` canonicalizes the UID
    // in its decoded-token copy, which removes the historical desktop alias
    // needed by the Replay V2 association verifier.
    const accountUid = await requireFirebaseBearerUser(request);
    const db = getFirestoreAdmin();
    if (!db) throw new ReplayV2Error(503, "firebase_unavailable", "Firebase admin is not configured.");
    const [{ hubId, matchId }, body, identityUids] = await Promise.all([
      context.params,
      readBoundedJson(request, MAX_VISIBILITY_JSON_BYTES),
      identityUidsFor(accountUid, db),
    ]);
    const replayId = isRecord(body) ? stringValue(body.replayId) : "";
    const result = await putHubWebReplay(db, {
      hubId,
      matchId,
      replayId,
      actorUid: accountUid,
      identityUids,
    });
    return noStoreJson({
      ok: true,
      ...result,
      playerPath: `/replays/${encodeURIComponent(result.replayId)}`,
    });
  } catch (error) {
    if (
      error instanceof ReplayV2Error &&
      TERMINAL_COMPATIBILITY_SKIP_CODES.has(error.code)
    ) {
      return noStoreJson({
        ok: true,
        linked: false,
        skipped: true,
        reason: error.code,
        message: error.message,
      });
    }
    return replayApiError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const accountUid = await requireFirebaseBearerUser(request);
    const db = getFirestoreAdmin();
    if (!db) throw new ReplayV2Error(503, "firebase_unavailable", "Firebase admin is not configured.");
    const [{ hubId, matchId }, identityUids] = await Promise.all([
      context.params,
      identityUidsFor(accountUid, db),
    ]);
    const result = await deleteHubWebReplay(db, {
      hubId,
      matchId,
      actorUid: accountUid,
      identityUids,
    });
    return noStoreJson({ ok: true, ...result });
  } catch (error) {
    return replayApiError(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
