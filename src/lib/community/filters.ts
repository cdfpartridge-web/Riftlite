import {
  DEFAULT_FILTERS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
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

export function applyCommunityFilters(
  matches: CommunityMatch[],
  filters: CommunityFilterParams,
) {
  return matches.filter((match) => {
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
