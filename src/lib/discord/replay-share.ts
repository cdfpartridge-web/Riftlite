import { canonicalChoice } from "@/lib/canonical";
import { LEGEND_ALIASES, LEGENDS } from "@/lib/constants";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";
import { orderReplayParticipants, summarizeReplayForListing } from "@/lib/replay-v2/replay-listing";

export type DiscordActiveDeckInput = {
  title?: string;
  legend: string;
  sourceUrl: string;
};

export type DiscordDeckLink = {
  title: string;
  url: string;
};

export type DiscordReplaySummary = {
  players: [string, string];
  legends: [string, string];
  format: string;
  score: string;
  activeDeck?: DiscordDeckLink;
};

const PILTOVER_DECK_PATH_RE = /^\/decks\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

export function discordReplayReportChannelId(config: { reportsChannelId?: unknown }): string {
  return typeof config.reportsChannelId === "string" ? config.reportsChannelId.trim() : "";
}

export function summarizeReplayForDiscord(
  replay: CanonicalReplayV2,
  activeDeck?: DiscordActiveDeckInput,
): DiscordReplaySummary {
  const listing = summarizeReplayForListing(replay);
  const playerIds = orderReplayParticipants(replay).map((participant) => participant?.id ?? "");
  const deckLink = discordDeckLinkForLegend(listing.playerLegend, activeDeck);
  return {
    players: [listing.playerName, listing.opponentName],
    legends: [listing.playerLegend, listing.opponentLegend],
    format: replay.series.format === "bo3" ? "BO3" : replay.series.format === "bo1" ? "BO1" : "Match",
    score: replayScore(replay, playerIds),
    ...(deckLink ? { activeDeck: deckLink } : {}),
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
    ...(summary.activeDeck ? [`Active deck: ${formatDiscordDeckLink(summary.activeDeck)}`] : []),
    `Watch the unlisted replay: ${replayUrl}`,
  ].join("\n");
}

export function discordDeckLinkForLegend(
  playerLegend: unknown,
  activeDeck: DiscordActiveDeckInput | undefined,
): DiscordDeckLink | null {
  if (!activeDeck) return null;
  const capturedLegend = canonicalDiscordLegend(playerLegend);
  const deckLegend = canonicalDiscordLegend(activeDeck.legend);
  const url = verifiedPiltoverDeckUrl(activeDeck.sourceUrl);
  if (!capturedLegend || !deckLegend || capturedLegend !== deckLegend || !url) return null;
  return {
    title: String(activeDeck.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "Piltover Archive deck",
    url,
  };
}

export function discordDeckLegendFromSnapshot(value: unknown): string {
  let snapshot: Record<string, unknown> | null = null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      snapshot = recordValue(parsed);
    } catch {
      return "";
    }
  } else {
    snapshot = recordValue(value);
  }
  if (!snapshot) return "";
  for (const candidate of [snapshot.legend, snapshot.legend_key, snapshot.legendKey]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const candidate of [snapshot.legend_entry, snapshot.legendEntry]) {
    const entry = recordValue(candidate);
    if (typeof entry?.name === "string" && entry.name.trim()) return entry.name.trim();
  }
  return "";
}

export function verifiedPiltoverDeckUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > 500) return "";
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !["piltoverarchive.com", "www.piltoverarchive.com"].includes(url.hostname.toLowerCase())
    ) {
      return "";
    }
    const match = PILTOVER_DECK_PATH_RE.exec(url.pathname);
    return match?.[1]
      ? `https://piltoverarchive.com/decks/view/${match[1].toLowerCase()}`
      : "";
  } catch {
    return "";
  }
}

export function formatDiscordDeckLink(deck: DiscordDeckLink): string {
  return `[${discordText(deck.title)}](${deck.url})`;
}

export function formatDiscordDeckTitle(title: string): string {
  return discordText(title);
}

function replayScore(replay: CanonicalReplayV2, playerIds: string[]): string {
  const seriesResult = replay.series.result;
  // A BO1 report is a game result, not the in-game Riftbound point total.
  // Older TCGA canonicals stored those board points in series.finalScores, so
  // prefer the authoritative winner/outcome before consulting that legacy
  // field. Player order is perspective-first throughout Discord reporting.
  if (replay.series.format === "bo1") {
    if (seriesResult?.winnerPlayerId === playerIds[0]) return "1-0";
    if (seriesResult?.winnerPlayerId === playerIds[1]) return "0-1";
    if (seriesResult?.loserPlayerId === playerIds[0]) return "0-1";
    if (seriesResult?.loserPlayerId === playerIds[1]) return "1-0";
    if (seriesResult?.outcome === "win") return "1-0";
    if (seriesResult?.outcome === "loss") return "0-1";
    if (seriesResult?.outcome === "draw") return "0-0";

    const finalResult = replay.series.games.at(-1)?.result;
    if (finalResult?.winnerPlayerId === playerIds[0]) return "1-0";
    if (finalResult?.winnerPlayerId === playerIds[1]) return "0-1";
    if (finalResult?.loserPlayerId === playerIds[0]) return "0-1";
    if (finalResult?.loserPlayerId === playerIds[1]) return "1-0";
    return "Pending";
  }
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
  return "Pending";
}

function discordText(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, "\\$1").replace(/@/g, "＠").slice(0, 200);
}

function canonicalDiscordLegend(value: unknown): string {
  return canonicalChoice(String(value ?? ""), LEGENDS, LEGEND_ALIASES);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
