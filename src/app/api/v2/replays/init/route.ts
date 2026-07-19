import { NextResponse } from "next/server";

import {
  InitReplaySchema,
  MAX_INIT_JSON_BYTES,
  ReplayV2Error,
  initReplay,
  readBoundedJson,
  replayApiError,
  requireReplayUser,
  serializeReplay,
} from "@/lib/replay-v2-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ownerUid = await requireReplayUser(request);
    const parsed = InitReplaySchema.safeParse(await readBoundedJson(request, MAX_INIT_JSON_BYTES));
    if (!parsed.success) {
      throw new ReplayV2Error(400, "invalid_init", "Replay initialization payload is invalid.");
    }

    const result = await initReplay(ownerUid, parsed.data);
    const replayId = result.record.replayId;
    return NextResponse.json(
      {
        replay: serializeReplay(result.record, true),
        uploadRequired: result.uploadRequired,
        upload: result.uploadRequired
          ? {
              method: "PUT",
              endpoint: `/api/v2/replays/${encodeURIComponent(replayId)}/raw`,
              contentType: "application/gzip",
              headers: {
                "X-Replay-SHA256": result.record.expectedRaw.sha256,
                "X-Replay-Bytes": String(result.record.expectedRaw.bytes),
              },
            }
          : null,
        completeEndpoint: `/api/v2/replays/${encodeURIComponent(replayId)}/complete`,
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
