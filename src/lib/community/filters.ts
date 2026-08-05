import {
  DEFAULT_FILTERS,
  DEFAULT_PAGE_SIZE,
  COMMUNITY_SEASON_IDS,
  MAX_PAGE_SIZE,
  VENDETTA_LAUNCH_START_MS,
  VENDETTA_PREVIEW_START_MS,
} from "@/lib/constants";
import type { CommunityFilterParams, CommunityMatch } from "@/lib/types";

export function parseFilters(
  searchParams:
    | URLSearchParams
    | Record<string, string | string[] | undefined>
    | undefined,
): CommunityFilterParams {
  const source =
    searchParams instanceof URLSearchParams
      ? Object.fromEntries(searchParams.entries())
      : searchParams ?? {};

  const page = Number.parseInt(String(source.page ?? DEFAULT_FILTERS.page), 10);
  const pageSize = Number.parseInt(
    String(source.pageSize ?? DEFAULT_PAGE_SIZE),
    10,
  );

  return {
    range: ["1d", "7d", "14d", "30d"].includes(String(source.range ?? ""))
      ? String(source.range)
      : DEFAULT_FILTERS.range,
    season: COMMUNITY_SEASON_IDS.includes(String(source.season ?? "") as (typeof COMMUNITY_SEASON_IDS)[number])
      ? String(source.season ?? "")
      : DEFAULT_FILTERS.season,
    format: canonicalCommunityFormat(source.format),
    legend: String(source.legend ?? "").trim(),
    result: String(source.result ?? "").trim(),
    seat: String(source.seat ?? "").trim(),
    battlefield: String(source.battlefield ?? "").trim(),
    flags: String(source.flags ?? "").trim(),
    page: Number.isFinite(page) && page > 0 ? page : DEFAULT_FILTERS.page,
    pageSize:
      Number.isFinite(pageSize) && pageSize > 0
        ? Math.min(pageSize, MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE,
  };
}

export function applyCommunitySeasonFilter(
  matches: CommunityMatch[],
  filters: Pick<CommunityFilterParams, "season">,
) {
  if (!filters.season) {
    return matches;
  }
  return matches.filter((match) => {
    const createdAt = matchCreatedAtMs(match);
    if (!createdAt) {
      return false;
    }
    if (filters.season === "pre-vendetta") {
      return createdAt < VENDETTA_PREVIEW_START_MS;
    }
    if (filters.season === "vendetta-preview") {
      return createdAt >= VENDETTA_PREVIEW_START_MS && createdAt < VENDETTA_LAUNCH_START_MS;
    }
    if (filters.season === "vendetta-launch") {
      return createdAt >= VENDETTA_LAUNCH_START_MS;
    }
    return true;
  });
}

export function applyCommunityFilters(
  matches: CommunityMatch[],
  filters: CommunityFilterParams,
) {
  const activeMatches = matches.filter(
    (match) => !match.superseded && !match.mergedIntoMatchId,
  );
  const combinedSourceIds = new Set(
    activeMatches.flatMap((match) => match.combinedFromMatchIds ?? []),
  );

  return activeMatches.filter((match) => {
    if (match.localMatchId && combinedSourceIds.has(match.localMatchId)) {
      return false;
    }

    if (
      filters.format &&
      canonicalCommunityFormat(match.fmt) !== filters.format
    ) {
      return false;
    }

    if (filters.legend) {
      const champs = [match.myChampion, match.oppChampion];
      if (!champs.includes(filters.legend)) {
        return false;
      }
    }

    if (filters.result && match.result !== filters.result) {
      return false;
    }

    if (filters.seat === "1st" && match.wentFirst !== "1st") {
      return false;
    }

    if (filters.seat === "2nd" && match.wentFirst !== "2nd") {
      return false;
    }

    if (filters.battlefield) {
      const haystack = `${match.myBattlefield} ${match.oppBattlefield}`.toLowerCase();
      if (!haystack.includes(filters.battlefield.toLowerCase())) {
        return false;
      }
    }

    if (
      filters.flags &&
      !match.flags.toLowerCase().includes(filters.flags.toLowerCase())
    ) {
      return false;
    }

    return true;
  });
}

export function canonicalCommunityFormat(value: unknown): "bo1" | "bo3" | "" {
  const format = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (format === "bo1" || format === "bestof1") return "bo1";
  if (format === "bo3" || format === "bestof3") return "bo3";
  return "";
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(items.length / pageSize)),
  };
}

function matchCreatedAtMs(match: CommunityMatch): number {
  const raw = Number(match.createdAt ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}
