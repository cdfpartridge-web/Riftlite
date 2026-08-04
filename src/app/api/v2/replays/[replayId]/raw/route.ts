import {
  MAX_RAW_GZIP_BYTES,
  ReplayV2Error,
  isReplayId,
  noStoreJson,
  readBoundedBytes,
  replayApiError,
  requireGzipContentType,
  requireReplayUser,
  requiredUploadDeclaration,
  serializeReplay,
  uploadRawReplay,
} from "@/lib/replay-v2-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ replayId: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { replayId } = await context.params;
    if (!isReplayId(replayId)) {
      throw new ReplayV2Error(400, "invalid_replay_id", "Replay id is invalid.");
    }
    const ownerUid = await requireReplayUser(request);
    requireGzipContentType(request);
    const declaration = requiredUploadDeclaration(request);
    if (declaration.bytes > MAX_RAW_GZIP_BYTES) {
      throw new ReplayV2Error(413, "body_too_large", "Replay upload is too large.");
    }
    const bytes = await readBoundedBytes(request, MAX_RAW_GZIP_BYTES);
    const record = await uploadRawReplay(ownerUid, replayId, bytes, declaration);
    return noStoreJson({
      replay: serializeReplay(record, true),
      completeEndpoint: `/api/v2/replays/${encodeURIComponent(replayId)}/complete`,
      statusEndpoint: `/api/v2/replays/${encodeURIComponent(replayId)}/status`,
    });
  } catch (error) {
    return replayApiError(error);
  }
}
