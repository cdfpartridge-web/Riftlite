import { createHash } from "node:crypto";

import { LEGENDS } from "@/lib/constants";
import type {
  CommunityMatch,
  CommunityOverview,
  DeckGroup,
  DeckSnapshot,
  LegendMetaRow,
  MatchGame,
  MatchupCell,
  MatrixView,
} from "@/lib/types";

function winRate(wins: number, decisiveGames: number) {
  return decisiveGames ? Number(((wins / decisiveGames) * 100).toFixed(1)) : 0;
}

export function wilsonScore(wins: number, decisiveGames: number, z = 1.96) {
  if (!decisiveGames) {
    return 0;
  }

  const p = wins / decisiveGames;
  const n = decisiveGames;
  return (
    (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) /
    (1 + (z * z) / n)
  );
}

function normalizeSnapshot(snapshot: DeckSnapshot | null) {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    champion: snapshot.champion ?? [],
    runes: snapshot.runes ?? [],
    battlefields: snapshot.battlefields ?? [],
    mainDeck: snapshot.mainDeck ?? [],
    sideboard: snapshot.sideboard ?? [],
  };
}

export function deckGroupKey(match: CommunityMatch) {
  if (match.deckSourceKey) {
    return `source:${match.deckSourceKey}`;
  }

  if (match.deckSnapshot) {
    return `snapshot:${createHash("sha1")
      .update(JSON.stringify(match.deckSnapshot))
      .digest("hex")}`;
  }

  return "";
}

export function buildLegendMeta(matches: CommunityMatch[]): LegendMetaRow[] {
  const stats = new Map<
    string,
    { wins: number; losses: number; draws: number; games: number }
  >();

  for (const match of matches) {
    if (!LEGENDS.includes(match.myChampion as (typeof LEGENDS)[number])) {
      continue;
    }

    const bucket = stats.get(match.myChampion) ?? {
      wins: 0,
      losses: 0,
      draws: 0,
      games: 0,
    };
    bucket.games += 1;
    if (match.result === "Win") {
      bucket.wins += 1;
    } else if (match.result === "Draw") {
      bucket.draws += 1;
    } else {
      bucket.losses += 1;
    }
    stats.set(match.myChampion, bucket);
  }

  return Array.from(stats.entries())
    .map(([legend, bucket]) => ({
      legend,
      games: bucket.games,
      wins: bucket.wins,
      losses: bucket.losses,
      draws: bucket.draws,
      winRate: winRate(bucket.wins, bucket.wins + bucket.losses),
    }))
    .sort((left, right) => right.games - left.games);
}

export function buildMatrix(matches: CommunityMatch[]): MatrixView {
  const lookup = new Map<
    string,
    { wins: number; draws: number; total: number; losses: number }
  >();
  const myTotals = new Map<string, number>();
  const oppTotals = new Map<string, number>();

  for (const match of matches) {
    if (
      !LEGENDS.includes(match.myChampion as (typeof LEGENDS)[number]) ||
      !LEGENDS.includes(match.oppChampion as (typeof LEGENDS)[number])
    ) {
      continue;
    }

    const key = `${match.myChampion}:::${match.oppChampion}`;
    const bucket = lookup.get(key) ?? {
      wins: 0,
      losses: 0,
      draws: 0,
      total: 0,
    };

    bucket.total += 1;
    if (match.result === "Win") {
      bucket.wins += 1;
    } else if (match.result === "Draw") {
      bucket.draws += 1;
    } else {
      bucket.losses += 1;
    }

    lookup.set(key, bucket);
    myTotals.set(match.myChampion, (myTotals.get(match.myChampion) ?? 0) + 1);
    oppTotals.set(match.oppChampion, (oppTotals.get(match.oppChampion) ?? 0) + 1);
  }

  const rows = Array.from(myTotals.keys()).sort(
    (a, b) => (myTotals.get(b) ?? 0) - (myTotals.get(a) ?? 0),
  );
  const columns = Array.from(oppTotals.keys()).sort(
    (a, b) => (oppTotals.get(b) ?? 0) - (oppTotals.get(a) ?? 0),
  );

  const cells: MatchupCell[] = [];
  for (const myLegend of rows) {
    for (const oppLegend of columns) {
      const bucket = lookup.get(`${myLegend}:::${oppLegend}`);
      const wins = bucket?.wins ?? 0;
      const losses = bucket?.losses ?? 0;
      const decisiveGames = wins + losses;
      cells.push({
        myLegend,
        oppLegend,
        wins,
        losses,
        draws: bucket?.draws ?? 0,
        decisiveGames,
        totalGames: bucket?.total ?? 0,
        winRate: winRate(wins, decisiveGames),
      });
    }
  }

  return { rows, columns, cells };
}

export function buildDeckGroups(matches: CommunityMatch[]): DeckGroup[] {
  const groups = new Map<
    string,
    {
      title: string;
      legend: string;
      games: number;
      wins: number;
      losses: number;
      draws: number;
      sourceUrl: string;
      sourceKey: string;
      snapshot: DeckSnapshot | null;
      representativeMatchId: string;
      createdAt: number;
    }
  >();

  for (const match of matches) {
    const key = deckGroupKey(match);
    if (!key) {
      continue;
    }

    const bucket = groups.get(key) ?? {
      title: match.deckName || match.deckSnapshot?.title || "Unnamed Deck",
      legend: match.deckSnapshot?.legend || match.myChampion || "Unknown",
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      sourceUrl: match.deckSourceUrl,
      sourceKey: match.deckSourceKey,
      snapshot: normalizeSnapshot(match.deckSnapshot),
      representativeMatchId: match.id,
      createdAt: match.createdAt,
    };

    bucket.games += 1;
    if (match.result === "Win") {
      bucket.wins += 1;
    } else if (match.result === "Draw") {
      bucket.draws += 1;
    } else {
      bucket.losses += 1;
    }

    if (match.createdAt >= bucket.createdAt) {
      bucket.createdAt = match.createdAt;
      bucket.representativeMatchId = match.id;
      bucket.snapshot = normalizeSnapshot(match.deckSnapshot);
    }

    groups.set(key, bucket);
  }

  return Array.from(groups.entries())
    .map(([deckKey, bucket]) => {
      const decisiveGames = bucket.wins + bucket.losses;
      return {
        deckKey,
        title: bucket.title,
        legend: bucket.legend,
        games: bucket.games,
        wins: bucket.wins,
        losses: bucket.losses,
        draws: bucket.draws,
        winRate: winRate(bucket.wins, decisiveGames),
        sourceUrl: bucket.sourceUrl,
        sourceKey: bucket.sourceKey,
        snapshot: normalizeSnapshot(bucket.snapshot),
        representativeMatchId: bucket.representativeMatchId,
      };
    })
    .sort((left, right) => {
      if (right.games !== left.games) {
        return right.games - left.games;
      }
      return left.title.localeCompare(right.title);
    });
}

export function buildOverview(
  matches: CommunityMatch[],
  aggregateCounts: {
    privateMatchCount: number;
    privatePlayerCount: number;
    publicLifetimeMatchCount?: number;
  } = {
    privateMatchCount: 0,
    privatePlayerCount: 0,
  },
): CommunityOverview {
  const meta = buildLegendMeta(matches);
  const decks = buildDeckGroups(matches);
  const players = new Set(matches.map((match) => match.username));
  const publicLifetimeMatches = Math.max(
    aggregateCounts.publicLifetimeMatchCount ?? matches.length,
    matches.length,
  );

  return {
    // Total counts include private-hub volume (counts only — no deck
    // lists, matchups, or usernames from private hubs leak). Derived
    // views (legend meta, deck groups) stay strictly public-only so
    // matchup %, deck stats, etc. remain private.
    totalMatches: publicLifetimeMatches + aggregateCounts.privateMatchCount,
    publicLifetimeMatches,
    statsWindowMatches: matches.length,
    privateMatches: aggregateCounts.privateMatchCount,
    totalPlayers: players.size + aggregateCounts.privatePlayerCount,
    totalDecks: decks.length,
    trackedLegends: meta.length,
    topLegend: meta[0] ?? null,
    topDeck: decks[0] ?? null,
    featuredDecks: decks.slice(0, 3),
  };
}

export function getDeckGroupByKey(matches: CommunityMatch[], deckKey: string) {
  return buildDeckGroups(matches).find((deck) => deck.deckKey === deckKey) ?? null;
}

export function getMatchupMatches(
  matches: CommunityMatch[],
  myLegend: string,
  oppLegend: string,
) {
  return matches.filter(
    (match) =>
      match.myChampion === myLegend && match.oppChampion === oppLegend,
  );
}

export function summarizeGames(games: MatchGame[]) {
  return games.reduce(
    (acc, game) => {
      acc.myPoints += game.myPoints;
      acc.oppPoints += game.oppPoints;
      return acc;
    },
    { myPoints: 0, oppPoints: 0 },
  );
}
