import { z } from "zod";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";

const Outcome = z.enum(["win", "loss", "draw"]);
export const ReviewedReplayResultSchema = z.object({
  captureSessionId: z.string().trim().min(1).max(240),
  match: z.object({
    format: z.enum(["bo1", "bo3"]),
    result: Outcome,
    score: z.object({ perspective: z.number().int().min(0).max(2), opponent: z.number().int().min(0).max(2) }).strict(),
    games: z.array(z.object({
      gameNumber: z.number().int().min(1).max(3),
      result: z.enum(["win", "loss", "draw", "incomplete"]),
      perspectivePoints: z.number().int().min(0).max(99).optional(),
      opponentPoints: z.number().int().min(0).max(99).optional(),
    }).strict()).min(1).max(3),
  }).strict(),
}).strict().superRefine(({ match }, context) => {
  const { perspective, opponent } = match.score;
  const consistent = match.result === "win" ? perspective > opponent : match.result === "loss" ? opponent > perspective : perspective === opponent;
  if (!consistent || (match.format === "bo1" && (Math.max(perspective, opponent) > 1 || match.games.length !== 1)) ||
    new Set(match.games.map((game) => game.gameNumber)).size !== match.games.length) {
    context.addIssue({ code: "custom", message: "Reviewed match result is inconsistent." });
  }
});

/** Apply only the owner's reviewed result to the Discord report. The board,
 * identities and private source remain immutable. Identity comes from the
 * owned raw artifact and canonical perspective, never from caller-supplied names. */
export function replayWithReviewedDiscordResult(
  replay: CanonicalReplayV2,
  raw: unknown,
  reviewed: z.infer<typeof ReviewedReplayResultSchema>,
): CanonicalReplayV2 {
  const source = raw as { capture?: { captureSessionId?: unknown } } | null;
  const self = replay.series.perspectivePlayerId;
  const participants = replay.series.participants;
  const opponent = participants.find((player) => player.id !== self)?.id;
  if (!source?.capture || source.capture.captureSessionId !== reviewed.captureSessionId ||
    !self || !opponent || participants.length !== 2 || !participants.some((player) => player.id === self)) {
    throw new Error("The reviewed result could not be matched to this replay's capture and player perspective.");
  }
  const { match } = reviewed;
  if ((match.format === "bo1" && replay.series.games.length !== 1) ||
    match.games.some((game) => replay.series.games.filter((candidate) => candidate.gameNumber === game.gameNumber).length !== 1)) {
    throw new Error("The reviewed result does not match the captured games.");
  }
  const winner = (result: string) => result === "win" ? { winnerPlayerId: self, loserPlayerId: opponent }
    : result === "loss" ? { winnerPlayerId: opponent, loserPlayerId: self } : {};
  return {
    ...replay,
    series: {
      ...replay.series,
      format: match.format,
      bestOf: match.format === "bo1" ? 1 : 3,
      result: {
        resultEventId: `reviewed:${reviewed.captureSessionId}`,
        source: "desktop_match_metadata",
        outcome: match.result,
        ...winner(match.result),
        finalScores: { [self]: match.score.perspective, [opponent]: match.score.opponent },
      },
      games: replay.series.games.map((game) => {
        const reviewedGame = match.games.find((candidate) => candidate.gameNumber === game.gameNumber);
        if (!reviewedGame || reviewedGame.result === "incomplete") return game;
        return { ...game, result: {
          resultEventId: `reviewed:${reviewed.captureSessionId}:${game.gameNumber}`,
          ...winner(reviewedGame.result),
          finalScores: {
            ...(reviewedGame.perspectivePoints === undefined ? {} : { [self]: reviewedGame.perspectivePoints }),
            ...(reviewedGame.opponentPoints === undefined ? {} : { [opponent]: reviewedGame.opponentPoints }),
          },
        } };
      }),
    },
  };
}
