import { gunzipSync } from "node:zlib";

import { NextResponse } from "next/server";
import { z } from "zod";

import { shareReplayToDiscordFeeds } from "@/lib/discord/replay-share-server";
import { isDiscordReplayResultResolved } from "@/lib/discord/replay-share";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";
import {
  MAX_CANONICAL_JSON_BYTES,
  ReplayV2Error,
  isReplayId,
  readBoundedJson,
  readCanonicalReplay,
  replayApiError,
  requireReplayUser,
  updateReplayVisibility,
} from "@/lib/replay-v2-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const ShareSchema = z.object({
  hubIds: z.array(z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/)).min(1).max(10),
  activeDeck: z.object({
    title: z.string().trim().max(120).optional(),
    legend: z.string().trim().min(1).max(100),
    sourceUrl: z.string().trim().min(1).max(500),
  }).strict().optional(),
}).strict();

type RouteContext = { params: Promise<{ replayId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { replayId } = await context.params;
    if (!isReplayId(replayId)) throw new ReplayV2Error(400, "invalid_replay_id", "Replay id is invalid.");
    const ownerUid = await requireReplayUser(request);
    const parsed = ShareSchema.safeParse(await readBoundedJson(request, 8_192));
    if (!parsed.success) throw new ReplayV2Error(400, "invalid_hubs", "Choose one or more valid private hubs.");
    const hubIds = Array.from(new Set(parsed.data.hubIds));

    const { record, bytes } = await readCanonicalReplay(replayId, ownerUid);
    if (record.status !== "ready" || !bytes) {
      throw new ReplayV2Error(409, "replay_processing", "Replay processing is still in progress.");
    }
    const replay = JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_CANONICAL_JSON_BYTES }).toString("utf8")) as CanonicalReplayV2;
    if (!isDiscordReplayResultResolved(replay)) {
      throw new ReplayV2Error(
        409,
        "replay_result_pending",
        "The completed match result is not available yet. RiftLite will retry before posting this replay to Discord.",
      );
    }
    await updateReplayVisibility(ownerUid, replayId, "unlisted");
    const results = await shareReplayToDiscordFeeds({
      ownerUid,
      replayId,
      replay,
      hubIds,
      activeDeck: parsed.data.activeDeck,
      origin: process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://www.riftlite.com",
    });
    return NextResponse.json({
      ok: results.every((result) => result.status === "shared" || result.status === "already-shared"),
      visibility: "unlisted",
      results,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return replayApiError(error);
  }
}
