import { describe, expect, it } from "vitest";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";
import { ReviewedReplayResultSchema, replayWithReviewedDiscordResult } from "./replay-reviewed-result";

const reviewed = { captureSessionId: "capture-1", match: { format: "bo1" as const, result: "win" as const,
  score: { perspective: 1, opponent: 0 }, games: [{ gameNumber: 1, result: "win" as const }] } };
function replay(): CanonicalReplayV2 {
  return { series: { perspectivePlayerId: "self", format: "bo3", participants: [{ id: "other" }, { id: "self" }],
    games: [{ id: "game-1", gameNumber: 1, result: { winnerPlayerId: "other" } }] }, events: [] } as unknown as CanonicalReplayV2;
}
describe("owner-reviewed Discord result", () => {
  it("replaces a provisional outcome using the canonical perspective, without modifying the original replay", () => {
    const original = replay();
    const updated = replayWithReviewedDiscordResult(original, { capture: { captureSessionId: "capture-1" } }, reviewed);
    expect(updated.series.result).toMatchObject({ winnerPlayerId: "self", loserPlayerId: "other", finalScores: { self: 1, other: 0 } });
    expect(updated.series.games[0].result?.winnerPlayerId).toBe("self");
    expect(original.series.games[0].result?.winnerPlayerId).toBe("other");
    expect(original.series.result).toBeUndefined();
    expect(updated.events).toBe(original.events);
  });
  it("rejects another capture's result", () => {
    expect(() => replayWithReviewedDiscordResult(replay(), { capture: { captureSessionId: "other" } }, reviewed)).toThrow("matched");
  });
  it.each(["", "not-a-participant"])("rejects missing or foreign perspective %s", (perspective) => {
    const input = replay(); input.series.perspectivePlayerId = perspective;
    expect(() => replayWithReviewedDiscordResult(input, { capture: { captureSessionId: "capture-1" } }, reviewed)).toThrow("perspective");
  });
  it("rejects a result for a game absent from this capture", () => {
    const input = replay(); input.series.games[0].gameNumber = 2;
    expect(() => replayWithReviewedDiscordResult(input, { capture: { captureSessionId: "capture-1" } }, reviewed)).toThrow("captured games");
  });
  it("rejects incomplete, contradictory and duplicate result data before accessing any artifact", () => {
    expect(ReviewedReplayResultSchema.safeParse({ ...reviewed, match: { ...reviewed.match, result: "incomplete" } }).success).toBe(false);
    expect(ReviewedReplayResultSchema.safeParse({ ...reviewed, match: { ...reviewed.match, score: { perspective: 0, opponent: 1 } } }).success).toBe(false);
    expect(ReviewedReplayResultSchema.safeParse({ ...reviewed, match: { ...reviewed.match, games: [reviewed.match.games[0], reviewed.match.games[0]] } }).success).toBe(false);
  });
});
