import { NextResponse } from "next/server";

import {
  ReplayCombinationRequestSchema,
  ReplayReferenceError,
  parseReplayCombinationRequest,
} from "@/lib/replay-combiner/input";
import { createCombinedReplay } from "@/lib/replay-v2-server/combine-service";
import {
  ReplayV2Error,
  readBoundedJson,
  replayApiError,
  requireReplayUser,
  serializeReplay,
} from "@/lib/replay-v2-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_COMBINE_JSON_BYTES = 8 * 1024;

export async function POST(request: Request) {
  try {
    const ownerUid = await requireReplayUser(request);
    const body = await readBoundedJson(request, MAX_COMBINE_JSON_BYTES);
    const parsed = ReplayCombinationRequestSchema.safeParse(body);
    if (!parsed.success) {
      const permissionMissing = !body ||
        typeof body !== "object" ||
        !("permissionConfirmed" in body) ||
        body.permissionConfirmed !== true;
      throw new ReplayV2Error(
        400,
        permissionMissing ? "replay_permission_required" : "invalid_combine_request",
        permissionMissing
          ? "Confirm that both players gave permission before combining their replay perspectives."
          : "Provide two valid RiftLite replay links or replay IDs.",
      );
    }

    let references;
    try {
      references = parseReplayCombinationRequest(parsed.data);
    } catch (error) {
      if (error instanceof ReplayReferenceError) {
        throw new ReplayV2Error(400, error.code, error.message);
      }
      throw error;
    }

    const result = await createCombinedReplay(
      ownerUid,
      references.leftReplayId,
      references.rightReplayId,
    );
    const replayId = result.record.replayId;
    return NextResponse.json(
      {
        replay: serializeReplay(result.record, true),
        created: result.created,
        confidence: result.confidence,
        diagnostics: result.diagnostics,
        canonicalEndpoint: `/api/v2/replays/${encodeURIComponent(replayId)}`,
        playerPath: `/replays/${encodeURIComponent(replayId)}`,
      },
      {
        status: result.created ? 201 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return replayApiError(error);
  }
}
