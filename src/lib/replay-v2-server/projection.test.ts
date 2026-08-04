import { describe, expect, it } from "vitest";

import type { CanonicalReplayV2 } from "@/lib/replay-v2";
import type { ReplayRecord, ReplaySummary } from "@/lib/replay-v2-server/model";
import {
  projectReplaySummaryRecord,
  sanitizeCanonicalReplay,
  sortReplaySummariesByCapturedAt,
} from "@/lib/replay-v2-server/projection";

describe("replay public projections", () => {
  it("removes room-code fields throughout canonical playback data without mutating input", () => {
    const replay = {
      schema: "riftlite-canonical-replay",
      version: 2,
      id: "rl2_test",
      source: { captureSessionId: "capture-room-sensitive", roomCode: "ABCDE" },
      series: {
        roomCode: "ABCDE",
        games: [{ sourceIdentity: { gameInstanceIds: ["ABCDE"] } }],
      },
      events: [{
        action: { room_code: "ABCDE", gameInstanceId: "ABCDE", safe: "kept" },
        entry: { id: "log-abcde-1", text: "kept" },
      }],
    } as unknown as CanonicalReplayV2;

    const projected = sanitizeCanonicalReplay(replay);

    expect(projected.source.roomCode).toBe("");
    expect(projected.source.captureSessionId).toBe("");
    expect(projected.series.roomCode).toBe("");
    expect(projected.series.games[0].sourceIdentity.gameInstanceIds).toEqual([]);
    expect(projected.events[0]).toEqual({
      action: { safe: "kept" },
      entry: { id: "log-[private-2]-1", text: "kept" },
    });
    expect(JSON.stringify(projected)).not.toContain("capture-room-sensitive");
    expect(JSON.stringify(projected)).not.toContain("ABCDE");
    expect(JSON.stringify(projected)).not.toContain("abcde");
    expect(replay.source.roomCode).toBe("ABCDE");
  });

  it("omits owner-only capture and room identity from public list summaries", () => {
    const record = {
      replayId: "rl2_test",
      captureId: "capture-private",
      roomCode: "ABCDE",
      visibility: "public",
      status: "ready",
      title: "Replay",
      platform: "atlas",
      messageCount: 12,
      listing: {
        version: 1,
        playerName: "Player one",
        opponentName: "Player two",
        playerLegend: "Akali",
        opponentLegend: "Fiora",
        format: "bo1",
        result: "win",
      },
      capturedAt: new Date("2026-07-09T18:00:12.000Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
      warnings: [{
        code: "replay_capture_missing_mulligan",
        message: "The replay did not capture the opening mulligan.",
      }],
    } as ReplayRecord;

    const projected = projectReplaySummaryRecord(record, false);

    expect(projected).not.toHaveProperty("captureId");
    expect(projected).not.toHaveProperty("roomCode");
    expect(projected.capturedAt).toEqual(record.capturedAt);
    expect(projected.listing).toEqual(record.listing);
    expect(projected.warnings).toEqual(record.warnings);
  });

  it("preserves perspective-mapped game results while removing transport identity", () => {
    const replay = {
      schema: "riftlite-canonical-replay",
      version: 2,
      id: "rl2_result_test",
      source: { captureSessionId: "capture-private", roomCode: "ROOM1" },
      series: {
        roomCode: "ROOM1",
        games: [{
          sourceIdentity: {
            gameInstanceIds: ["ROOM1"],
            resultEventId: "result_safe_hash",
          },
          result: {
            resultEventId: "result_safe_hash",
            winnerPlayerId: "player-opponent",
            loserPlayerId: "player-local",
            finalScores: { "player-local": 4, "player-opponent": 5 },
          },
        }],
      },
      events: [],
    } as unknown as CanonicalReplayV2;

    const projected = sanitizeCanonicalReplay(replay);

    expect(projected.series.games[0].sourceIdentity).toEqual({
      gameInstanceIds: [],
      resultEventId: "result_safe_hash",
    });
    expect(projected.series.games[0].result).toEqual({
      resultEventId: "result_safe_hash",
      winnerPlayerId: "player-opponent",
      loserPlayerId: "player-local",
      finalScores: { "player-local": 4, "player-opponent": 5 },
    });
  });

  it("orders summaries by capture time and falls back to creation time", () => {
    const summaries = [
      { replayId: "old-capture-new-upload", capturedAt: "2026-07-07T12:00:00.000Z", createdAt: "2026-07-10T15:40:06.000Z" },
      { replayId: "legacy", createdAt: "2026-07-08T12:00:00.000Z" },
      { replayId: "new-capture-old-upload", capturedAt: "2026-07-09T18:00:00.000Z", createdAt: "2026-07-10T15:39:52.000Z" },
    ] as ReplaySummary[];

    expect(sortReplaySummariesByCapturedAt(summaries).map((summary) => summary.replayId)).toEqual([
      "new-capture-old-upload",
      "legacy",
      "old-capture-new-upload",
    ]);
    expect(summaries.map((summary) => summary.replayId)).toEqual([
      "old-capture-new-upload",
      "legacy",
      "new-capture-old-upload",
    ]);
  });
});
