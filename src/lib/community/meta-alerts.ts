import type { CommunityMatch } from "@/lib/types";
import { LEGENDS } from "@/lib/constants";

// Ported 1:1 from community_panel.py::build_community_meta_alerts (app build 0.37).
// Keep thresholds and scoring in sync with the Python source.

const META_ALERT_WINDOW = 150;
const META_ALERT_MIN_WINDOW = 40;
const META_ALERT_MAX_CARDS = 4;
const META_ALERT_MIN_USAGE_GAMES = 12;
const META_ALERT_MIN_WINRATE_GAMES = 10;
const META_ALERT_MIN_MATCHUP_GAMES = 8;
const META_ALERT_MIN_USAGE_DELTA = 0.08;
const META_ALERT_MIN_WINRATE_DELTA = 0.12;
const META_ALERT_MIN_MATCHUP_DELTA = 0.18;

const KNOWN_LEGENDS = new Set<string>(LEGENDS);

export type MetaAlertTone = "up" | "down";

export type MetaAlert = {
  title: string;
  summary: string;
  metric: string;
  tone: MetaAlertTone;
  score: number;
  dedupe: string;
};

type WindowStats = { wins: number; losses: number; draws: number; total: number };

function emptyStats(): WindowStats {
  return { wins: 0, losses: 0, draws: 0, total: 0 };
}

function decisiveGames(stats: WindowStats): number {
  return stats.wins + stats.losses;
}

function alertDeltaText(delta: number): string {
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${Math.round(delta * 100)} pts`;
}

function alertPctText(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function legendWindowStats(matches: CommunityMatch[]): Map<string, WindowStats> {
  const stats = new Map<string, WindowStats>();
  for (const match of matches) {
    const champ = (match.myChampion ?? "").trim();
    if (!KNOWN_LEGENDS.has(champ)) continue;
    const entry = stats.get(champ) ?? emptyStats();
    entry.total += 1;
    const result = (match.result ?? "").trim();
    if (result === "Win") entry.wins += 1;
    else if (result === "Loss") entry.losses += 1;
    else if (result === "Draw") entry.draws += 1;
    stats.set(champ, entry);
  }
  return stats;
}

function matchupWindowStats(matches: CommunityMatch[]): Map<string, WindowStats> {
  const stats = new Map<string, WindowStats>();
  for (const match of matches) {
    const my = (match.myChampion ?? "").trim();
    const opp = (match.oppChampion ?? "").trim();
    if (!KNOWN_LEGENDS.has(my) || !KNOWN_LEGENDS.has(opp)) continue;
    const key = `${my}__${opp}`;
    const entry = stats.get(key) ?? emptyStats();
    entry.total += 1;
    const result = (match.result ?? "").trim();
    if (result === "Win") entry.wins += 1;
    else if (result === "Loss") entry.losses += 1;
    else if (result === "Draw") entry.draws += 1;
    stats.set(key, entry);
  }
  return stats;
}

export function buildCommunityMetaAlerts(matches: CommunityMatch[]): MetaAlert[] {
  const ordered = [...matches].sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
  );
  const window = Math.min(META_ALERT_WINDOW, Math.floor(ordered.length / 2));
  if (window < META_ALERT_MIN_WINDOW) return [];

  const recent = ordered.slice(0, window);
  const previous = ordered.slice(window, window * 2);
  if (previous.length < window) return [];

  const recentLegends = legendWindowStats(recent);
  const previousLegends = legendWindowStats(previous);
  const recentMatchups = matchupWindowStats(recent);
  const previousMatchups = matchupWindowStats(previous);

  const candidates: MetaAlert[] = [];

  const legendKeys = new Set<string>([
    ...recentLegends.keys(),
    ...previousLegends.keys(),
  ]);

  for (const champ of [...legendKeys].sort()) {
    const recentStats = recentLegends.get(champ) ?? emptyStats();
    const prevStats = previousLegends.get(champ) ?? emptyStats();
    const recentTotal = recentStats.total;
    const prevTotal = prevStats.total;
    const playDelta = recentTotal / window - prevTotal / window;

    if (
      Math.max(recentTotal, prevTotal) >= META_ALERT_MIN_USAGE_GAMES &&
      Math.abs(playDelta) >= META_ALERT_MIN_USAGE_DELTA
    ) {
      const up = playDelta > 0;
      candidates.push({
        title: `${champ} is ${up ? "rising" : "slipping"} in the meta`,
        summary: `Usage moved from ${alertPctText(prevTotal / window)} to ${alertPctText(
          recentTotal / window,
        )} across the latest community windows.`,
        metric: `Usage ${alertDeltaText(playDelta)}`,
        tone: up ? "up" : "down",
        score: Math.abs(playDelta) * 160 + Math.max(recentTotal, prevTotal) * 0.35,
        dedupe: `legend:${champ}`,
      });
    }

    const recentDecisive = decisiveGames(recentStats);
    const prevDecisive = decisiveGames(prevStats);
    if (
      recentDecisive >= META_ALERT_MIN_WINRATE_GAMES &&
      prevDecisive >= META_ALERT_MIN_WINRATE_GAMES
    ) {
      const recentWr = recentStats.wins / recentDecisive;
      const prevWr = prevStats.wins / prevDecisive;
      const wrDelta = recentWr - prevWr;
      if (Math.abs(wrDelta) >= META_ALERT_MIN_WINRATE_DELTA) {
        const up = wrDelta > 0;
        candidates.push({
          title: `${champ} is ${up ? "converting more often" : "cooling off"}`,
          summary: `Win rate shifted from ${alertPctText(prevWr)} to ${alertPctText(
            recentWr,
          )} in recent community matches.`,
          metric: `Win rate ${alertDeltaText(wrDelta)}`,
          tone: up ? "up" : "down",
          score: Math.abs(wrDelta) * 120 + Math.min(recentDecisive, prevDecisive) * 0.45,
          dedupe: `legend:${champ}`,
        });
      }
    }
  }

  const matchupKeys = new Set<string>([
    ...recentMatchups.keys(),
    ...previousMatchups.keys(),
  ]);

  for (const key of [...matchupKeys].sort()) {
    const recentStats = recentMatchups.get(key) ?? emptyStats();
    const prevStats = previousMatchups.get(key) ?? emptyStats();
    const recentDecisive = decisiveGames(recentStats);
    const prevDecisive = decisiveGames(prevStats);
    if (
      recentDecisive < META_ALERT_MIN_MATCHUP_GAMES ||
      prevDecisive < META_ALERT_MIN_MATCHUP_GAMES
    ) {
      continue;
    }
    const recentWr = recentStats.wins / recentDecisive;
    const prevWr = prevStats.wins / prevDecisive;
    const wrDelta = recentWr - prevWr;
    if (Math.abs(wrDelta) < META_ALERT_MIN_MATCHUP_DELTA) continue;

    const [my, opp] = key.split("__");
    const up = wrDelta > 0;
    candidates.push({
      title: `${my} into ${opp} is ${up ? "trending up" : "sliding"}`,
      summary: `This pairing moved from ${alertPctText(prevWr)} to ${alertPctText(
        recentWr,
      )} win rate in the latest community windows.`,
      metric: `Matchup ${alertDeltaText(wrDelta)}`,
      tone: up ? "up" : "down",
      score: Math.abs(wrDelta) * 140 + Math.min(recentDecisive, prevDecisive) * 0.6,
      dedupe: `matchup:${my}:${opp}`,
    });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.title.localeCompare(b.title);
  });

  const seen = new Set<string>();
  const deduped: MetaAlert[] = [];
  for (const alert of candidates) {
    if (seen.has(alert.dedupe)) continue;
    seen.add(alert.dedupe);
    deduped.push(alert);
    if (deduped.length >= META_ALERT_MAX_CARDS) break;
  }
  return deduped;
}
