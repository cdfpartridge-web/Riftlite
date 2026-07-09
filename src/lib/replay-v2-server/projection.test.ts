import { describe, expect, it } from "vitest";

import type { CanonicalReplayV2 } from "@/lib/replay-v2";
import type { ReplayRecord } from "@/lib/replay-v2-server/model";
import { projectReplaySummaryRecord, sanitizeCanonicalReplay } from "@/lib/replay-v2-server/projection";

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
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ReplayRecord;

    const projected = projectReplaySummaryRecord(record, false);

    expect(projected).not.toHaveProperty("captureId");
    expect(projected).not.toHaveProperty("roomCode");
  });
});
