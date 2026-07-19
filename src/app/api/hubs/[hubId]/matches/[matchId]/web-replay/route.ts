import { type NextRequest } from "next/server";

import {
  MAX_VISIBILITY_JSON_BYTES,
  deleteHubWebReplay,
  noStoreJson,
  putHubWebReplay,
  readBoundedJson,
  replayApiError,
} from "@/lib/replay-v2-server";
import { linkedReplayUid } from "@/lib/replay-v2-server/identity";
import { identityUidsFor, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ hubId: string; matchId: string }>;
};

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  if (!linkedReplayUid(auth.decoded)) {
    return socialJson(
      { error: "A linked RiftLite account is required.", code: "authentication_required" },
      401,
    );
  }

  try {
    const [{ hubId, matchId }, body, identityUids] = await Promise.all([
      context.params,
      readBoundedJson(request, MAX_VISIBILITY_JSON_BYTES),
      identityUidsFor(auth.decoded.uid, auth.db),
    ]);
    const replayId = isRecord(body) ? stringValue(body.replayId) : "";
    const result = await putHubWebReplay(auth.db, {
      hubId,
      matchId,
      replayId,
      actorUid: auth.decoded.uid,
      identityUids,
    });
    return noStoreJson({
      ok: true,
      ...result,
      playerPath: `/replays/${encodeURIComponent(result.replayId)}`,
    });
  } catch (error) {
    return replayApiError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  if (!linkedReplayUid(auth.decoded)) {
    return socialJson(
      { error: "A linked RiftLite account is required.", code: "authentication_required" },
      401,
    );
  }

  try {
    const [{ hubId, matchId }, identityUids] = await Promise.all([
      context.params,
      identityUidsFor(auth.decoded.uid, auth.db),
    ]);
    const result = await deleteHubWebReplay(auth.db, {
      hubId,
      matchId,
      actorUid: auth.decoded.uid,
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
