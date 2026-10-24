import { isReplayId } from "@/lib/replay-v2-server/ids";
import { optionalReplayUser, requireReplayMutationUser } from "@/lib/replay-v2-server/auth";
import { readBoundedJson } from "@/lib/replay-v2-server/http";
import { ReplayV2Error } from "@/lib/replay-v2-server/errors";
import { noStoreJson, replayApiError } from "@/lib/replay-v2-server/responses";
import {
  MAX_ATLAS_POSTGAME_REQUEST_BYTES, readAtlasPostgame, saveAtlasPostgame, shareAtlasPostgame,
} from "@/lib/replay-v2-server/atlas-postgame";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ replayId: string }> };
async function replayId(context: Context): Promise<string> {
  const { replayId } = await context.params;
  if (!isReplayId(replayId)) throw new ReplayV2Error(400, "invalid_replay_id", "Replay ID is invalid.");
  return replayId;
}
export async function GET(request: Request, context: Context) {
  try {
    const id = await replayId(context), accountId = await optionalReplayUser(request);
    const url = new URL(request.url), gameId = url.searchParams.get("gameId") || undefined;
    if (gameId && (gameId.length > 160 || /[\u0000-\u001f]/.test(gameId))) {
      throw new ReplayV2Error(400, "postgame_game_invalid", "Game ID is invalid.");
    }
    return noStoreJson(await readAtlasPostgame(accountId, id, { metadataOnly: url.searchParams.get("metadata") === "1", gameId }));
  } catch (error) { return replayApiError(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const id = await replayId(context), accountId = await requireReplayMutationUser(request);
    const body = await readBoundedJson(request, MAX_ATLAS_POSTGAME_REQUEST_BYTES);
    return noStoreJson(await saveAtlasPostgame(accountId, id, body));
  } catch (error) {
    if (error instanceof ReplayV2Error && error.status === 409) {
      const codes = ["postgame_match_mismatch", "postgame_account_changed", "postgame_replay_not_ready", "postgame_import_changed", "postgame_original_changed"];
      // Only fixed error codes: no replay/account identifiers, body or error text.
      console.warn("Atlas postgame attachment rejected", { code: codes.includes(error.code) ? error.code : "other_conflict" });
    }
    return replayApiError(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const id = await replayId(context), accountId = await requireReplayMutationUser(request);
    return noStoreJson(await shareAtlasPostgame(accountId, id, await readBoundedJson(request, 1024)));
  } catch (error) { return replayApiError(error); }
}
