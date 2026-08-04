import { createHash } from "node:crypto";

import { LEGENDS } from "@/lib/constants";
import type {
  CommunityMatch,
  CommunityOverview,
  DeckGroup,
  DeckSnapshot,
  LegendMetaRow,
  MatchGame,
  MatchupCaptureBreakdown,
  MatchupCell,
  MatrixView,
} from "@/lib/types";

export const MATRIX_AGGREGATION_METHOD = "symmetric-v1" as const;

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

type MutableMatchupBucket = {
  wins: number;
  draws: number;
  total: number;
  losses: number;
};

function emptyMatchupBreakdown(): MatchupCaptureBreakdown {
  return {
    wins: 0,
    losses: 0,
    draws: 0,
    decisiveGames: 0,
    totalGames: 0,
    winRate: 0,
  };
}

function matchupBreakdown(
  bucket?: MutableMatchupBucket | MatchupCell,
): MatchupCaptureBreakdown {
  const wins = bucket?.wins ?? 0;
  const losses = bucket?.losses ?? 0;
  const draws = bucket?.draws ?? 0;
  const decisiveGames = wins + losses;
  const totalGames = "total" in (bucket ?? {})
    ? (bucket as MutableMatchupBucket).total
    : ((bucket as MatchupCell | undefined)?.totalGames ?? wins + losses + draws);
  return {
    wins,
    losses,
    draws,
    decisiveGames,
    totalGames,
    winRate: winRate(wins, decisiveGames),
  };
}

function matrixCellKey(myLegend: string, oppLegend: string): string {
  return `${myLegend}:::${oppLegend}`;
}

function sortLegendsByParticipation(
  legends: Iterable<string>,
  directional: ReadonlyMap<string, MatchupCaptureBreakdown>,
): string[] {
  const totals = new Map(Array.from(legends, (legend) => [legend, 0]));
  for (const [key, bucket] of directional) {
    if (!bucket.totalGames) continue;
    const [myLegend, oppLegend] = key.split(":::");
    totals.set(myLegend, (totals.get(myLegend) ?? 0) + bucket.totalGames);
    totals.set(oppLegend, (totals.get(oppLegend) ?? 0) + bucket.totalGames);
  }
  return [...totals.keys()].sort(
    (left, right) =>
      (totals.get(right) ?? 0) - (totals.get(left) ?? 0) ||
      left.localeCompare(right),
  );
}

/**
 * Losslessly upgrades a directional matrix into the pooled display contract.
 *
 * The reverse cohort stays in its native perspective in `reverseCaptures`,
 * while its losses become the row legend's wins (and vice versa) in the
 * top-level pooled result. This lets callers disclose the sampling split
 * without presenting two contradictory matchup percentages.
 */
export function ensureSymmetricMatrix(
  matrix: Omit<MatrixView, "aggregationMethod" | "matrixReadyMatchCount"> &
    Partial<
      Pick<MatrixView, "aggregationMethod" | "matrixReadyMatchCount">
    >,
): MatrixView {
  if (
    matrix.aggregationMethod === MATRIX_AGGREGATION_METHOD &&
    typeof matrix.matrixReadyMatchCount === "number"
  ) {
    return matrix as MatrixView;
  }

  const directional = new Map<string, MatchupCaptureBreakdown>();
  const legends = new Set([...matrix.rows, ...matrix.columns]);
  let matrixReadyMatchCount = 0;
  for (const cell of matrix.cells) {
    legends.add(cell.myLegend);
    legends.add(cell.oppLegend);
    const breakdown = matchupBreakdown(cell);
    directional.set(matrixCellKey(cell.myLegend, cell.oppLegend), breakdown);
    matrixReadyMatchCount += breakdown.totalGames;
  }

  const orderedLegends = sortLegendsByParticipation(legends, directional);
  const cells: MatchupCell[] = [];
  for (const myLegend of orderedLegends) {
    for (const oppLegend of orderedLegends) {
      const directCaptures =
        directional.get(matrixCellKey(myLegend, oppLegend)) ??
        emptyMatchupBreakdown();
      // A mirror matchup has only one distinguishable capture direction.
      // Reusing it as the reverse cohort would double every diagonal sample.
      const reverseCaptures =
        myLegend === oppLegend
          ? emptyMatchupBreakdown()
          : (directional.get(matrixCellKey(oppLegend, myLegend)) ??
            emptyMatchupBreakdown());
      const wins = directCaptures.wins + reverseCaptures.losses;
      const losses = directCaptures.losses + reverseCaptures.wins;
      const draws = directCaptures.draws + reverseCaptures.draws;
      const decisiveGames = wins + losses;
      cells.push({
        myLegend,
        oppLegend,
        wins,
        losses,
        draws,
        decisiveGames,
        totalGames: directCaptures.totalGames + reverseCaptures.totalGames,
        winRate: winRate(wins, decisiveGames),
        directCaptures,
        reverseCaptures,
      });
    }
  }

  return {
    ...matrix,
    rows: orderedLegends,
    columns: orderedLegends,
    cells,
    aggregationMethod: MATRIX_AGGREGATION_METHOD,
    matrixReadyMatchCount,
  };
}

function uniqueMatrixMatches(matches: CommunityMatch[]): CommunityMatch[] {
  const active = matches.filter(
    (match) =>
      match.id &&
      !match.superseded &&
      !match.mergedIntoMatchId &&
      LEGENDS.includes(match.myChampion as (typeof LEGENDS)[number]) &&
      LEGENDS.includes(match.oppChampion as (typeof LEGENDS)[number]),
  );
  const combinedSourceIds = new Set(
    active.flatMap((match) => match.combinedFromMatchIds ?? []),
  );
  const seen = new Set<string>();
  return active.filter((match) => {
    if (
      (match.localMatchId && combinedSourceIds.has(match.localMatchId)) ||
      seen.has(match.id)
    ) {
      return false;
    }
    seen.add(match.id);
    return true;
  });
}

export function buildMatrix(matches: CommunityMatch[]): MatrixView {
  const lookup = new Map<
    string,
    MutableMatchupBucket
  >();
  const legends = new Set<string>();
  let matrixReadyMatchCount = 0;

  for (const match of uniqueMatrixMatches(matches)) {
    const key = matrixCellKey(match.myChampion, match.oppChampion);
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
    legends.add(match.myChampion);
    legends.add(match.oppChampion);
    matrixReadyMatchCount += 1;
  }

  const directional = new Map(
    Array.from(lookup, ([key, bucket]) => [key, matchupBreakdown(bucket)]),
  );
  const orderedLegends = sortLegendsByParticipation(legends, directional);

  const cells: MatchupCell[] = [];
  for (const myLegend of orderedLegends) {
    for (const oppLegend of orderedLegends) {
      const directCaptures =
        directional.get(matrixCellKey(myLegend, oppLegend)) ??
        emptyMatchupBreakdown();
      const reverseCaptures =
        myLegend === oppLegend
          ? emptyMatchupBreakdown()
          : (directional.get(matrixCellKey(oppLegend, myLegend)) ??
            emptyMatchupBreakdown());
      const wins = directCaptures.wins + reverseCaptures.losses;
      const losses = directCaptures.losses + reverseCaptures.wins;
      const draws = directCaptures.draws + reverseCaptures.draws;
      const decisiveGames = wins + losses;
      cells.push({
        myLegend,
        oppLegend,
        wins,
        losses,
        draws,
        decisiveGames,
        totalGames: directCaptures.totalGames + reverseCaptures.totalGames,
        winRate: winRate(wins, decisiveGames),
        directCaptures,
        reverseCaptures,
      });
    }
  }

  return {
    rows: orderedLegends,
    columns: orderedLegends,
    cells,
    aggregationMethod: MATRIX_AGGREGATION_METHOD,
    matrixReadyMatchCount,
  };
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
    publicLifetimePlayerCount?: number;
    publicPlayerIndexReady?: boolean;
  } = {
    privateMatchCount: 0,
    privatePlayerCount: 0,
  },
): CommunityOverview {
  const meta = buildLegendMeta(matches);
  const decks = buildDeckGroups(matches);
  const players = new Set(matches.map((match) => match.uid || match.username));
  const publicLifetimeMatches = Math.max(
    aggregateCounts.publicLifetimeMatchCount ?? matches.length,
    matches.length,
  );
  const statsWindowPlayers = players.size;
  const publicLifetimePlayers =
    aggregateCounts.publicPlayerIndexReady &&
    aggregateCounts.publicLifetimePlayerCount !== undefined
      ? Math.max(aggregateCounts.publicLifetimePlayerCount, statsWindowPlayers)
      : undefined;
  const publicPlayers = publicLifetimePlayers ?? statsWindowPlayers;

  return {
    // Total counts include private-hub volume (counts only — no deck
    // lists, matchups, or usernames from private hubs leak). Derived
    // views (legend meta, deck groups) stay strictly public-only so
    // matchup %, deck stats, etc. remain private.
    totalMatches: publicLifetimeMatches + aggregateCounts.privateMatchCount,
    publicLifetimeMatches,
    statsWindowMatches: matches.length,
    privateMatches: aggregateCounts.privateMatchCount,
    totalPlayers: publicPlayers + aggregateCounts.privatePlayerCount,
    publicLifetimePlayers,
    statsWindowPlayers,
    privatePlayers: aggregateCounts.privatePlayerCount,
    playerCountMode: publicLifetimePlayers === undefined ? "recent" : "lifetime",
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
