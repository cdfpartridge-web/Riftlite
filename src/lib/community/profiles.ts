import { LEGENDS } from "@/lib/constants";
import {
  buildDeckGroups,
  deckGroupKey,
  wilsonScore,
} from "@/lib/community/aggregate";
import type {
  CommunityMatch,
  DeckEntry,
  DeckGroup,
  DeckSnapshot,
} from "@/lib/types";

function winRatePct(wins: number, decisive: number) {
  return decisive === 0 ? 0 : Number(((wins / decisive) * 100).toFixed(1));
}

function tally(matches: CommunityMatch[]) {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const m of matches) {
    if (m.result === "Win") wins += 1;
    else if (m.result === "Loss") losses += 1;
    else if (m.result === "Draw") draws += 1;
  }
  const decisive = wins + losses;
  return {
    games: matches.length,
    wins,
    losses,
    draws,
    decisive,
    winRate: winRatePct(wins, decisive),
  };
}

export type TrendBucket = {
  label: string;
  startMs: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Bucket matches into N most-recent weekly windows ending at "now".
 * Weeks with zero games are still returned so sparklines keep a flat baseline.
 */
export function buildWeeklyTrend(
  matches: CommunityMatch[],
  weeks = 8,
  nowMs: number = Date.now(),
): TrendBucket[] {
  const buckets: TrendBucket[] = Array.from({ length: weeks }, (_, i) => {
    const startMs = nowMs - (weeks - i) * WEEK_MS;
    return {
      label: "",
      startMs,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRate: 0,
    };
  });

  for (const match of matches) {
    const at = match.createdAt ?? 0;
    if (at <= 0) continue;
    const ageWeeks = Math.floor((nowMs - at) / WEEK_MS);
    if (ageWeeks < 0 || ageWeeks >= weeks) continue;
    const b = buckets[weeks - 1 - ageWeeks];
    b.games += 1;
    if (match.result === "Win") b.wins += 1;
    else if (match.result === "Loss") b.losses += 1;
    else if (match.result === "Draw") b.draws += 1;
  }

  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  });
  for (const b of buckets) {
    b.winRate = winRatePct(b.wins, b.wins + b.losses);
    b.label = fmt.format(new Date(b.startMs));
  }
  return buckets;
}

function groupBy<K extends string | number, V>(
  items: V[],
  key: (v: V) => K | null,
): Map<K, V[]> {
  const map = new Map<K, V[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const arr = map.get(k) ?? [];
    arr.push(item);
    map.set(k, arr);
  }
  return map;
}

// ── Player profiles ───────────────────────────────────────────────────────────

export type PlayerLegendRow = {
  legend: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
};

export type PlayerMatchupRow = {
  myLegend: string;
  oppLegend: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
};

export type PlayerProfile = {
  player: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  confidenceScore: number;
  firstSeenMs: number;
  lastSeenMs: number;
  currentStreak: { type: "W" | "L" | "D" | ""; length: number };
  favouriteLegends: PlayerLegendRow[];
  bestMatchups: PlayerMatchupRow[];
  worstMatchups: PlayerMatchupRow[];
  decks: DeckGroup[];
  trend: TrendBucket[];
  recentMatches: CommunityMatch[];
};

function computeStreak(matches: CommunityMatch[]): PlayerProfile["currentStreak"] {
  // matches must be sorted most-recent first.
  if (matches.length === 0) return { type: "", length: 0 };
  const first = matches[0].result;
  let type: PlayerProfile["currentStreak"]["type"] = "";
  if (first === "Win") type = "W";
  else if (first === "Loss") type = "L";
  else if (first === "Draw") type = "D";
  else return { type: "", length: 0 };

  let length = 0;
  for (const m of matches) {
    if (type === "W" && m.result === "Win") length += 1;
    else if (type === "L" && m.result === "Loss") length += 1;
    else if (type === "D" && m.result === "Draw") length += 1;
    else break;
  }
  return { type, length };
}

export function listPlayerNames(matches: CommunityMatch[]): string[] {
  const seen = new Set<string>();
  for (const m of matches) {
    const name = m.username?.trim();
    if (name) seen.add(name);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

export function buildPlayerProfile(
  matches: CommunityMatch[],
  username: string,
  nowMs: number = Date.now(),
): PlayerProfile | null {
  const target = username.trim();
  if (!target) return null;

  const targetLower = target.toLowerCase();
  const owned = matches.filter(
    (m) => (m.username ?? "").trim().toLowerCase() === targetLower,
  );
  if (owned.length === 0) return null;

  const sorted = [...owned].sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
  );
  const totals = tally(sorted);
  const displayName = sorted[0].username || target;

  const legendGroups = groupBy(sorted, (m) => m.myChampion.trim() || null);
  const favouriteLegends: PlayerLegendRow[] = Array.from(legendGroups.entries())
    .map(([legend, rows]) => ({ legend, ...tally(rows) }))
    .map(({ legend, games, wins, losses, draws, winRate }) => ({
      legend,
      games,
      wins,
      losses,
      draws,
      winRate,
    }))
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate)
    .slice(0, 6);

  const matchupGroups = groupBy(sorted, (m) => {
    const my = m.myChampion.trim();
    const opp = m.oppChampion.trim();
    if (!my || !opp) return null;
    return `${my}__${opp}`;
  });
  const matchupRows: PlayerMatchupRow[] = Array.from(matchupGroups.entries())
    .map(([key, rows]) => {
      const [myLegend, oppLegend] = key.split("__");
      const t = tally(rows);
      return {
        myLegend,
        oppLegend,
        games: t.games,
        wins: t.wins,
        losses: t.losses,
        draws: t.draws,
        winRate: t.winRate,
      };
    })
    .filter((row) => row.games >= 3);

  const bestMatchups = [...matchupRows]
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games)
    .slice(0, 5);
  const worstMatchups = [...matchupRows]
    .sort((a, b) => a.winRate - b.winRate || b.games - a.games)
    .slice(0, 5);

  const decks = buildDeckGroups(sorted).slice(0, 8);

  const createdAts = sorted
    .map((m) => m.createdAt ?? 0)
    .filter((n) => n > 0);
  const firstSeenMs = createdAts.length ? Math.min(...createdAts) : 0;
  const lastSeenMs = createdAts.length ? Math.max(...createdAts) : 0;

  return {
    player: displayName,
    games: totals.games,
    wins: totals.wins,
    losses: totals.losses,
    draws: totals.draws,
    winRate: totals.winRate,
    confidenceScore: wilsonScore(totals.wins, totals.decisive),
    firstSeenMs,
    lastSeenMs,
    currentStreak: computeStreak(sorted),
    favouriteLegends,
    bestMatchups,
    worstMatchups,
    decks,
    trend: buildWeeklyTrend(sorted, 8, nowMs),
    recentMatches: sorted.slice(0, 20),
  };
}

// ── Legend deep-dives ─────────────────────────────────────────────────────────

export type LegendMatchupBreakdown = {
  oppLegend: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
};

export type LegendBattlefieldRow = {
  battlefield: string;
  games: number;
  winRate: number;
};

export type LegendPlayerRow = {
  player: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
};

export type LegendProfile = {
  legend: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  playRate: number;
  totalMatches: number;
  bestMatchups: LegendMatchupBreakdown[];
  worstMatchups: LegendMatchupBreakdown[];
  topDecks: DeckGroup[];
  myBattlefields: LegendBattlefieldRow[];
  oppBattlefields: LegendBattlefieldRow[];
  topPlayers: LegendPlayerRow[];
  playRateTrend: TrendBucket[];
  winRateTrend: TrendBucket[];
  recentMatches: CommunityMatch[];
};

function battlefieldRows(
  matches: CommunityMatch[],
  pick: (m: CommunityMatch) => string[],
): LegendBattlefieldRow[] {
  const groups = new Map<string, CommunityMatch[]>();
  for (const m of matches) {
    for (const raw of pick(m)) {
      const bf = raw.trim();
      if (!bf) continue;
      const arr = groups.get(bf) ?? [];
      arr.push(m);
      groups.set(bf, arr);
    }
  }
  return Array.from(groups.entries())
    .map(([battlefield, rows]) => {
      const t = tally(rows);
      return { battlefield, games: t.games, winRate: t.winRate };
    })
    .filter((row) => row.games >= 3)
    .sort((a, b) => b.games - a.games)
    .slice(0, 6);
}

export function buildLegendProfile(
  matches: CommunityMatch[],
  legend: string,
  nowMs: number = Date.now(),
): LegendProfile | null {
  const target = legend.trim();
  if (!target) return null;
  if (!LEGENDS.includes(target as (typeof LEGENDS)[number])) return null;

  const onLegend = matches.filter((m) => m.myChampion.trim() === target);
  if (onLegend.length === 0) {
    // Return a sparse profile rather than null so the route still renders a page.
    return {
      legend: target,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRate: 0,
      playRate: 0,
      totalMatches: matches.length,
      bestMatchups: [],
      worstMatchups: [],
      topDecks: [],
      myBattlefields: [],
      oppBattlefields: [],
      topPlayers: [],
      playRateTrend: buildWeeklyTrend([], 8, nowMs),
      winRateTrend: buildWeeklyTrend([], 8, nowMs),
      recentMatches: [],
    };
  }

  const sorted = [...onLegend].sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
  );
  const totals = tally(sorted);

  const matchupGroups = groupBy(sorted, (m) => m.oppChampion.trim() || null);
  const matchupRows: LegendMatchupBreakdown[] = Array.from(matchupGroups.entries())
    .map(([oppLegend, rows]) => {
      const t = tally(rows);
      return {
        oppLegend,
        games: t.games,
        wins: t.wins,
        losses: t.losses,
        draws: t.draws,
        winRate: t.winRate,
      };
    })
    .filter((row) => row.games >= 3);

  const bestMatchups = [...matchupRows]
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games)
    .slice(0, 5);
  const worstMatchups = [...matchupRows]
    .sort((a, b) => a.winRate - b.winRate || b.games - a.games)
    .slice(0, 5);

  const topDecks = buildDeckGroups(sorted).slice(0, 6);

  const myBattlefields = battlefieldRows(sorted, (m) => {
    const list: string[] = [];
    for (const g of m.games ?? []) if (g.myBf) list.push(g.myBf);
    if (list.length === 0 && m.myBattlefield) list.push(m.myBattlefield);
    return list;
  });
  const oppBattlefields = battlefieldRows(sorted, (m) => {
    const list: string[] = [];
    for (const g of m.games ?? []) if (g.oppBf) list.push(g.oppBf);
    if (list.length === 0 && m.oppBattlefield) list.push(m.oppBattlefield);
    return list;
  });

  const playerGroups = groupBy(sorted, (m) => m.username?.trim() || null);
  const topPlayers: LegendPlayerRow[] = Array.from(playerGroups.entries())
    .map(([player, rows]) => {
      const t = tally(rows);
      return {
        player,
        games: t.games,
        wins: t.wins,
        losses: t.losses,
        winRate: t.winRate,
      };
    })
    .filter((row) => row.games >= 3)
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate)
    .slice(0, 6);

  // Play-rate trend needs the full match pool to compute a denominator per week.
  const allTrend = buildWeeklyTrend(matches, 8, nowMs);
  const legendTrend = buildWeeklyTrend(sorted, 8, nowMs);
  const playRateTrend: TrendBucket[] = allTrend.map((bucket, i) => {
    const onLegendBucket = legendTrend[i];
    const share =
      bucket.games === 0 ? 0 : Number(((onLegendBucket.games / bucket.games) * 100).toFixed(1));
    return {
      ...onLegendBucket,
      winRate: share,
    };
  });

  return {
    legend: target,
    games: totals.games,
    wins: totals.wins,
    losses: totals.losses,
    draws: totals.draws,
    winRate: totals.winRate,
    playRate:
      matches.length === 0
        ? 0
        : Number(((onLegend.length / matches.length) * 100).toFixed(1)),
    totalMatches: matches.length,
    bestMatchups,
    worstMatchups,
    topDecks,
    myBattlefields,
    oppBattlefields,
    topPlayers,
    playRateTrend,
    winRateTrend: legendTrend,
    recentMatches: sorted.slice(0, 15),
  };
}

// ── Deck comparison ───────────────────────────────────────────────────────────

export type DeckCardDiff = {
  onlyA: DeckEntry[];
  onlyB: DeckEntry[];
  shared: Array<{ name: string; qtyA: number; qtyB: number }>;
};

export type DeckSharedMatchup = {
  oppLegend: string;
  aGames: number;
  aWins: number;
  aWinRate: number;
  bGames: number;
  bWins: number;
  bWinRate: number;
};

export type DeckComparison = {
  a: DeckGroup;
  b: DeckGroup;
  cardDiff: DeckCardDiff | null;
  sharedMatchups: DeckSharedMatchup[];
  aMatches: CommunityMatch[];
  bMatches: CommunityMatch[];
};

function snapshotAllCards(snapshot: DeckSnapshot | null | undefined): DeckEntry[] {
  if (!snapshot) return [];
  const all: DeckEntry[] = [];
  if (snapshot.legendEntry) all.push(snapshot.legendEntry);
  if (snapshot.champion) all.push(...snapshot.champion);
  all.push(...snapshot.runes);
  all.push(...snapshot.battlefields);
  all.push(...snapshot.mainDeck);
  all.push(...snapshot.sideboard);
  return all;
}

function cardKey(entry: DeckEntry) {
  return entry.cardId?.trim() || entry.name.trim();
}

function diffSnapshots(
  a: DeckSnapshot | null | undefined,
  b: DeckSnapshot | null | undefined,
): DeckCardDiff | null {
  if (!a && !b) return null;
  const aMap = new Map<string, DeckEntry>();
  const bMap = new Map<string, DeckEntry>();
  for (const e of snapshotAllCards(a)) {
    const k = cardKey(e);
    const prev = aMap.get(k);
    aMap.set(k, prev ? { ...prev, qty: prev.qty + e.qty } : { ...e });
  }
  for (const e of snapshotAllCards(b)) {
    const k = cardKey(e);
    const prev = bMap.get(k);
    bMap.set(k, prev ? { ...prev, qty: prev.qty + e.qty } : { ...e });
  }

  const onlyA: DeckEntry[] = [];
  const onlyB: DeckEntry[] = [];
  const shared: DeckCardDiff["shared"] = [];

  for (const [k, entry] of aMap) {
    if (!bMap.has(k)) onlyA.push(entry);
    else {
      const other = bMap.get(k)!;
      shared.push({ name: entry.name, qtyA: entry.qty, qtyB: other.qty });
    }
  }
  for (const [k, entry] of bMap) {
    if (!aMap.has(k)) onlyB.push(entry);
  }

  onlyA.sort((x, y) => x.name.localeCompare(y.name));
  onlyB.sort((x, y) => x.name.localeCompare(y.name));
  shared.sort((x, y) => x.name.localeCompare(y.name));
  return { onlyA, onlyB, shared };
}

export function buildDeckComparison(
  matches: CommunityMatch[],
  keyA: string,
  keyB: string,
): DeckComparison | null {
  const a = keyA.trim();
  const b = keyB.trim();
  if (!a || !b || a === b) return null;

  const decks = buildDeckGroups(matches);
  const deckA = decks.find((d) => d.deckKey === a);
  const deckB = decks.find((d) => d.deckKey === b);
  if (!deckA || !deckB) return null;

  const aMatches = matches.filter((m) => deckGroupKey(m) === a);
  const bMatches = matches.filter((m) => deckGroupKey(m) === b);

  const aByOpp = groupBy(aMatches, (m) => m.oppChampion.trim() || null);
  const bByOpp = groupBy(bMatches, (m) => m.oppChampion.trim() || null);
  const oppKeys = new Set<string>([...aByOpp.keys(), ...bByOpp.keys()]);

  const sharedMatchups: DeckSharedMatchup[] = Array.from(oppKeys)
    .map((oppLegend) => {
      const aRows = aByOpp.get(oppLegend) ?? [];
      const bRows = bByOpp.get(oppLegend) ?? [];
      const ta = tally(aRows);
      const tb = tally(bRows);
      return {
        oppLegend,
        aGames: ta.games,
        aWins: ta.wins,
        aWinRate: ta.winRate,
        bGames: tb.games,
        bWins: tb.wins,
        bWinRate: tb.winRate,
      };
    })
    .filter((row) => row.aGames + row.bGames >= 3)
    .sort((x, y) => y.aGames + y.bGames - (x.aGames + x.bGames))
    .slice(0, 12);

  return {
    a: deckA,
    b: deckB,
    cardDiff: diffSnapshots(deckA.snapshot, deckB.snapshot),
    sharedMatchups,
    aMatches,
    bMatches,
  };
}
