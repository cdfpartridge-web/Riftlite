import { projectReplayState } from "@/lib/replay-v2/project-state";
import type { CanonicalReplayV2, JsonValue, ReplayPlayerState } from "@/lib/replay-v2/types";

export type ReplayListingFormat = "bo1" | "bo3" | "unknown";
export type ReplayListingResult = "win" | "loss" | "draw" | "unknown";

export type ReplayListingMetadata = {
  version: 1;
  playerName: string;
  opponentName: string;
  playerLegend: string;
  opponentLegend: string;
  format: ReplayListingFormat;
  result: ReplayListingResult;
};

export function summarizeReplayForListing(replay: CanonicalReplayV2): ReplayListingMetadata {
  const ordered = orderReplayParticipants(replay);
  const playerIds = ordered.map((participant) => participant?.id ?? "");
  const finalState = replay.checkpoints.at(-1)?.state ?? projectReplayState(replay);
  return {
    version: 1,
    playerName: safeLabel(ordered[0]?.name, "Player 1"),
    opponentName: safeLabel(ordered[1]?.name, "Player 2"),
    playerLegend: replayLegendName(finalState.players[playerIds[0]], "Unknown legend"),
    opponentLegend: replayLegendName(finalState.players[playerIds[1]], "Unknown legend"),
    format: replay.series.format === "bo3" ? "bo3" : replay.series.format === "bo1" ? "bo1" : "unknown",
    result: replayResult(replay, playerIds),
  };
}

export function orderReplayParticipants(replay: CanonicalReplayV2) {
  const participants = [...replay.series.participants];
  const perspectiveId = replay.series.perspectivePlayerId ?? "";
  participants.sort((left, right) => {
    if (left.id === perspectiveId) return -1;
    if (right.id === perspectiveId) return 1;
    return String(left.seat ?? left.id).localeCompare(String(right.seat ?? right.id));
  });
  return [participants[0], participants[1]] as const;
}

export function replayLegendName(player: ReplayPlayerState | undefined, fallback: string): string {
  if (!player) return fallback;
  const zoneCard = Object.entries(player.zones).find(([zone]) => normalizeKey(zone).includes("legend"))?.[1]?.[0]
    ?? Object.values(player.zones).flat().find((card) => normalizeKey(card.source ?? "") === "legend");
  const value = zoneCard?.name
    || jsonName(player.fields.legend)
    || jsonName(player.fields.legendCard)
    || jsonName(player.boardFields.legend)
    || jsonName(player.boardFields.legendCard);
  return shortLegend(value || fallback);
}

function replayResult(replay: CanonicalReplayV2, playerIds: string[]): ReplayListingResult {
  const [playerId, opponentId] = playerIds;
  if (!playerId || !opponentId) return "unknown";
  const seriesResult = replay.series.result;
  if (seriesResult) {
    if (seriesResult.outcome === "draw") return "draw";
    if (seriesResult.winnerPlayerId === playerId) return "win";
    if (seriesResult.winnerPlayerId === opponentId) return "loss";
  }
  const wins = new Map([[playerId, 0], [opponentId, 0]]);
  for (const game of replay.series.games) {
    const winner = game.result?.winnerPlayerId;
    if (winner && wins.has(winner)) wins.set(winner, (wins.get(winner) ?? 0) + 1);
  }
  const playerWins = wins.get(playerId) ?? 0;
  const opponentWins = wins.get(opponentId) ?? 0;
  if (playerWins > opponentWins) return "win";
  if (opponentWins > playerWins) return "loss";
  if (playerWins > 0) return "draw";

  const scores = replay.series.games.at(-1)?.result?.finalScores;
  const playerScore = scores?.[playerId];
  const opponentScore = scores?.[opponentId];
  if (Number.isFinite(playerScore) && Number.isFinite(opponentScore)) {
    if (playerScore! > opponentScore!) return "win";
    if (opponentScore! > playerScore!) return "loss";
    return "draw";
  }
  return "unknown";
}

function jsonName(value: JsonValue | undefined): string {
  if (typeof value === "string") return value.trim();
  if (!value || Array.isArray(value) || typeof value !== "object") return "";
  for (const key of ["name", "cardName", "title"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function shortLegend(value: string): string {
  return value.split(",", 1)[0]?.trim() || value.trim();
}

function safeLabel(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text.slice(0, 80) || fallback;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
