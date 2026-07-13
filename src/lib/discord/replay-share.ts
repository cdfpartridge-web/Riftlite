import type { CanonicalReplayV2 } from "@/lib/replay-v2";
import { orderReplayParticipants, summarizeReplayForListing } from "@/lib/replay-v2/replay-listing";

export type DiscordReplaySummary = {
  players: [string, string];
  legends: [string, string];
  format: string;
  score: string;
};

export function discordReplayReportChannelId(config: { reportsChannelId?: unknown }): string {
  return typeof config.reportsChannelId === "string" ? config.reportsChannelId.trim() : "";
}

export function summarizeReplayForDiscord(replay: CanonicalReplayV2): DiscordReplaySummary {
  const listing = summarizeReplayForListing(replay);
  const playerIds = orderReplayParticipants(replay).map((participant) => participant?.id ?? "");
  return {
    players: [listing.playerName, listing.opponentName],
    legends: [listing.playerLegend, listing.opponentLegend],
    format: replay.series.format === "bo3" ? "BO3" : replay.series.format === "bo1" ? "BO1" : "Match",
    score: replayScore(replay, playerIds),
  };
}

export function isDiscordReplayResultResolved(replay: CanonicalReplayV2): boolean {
  return replayScore(replay, orderReplayParticipants(replay).map((participant) => participant?.id ?? "")) !== "Pending";
}

export function formatDiscordReplayPost(summary: DiscordReplaySummary, replayUrl: string): string {
  const players = summary.players.map(discordText) as [string, string];
  const legends = summary.legends.map(discordText) as [string, string];
  return [
    `**${players[0]} vs ${players[1]}**`,
    `${legends[0]} vs ${legends[1]} • ${summary.format} • Score ${discordText(summary.score)}`,
    `Watch the unlisted replay: ${replayUrl}`,
  ].join("\n");
}

function replayScore(replay: CanonicalReplayV2, playerIds: string[]): string {
  const seriesResult = replay.series.result;
  if (seriesResult) {
    const left = seriesResult.finalScores[playerIds[0]];
    const right = seriesResult.finalScores[playerIds[1]];
    if (Number.isFinite(left) && Number.isFinite(right)) return `${left}-${right}`;
    if (seriesResult.outcome === "draw") return "Draw";
  }
  if (replay.series.format === "bo3") {
    const wins = new Map(playerIds.map((playerId) => [playerId, 0]));
    for (const game of replay.series.games) {
      const winner = game.result?.winnerPlayerId;
      if (winner && wins.has(winner)) wins.set(winner, (wins.get(winner) ?? 0) + 1);
    }
    if ([...wins.values()].some((value) => value >= 2)) {
      return `${wins.get(playerIds[0]) ?? 0}-${wins.get(playerIds[1]) ?? 0}`;
    }
    return "Pending";
  }
  const finalResult = replay.series.games.at(-1)?.result;
  if (replay.series.format === "bo1" && finalResult?.winnerPlayerId) {
    if (finalResult.winnerPlayerId === playerIds[0]) return "1-0";
    if (finalResult.winnerPlayerId === playerIds[1]) return "0-1";
  }
  return "Pending";
}

function discordText(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, "\\$1").replace(/@/g, "＠").slice(0, 200);
}
