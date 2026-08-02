import { LEGENDS, VENDETTA_LAUNCH_START_MS, VENDETTA_PREVIEW_START_MS } from "@/lib/constants";
import type { CommunityMatch } from "@/lib/types";

export const META_STUDIO_RANGES = ["1d", "7d", "14d", "30d"] as const;
export const META_STUDIO_FORMATS = ["all", "bo1", "bo3"] as const;
export const META_STUDIO_PLATFORMS = ["all", "atlas", "tcga"] as const;
export const META_STUDIO_SEASONS = ["", "pre-vendetta", "vendetta-preview", "vendetta-launch"] as const;
export const META_STUDIO_MIN_SAMPLES = [5, 10, 20] as const;

export type MetaStudioRange = (typeof META_STUDIO_RANGES)[number];
export type MetaStudioFormat = (typeof META_STUDIO_FORMATS)[number];
export type MetaStudioPlatform = (typeof META_STUDIO_PLATFORMS)[number];
export type MetaStudioSeason = (typeof META_STUDIO_SEASONS)[number];
export type MetaStudioMinSample = (typeof META_STUDIO_MIN_SAMPLES)[number];

export type MetaStudioFilters = {
  range: MetaStudioRange;
  season: MetaStudioSeason;
  format: MetaStudioFormat;
  platform: MetaStudioPlatform;
  minSample: MetaStudioMinSample;
};

export type MetaStudioSplit = {
  series: number;
  wins: number;
  losses: number;
  draws: number;
  decisiveSeries: number;
  winRate: number;
};

export type MetaStudioMatchup = MetaStudioSplit & {
  opponentLegend: string;
  first: MetaStudioSplit;
  second: MetaStudioSplit;
  classification: "favorable" | "even" | "unfavorable" | "insufficient";
  confidence: "high" | "medium" | "low" | "insufficient";
};

export type MetaStudioLeader = MetaStudioSplit & {
  rank: number;
  previousRank: number | null;
  rankDelta: number | null;
  legend: string;
  playRate: number;
  adjustedWinRate: number;
  first: MetaStudioSplit;
  second: MetaStudioSplit;
  favorableMatchups: number;
  evenMatchups: number;
  unfavorableMatchups: number;
  matchupCoverage: number;
  cardArtUrl: string;
  cardId: string;
  matchups: MetaStudioMatchup[];
};

export type MetaStudioReport = {
  schemaVersion: 1;
  generatedAt: number;
  filters: MetaStudioFilters;
  window: {
    start: number;
    end: number;
    comparisonStart: number | null;
    comparisonEnd: number | null;
  };
  coverage: {
    sourceAsOf: number;
    sourcePeriodRecords: number;
    sourcePeriodRecordsExact: boolean;
    loadedPeriodRecords: number;
    detailedRecords: number;
    decisiveRecords: number;
    rankedRecords: number;
    matrixReadyRecords: number;
    seatKnownRecords: number;
    deckSnapshotRecords: number;
    platformKnownRecords: number;
    uniquePlayers: number;
    firstCreatedAt: number;
    lastCreatedAt: number;
    detailWindowTruncated: boolean;
    comparisonAvailable: boolean;
    comparisonWindowComplete: boolean;
    comparisonDetailedRecords: number;
  };
  leaders: MetaStudioLeader[];
};

type CanonicalResult = "Win" | "Loss" | "Draw";

type MutableSplit = {
  series: number;
  wins: number;
  losses: number;
  draws: number;
};

type MutableMatchup = MutableSplit & {
  first: MutableSplit;
  second: MutableSplit;
};

type MutableLeader = MutableSplit & {
  first: MutableSplit;
  second: MutableSplit;
  matchups: Map<string, MutableMatchup>;
  cardArtUrl: string;
  cardId: string;
};

type ReportBuildOptions = {
  now?: number;
  sourceAsOf?: number;
  sourcePeriodRecords?: number;
  sourcePeriodRecordsExact?: boolean;
  loadedPeriodRecords?: number;
  detailWindowTruncated?: boolean;
  comparisonAvailable?: boolean;
  comparisonWindowComplete?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ADJUSTED_PRIOR_SERIES = 20;
const ADJUSTED_PRIOR_RATE = 0.5;
const FAVORABLE_THRESHOLD = 55;
const UNFAVORABLE_THRESHOLD = 45;
const TRUSTED_CARD_ART_HOSTS = new Set([
  "assets.riftatlas-workers.com",
  "cdn.rgpub.io",
  "cmsassets.rgpub.io",
]);

const LEGEND_SET = new Set<string>(LEGENDS);

function firstSearchValue(
  source: URLSearchParams | Record<string, string | string[] | undefined>,
  key: string,
) {
  if (source instanceof URLSearchParams) return source.get(key) ?? "";
  const value = source[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function includesValue<const T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value as T[number]);
}

export function defaultMetaStudioSeason(now = Date.now()): MetaStudioSeason {
  if (now >= VENDETTA_LAUNCH_START_MS) return "vendetta-launch";
  if (now >= VENDETTA_PREVIEW_START_MS) return "vendetta-preview";
  return "pre-vendetta";
}

export function parseMetaStudioFilters(
  source: URLSearchParams | Record<string, string | string[] | undefined>,
  now = Date.now(),
): MetaStudioFilters {
  const range = firstSearchValue(source, "range").toLowerCase();
  const season = firstSearchValue(source, "season").toLowerCase();
  const format = firstSearchValue(source, "format").toLowerCase();
  const platform = firstSearchValue(source, "platform").toLowerCase();
  const parsedMinSample = Number.parseInt(firstSearchValue(source, "minSample"), 10);
  const seasonSupplied = source instanceof URLSearchParams
    ? source.has("season")
    : source.season !== undefined;

  return {
    range: includesValue(META_STUDIO_RANGES, range) ? range : "7d",
    season: seasonSupplied && includesValue(META_STUDIO_SEASONS, season)
      ? season
      : defaultMetaStudioSeason(now),
    format: includesValue(META_STUDIO_FORMATS, format) ? format : "all",
    platform: includesValue(META_STUDIO_PLATFORMS, platform) ? platform : "all",
    minSample: META_STUDIO_MIN_SAMPLES.includes(parsedMinSample as MetaStudioMinSample)
      ? parsedMinSample as MetaStudioMinSample
      : 5,
  };
}

export function metaStudioRangeDays(range: MetaStudioRange): number {
  return Number.parseInt(range, 10);
}

export function metaStudioSourceRangeDays(range: MetaStudioRange): 7 | 14 | 30 {
  if (range === "1d") return 7;
  if (range === "7d") return 14;
  return 30;
}

function createdAtMs(match: CommunityMatch): number {
  const raw = Number(match.createdAt ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

function canonicalResult(value: unknown): CanonicalResult | null {
  const result = String(value ?? "").trim().toLowerCase();
  if (result === "win") return "Win";
  if (result === "loss") return "Loss";
  if (result === "draw") return "Draw";
  return null;
}

function canonicalFormat(value: unknown): "bo1" | "bo3" | "" {
  const format = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (format === "bo1" || format === "bestof1") return "bo1";
  if (format === "bo3" || format === "bestof3") return "bo3";
  return "";
}

function canonicalPlatform(value: unknown): "atlas" | "tcga" | "" {
  const platform = String(value ?? "").trim().toLowerCase();
  if (platform === "atlas" || platform === "riftatlas") return "atlas";
  if (platform === "tcga") return "tcga";
  return "";
}

function canonicalSeat(value: unknown): "1st" | "2nd" | "" {
  const seat = String(value ?? "").trim().toLowerCase();
  if (seat === "1st" || seat === "first") return "1st";
  if (seat === "2nd" || seat === "second") return "2nd";
  return "";
}

function seriesSeat(match: CommunityMatch): "1st" | "2nd" | "" {
  return canonicalSeat(match.games?.[0]?.wentFirst) || canonicalSeat(match.wentFirst);
}

function inSeason(createdAt: number, season: MetaStudioSeason): boolean {
  if (!season) return true;
  if (season === "pre-vendetta") return createdAt < VENDETTA_PREVIEW_START_MS;
  if (season === "vendetta-preview") {
    return createdAt >= VENDETTA_PREVIEW_START_MS && createdAt < VENDETTA_LAUNCH_START_MS;
  }
  return createdAt >= VENDETTA_LAUNCH_START_MS;
}

function matchesScope(match: CommunityMatch, filters: MetaStudioFilters): boolean {
  if (match.superseded || match.mergedIntoMatchId) return false;
  if (!inSeason(createdAtMs(match), filters.season)) return false;
  if (filters.format !== "all" && canonicalFormat(match.fmt) !== filters.format) return false;
  if (filters.platform !== "all" && canonicalPlatform(match.platform) !== filters.platform) return false;
  return true;
}

function uniqueMatches(matches: CommunityMatch[]): CommunityMatch[] {
  const byId = new Map<string, CommunityMatch>();
  for (const match of matches) {
    const existing = byId.get(match.id);
    if (!existing || createdAtMs(match) >= createdAtMs(existing)) {
      byId.set(match.id, match);
    }
  }
  return Array.from(byId.values());
}

function emptyMutableSplit(): MutableSplit {
  return { series: 0, wins: 0, losses: 0, draws: 0 };
}

function emptyMutableMatchup(): MutableMatchup {
  return {
    ...emptyMutableSplit(),
    first: emptyMutableSplit(),
    second: emptyMutableSplit(),
  };
}

function emptyMutableLeader(): MutableLeader {
  return {
    ...emptyMutableSplit(),
    first: emptyMutableSplit(),
    second: emptyMutableSplit(),
    matchups: new Map<string, MutableMatchup>(),
    cardArtUrl: "",
    cardId: "",
  };
}

function addResult(split: MutableSplit, result: CanonicalResult) {
  split.series += 1;
  if (result === "Win") split.wins += 1;
  if (result === "Loss") split.losses += 1;
  if (result === "Draw") split.draws += 1;
}

function immutableSplit(split: MutableSplit): MetaStudioSplit {
  const decisiveSeries = split.wins + split.losses;
  return {
    ...split,
    decisiveSeries,
    winRate: decisiveSeries
      ? Number(((split.wins / decisiveSeries) * 100).toFixed(1))
      : 0,
  };
}

function adjustedWinRate(split: MutableSplit): number {
  const decisiveSeries = split.wins + split.losses;
  return Number(((
    (split.wins + ADJUSTED_PRIOR_RATE * ADJUSTED_PRIOR_SERIES) /
    (decisiveSeries + ADJUSTED_PRIOR_SERIES)
  ) * 100).toFixed(1));
}

function matchupClassification(
  split: MetaStudioSplit,
  minSample: MetaStudioMinSample,
): MetaStudioMatchup["classification"] {
  if (split.decisiveSeries < minSample) return "insufficient";
  if (split.winRate >= FAVORABLE_THRESHOLD) return "favorable";
  if (split.winRate <= UNFAVORABLE_THRESHOLD) return "unfavorable";
  return "even";
}

function matchupConfidence(
  split: MetaStudioSplit,
  minSample: MetaStudioMinSample,
): MetaStudioMatchup["confidence"] {
  if (split.decisiveSeries < minSample) return "insufficient";
  if (split.decisiveSeries >= 40) return "high";
  if (split.decisiveSeries >= 15) return "medium";
  return "low";
}

function safeCardArt(match: CommunityMatch): { url: string; cardId: string } {
  const entry = match.deckSnapshot?.legendEntry;
  const candidate = String(entry?.imageUrl ?? "").trim();
  const candidateCardId = String(entry?.cardId ?? "").trim();
  let url = "";
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      TRUSTED_CARD_ART_HOSTS.has(parsed.hostname.toLowerCase())
    ) {
      url = parsed.toString();
    }
  } catch {
    // Community-provided card art is optional. Invalid or untrusted URLs
    // deliberately fall back to RiftLite's own legend resolver.
  }
  const cardId = /^[a-z0-9][a-z0-9-]{1,31}$/i.test(candidateCardId)
    ? candidateCardId
    : "";
  return {
    url,
    cardId,
  };
}

function buildLeaderBuckets(matches: CommunityMatch[]) {
  const buckets = new Map<string, MutableLeader>();
  let rankedRecords = 0;
  let decisiveRecords = 0;
  let matrixReadyRecords = 0;
  let seatKnownRecords = 0;

  for (const match of matches) {
    const result = canonicalResult(match.result);
    if (!result || !LEGEND_SET.has(match.myChampion)) continue;

    rankedRecords += 1;
    if (result !== "Draw") decisiveRecords += 1;
    const seat = seriesSeat(match);
    if (seat) seatKnownRecords += 1;

    const leader = buckets.get(match.myChampion) ?? emptyMutableLeader();
    addResult(leader, result);
    if (seat === "1st") addResult(leader.first, result);
    if (seat === "2nd") addResult(leader.second, result);

    if (!leader.cardArtUrl) {
      const art = safeCardArt(match);
      leader.cardArtUrl = art.url;
      leader.cardId = art.cardId;
    }

    if (LEGEND_SET.has(match.oppChampion)) {
      matrixReadyRecords += 1;
      const matchup = leader.matchups.get(match.oppChampion) ?? emptyMutableMatchup();
      addResult(matchup, result);
      if (seat === "1st") addResult(matchup.first, result);
      if (seat === "2nd") addResult(matchup.second, result);
      leader.matchups.set(match.oppChampion, matchup);
    }

    buckets.set(match.myChampion, leader);
  }

  return {
    buckets,
    rankedRecords,
    decisiveRecords,
    matrixReadyRecords,
    seatKnownRecords,
  };
}

function rankBuckets(buckets: Map<string, MutableLeader>) {
  return Array.from(buckets.entries()).sort(([leftLegend, left], [rightLegend, right]) => {
    const adjustedDelta = adjustedWinRate(right) - adjustedWinRate(left);
    if (adjustedDelta !== 0) return adjustedDelta;
    const sampleDelta = right.series - left.series;
    if (sampleDelta !== 0) return sampleDelta;
    return leftLegend.localeCompare(rightLegend);
  });
}

export function buildMetaStudioReport(
  inputMatches: CommunityMatch[],
  filters: MetaStudioFilters,
  options: ReportBuildOptions = {},
): MetaStudioReport {
  const now = options.now ?? Date.now();
  const sourceAsOf = options.sourceAsOf ?? now;
  const rangeDays = metaStudioRangeDays(filters.range);
  const rangeMs = rangeDays * DAY_MS;
  const currentStart = sourceAsOf - rangeMs;
  const comparisonStart = sourceAsOf - rangeMs * 2;
  const comparisonRequested = options.comparisonAvailable ?? filters.range !== "30d";

  const matches = uniqueMatches(inputMatches).filter((match) => matchesScope(match, filters));
  const currentMatches = matches.filter((match) => {
    const timestamp = createdAtMs(match);
    return timestamp >= currentStart && timestamp <= sourceAsOf;
  });
  const comparisonMatches = comparisonRequested
    ? matches.filter((match) => {
        const timestamp = createdAtMs(match);
        return timestamp >= comparisonStart && timestamp < currentStart;
      })
    : [];

  const current = buildLeaderBuckets(currentMatches);
  const previous = buildLeaderBuckets(comparisonMatches);
  const comparisonAvailable = comparisonRequested && previous.rankedRecords > 0;
  const ranked = rankBuckets(current.buckets);
  const previousRanks = new Map(
    (comparisonAvailable ? rankBuckets(previous.buckets) : [])
      .map(([legend], index) => [legend, index + 1]),
  );
  const totalRanked = Math.max(current.rankedRecords, 1);

  const leaders: MetaStudioLeader[] = ranked.map(([legend, bucket], index) => {
    const rank = index + 1;
    const previousRank = previousRanks.get(legend) ?? null;
    const matchups = Array.from(bucket.matchups.entries())
      .map(([opponentLegend, matchup]) => {
        const overall = immutableSplit(matchup);
        return {
          opponentLegend,
          ...overall,
          first: immutableSplit(matchup.first),
          second: immutableSplit(matchup.second),
          classification: matchupClassification(overall, filters.minSample),
          confidence: matchupConfidence(overall, filters.minSample),
        } satisfies MetaStudioMatchup;
      })
      .sort((left, right) => {
        if (right.series !== left.series) return right.series - left.series;
        return left.opponentLegend.localeCompare(right.opponentLegend);
      });

    return {
      rank,
      previousRank,
      rankDelta: previousRank === null ? null : previousRank - rank,
      legend,
      ...immutableSplit(bucket),
      playRate: Number(((bucket.series / totalRanked) * 100).toFixed(1)),
      adjustedWinRate: adjustedWinRate(bucket),
      first: immutableSplit(bucket.first),
      second: immutableSplit(bucket.second),
      favorableMatchups: matchups.filter((item) => item.classification === "favorable").length,
      evenMatchups: matchups.filter((item) => item.classification === "even").length,
      unfavorableMatchups: matchups.filter((item) => item.classification === "unfavorable").length,
      matchupCoverage: matchups.filter((item) => item.classification !== "insufficient").length,
      cardArtUrl: bucket.cardArtUrl,
      cardId: bucket.cardId,
      matchups,
    };
  });

  const timestamps = currentMatches
    .map(createdAtMs)
    .filter((value) => value > 0);
  const uniquePlayers = new Set(
    currentMatches
      .map((match) => String(match.uid || match.username).trim())
      .filter(Boolean),
  );

  return {
    schemaVersion: 1,
    generatedAt: now,
    filters,
    window: {
      start: currentStart,
      end: sourceAsOf,
      comparisonStart: comparisonAvailable ? comparisonStart : null,
      comparisonEnd: comparisonAvailable ? currentStart : null,
    },
    coverage: {
      sourceAsOf,
      sourcePeriodRecords: Math.max(options.sourcePeriodRecords ?? currentMatches.length, currentMatches.length),
      sourcePeriodRecordsExact: options.sourcePeriodRecordsExact ?? true,
      loadedPeriodRecords: Math.max(options.loadedPeriodRecords ?? currentMatches.length, currentMatches.length),
      detailedRecords: currentMatches.length,
      decisiveRecords: current.decisiveRecords,
      rankedRecords: current.rankedRecords,
      matrixReadyRecords: current.matrixReadyRecords,
      seatKnownRecords: current.seatKnownRecords,
      deckSnapshotRecords: currentMatches.filter((match) => Boolean(match.deckSnapshot)).length,
      platformKnownRecords: currentMatches.filter((match) => Boolean(canonicalPlatform(match.platform))).length,
      uniquePlayers: uniquePlayers.size,
      firstCreatedAt: timestamps.length ? Math.min(...timestamps) : 0,
      lastCreatedAt: timestamps.length ? Math.max(...timestamps) : 0,
      detailWindowTruncated: options.detailWindowTruncated === true,
      comparisonAvailable,
      comparisonWindowComplete: options.comparisonWindowComplete ?? comparisonRequested,
      comparisonDetailedRecords: comparisonMatches.length,
    },
    leaders,
  };
}
