import { type NextRequest } from "next/server";

import {
  buildMetaStudioReport,
  metaStudioDateFilter,
  metaStudioRangeDays,
  metaStudioSourceRangeDays,
  parseMetaStudioFilters,
} from "@/lib/community/meta-studio";
import {
  metaStudioJson,
  requireMetaStudioSession,
} from "@/lib/community/meta-studio-auth";
import {
  getCommunityMatchWindow,
  getCommunityRangeMatchWindow,
  getCommunityRangeStats,
} from "@/lib/community/data";
import { dateFilterError } from "@/lib/date-filter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;

function matchTimestamp(value: unknown): number {
  const raw = Number(value ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

export async function GET(request: NextRequest) {
  const auth = await requireMetaStudioSession(request);
  if ("error" in auth) return auth.error;

  const now = Date.now();
  const filters = parseMetaStudioFilters(request.nextUrl.searchParams, now);
  const dateFilter = metaStudioDateFilter(filters);
  if (dateFilter) {
    const error = dateFilterError(dateFilter);
    if (error) return metaStudioJson({ error }, 400);
    // Reuse bounded public detail caches. Arbitrary dates must not trigger a
    // historical collection scan or imply that retained rows are a full census.
    const [recentMatches, monthMatches] = await Promise.all([
      getCommunityMatchWindow(),
      getCommunityRangeMatchWindow(30),
    ]);
    const report = buildMetaStudioReport([...recentMatches, ...monthMatches], filters, {
      now,
      sourceAsOf: now,
      sourcePeriodRecordsExact: false,
      detailWindowTruncated: true,
      comparisonAvailable: false,
      comparisonWindowComplete: false,
    });
    return metaStudioJson({ report });
  }
  const rangeDays = metaStudioRangeDays(filters.range);
  const sourceDays = metaStudioSourceRangeDays(filters.range);

  const sourceStatsPromise = getCommunityRangeStats(sourceDays);
  const currentStatsPromise = rangeDays === 1
    ? Promise.resolve(null)
    : sourceDays === rangeDays
      ? sourceStatsPromise
      : getCommunityRangeStats(rangeDays as 7 | 14 | 30);
  const [matches, sourceRangeStats, currentRangeStats] = await Promise.all([
    getCommunityRangeMatchWindow(sourceDays),
    sourceStatsPromise,
    currentStatsPromise,
  ]);

  const sourceAsOfCandidate = Number(
    sourceRangeStats.updatedAt ?? currentRangeStats?.updatedAt ?? now,
  );
  const sourceAsOf = Number.isFinite(sourceAsOfCandidate) && sourceAsOfCandidate > 0
    ? sourceAsOfCandidate
    : now;
  const currentStart = sourceAsOf - rangeDays * DAY_MS;
  const comparisonStart = sourceAsOf - rangeDays * DAY_MS * 2;
  const detailedTimestamps = matches
    .map((match) => matchTimestamp(match.createdAt))
    .filter((timestamp) => timestamp > 0 && timestamp <= sourceAsOf);
  const oldestDetailedAt = detailedTimestamps.length
    ? Math.min(...detailedTimestamps)
    : 0;
  const sourceWindowComplete = sourceRangeStats.matchCount <= matches.length;
  const detailReaches = (start: number) =>
    sourceWindowComplete || (oldestDetailedAt > 0 && oldestDetailedAt <= start);
  const currentWindowComplete = detailReaches(currentStart);
  const comparisonWindowComplete =
    filters.range !== "30d" && detailReaches(comparisonStart);
  const currentDetailedWindow = matches.filter((match) => {
    const timestamp = matchTimestamp(match.createdAt);
    return timestamp >= currentStart && timestamp <= sourceAsOf;
  });
  const currentStatsAsOf = Number(currentRangeStats?.updatedAt ?? sourceAsOf);
  const currentStatsAligned = Boolean(
    currentRangeStats &&
    Number.isFinite(currentStatsAsOf) &&
    Math.abs(currentStatsAsOf - sourceAsOf) <= 60_000,
  );
  const sourcePeriodRecordsExact = currentWindowComplete || currentStatsAligned;
  const sourcePeriodRecords = currentStatsAligned
    ? currentRangeStats?.matchCount ?? currentDetailedWindow.length
    : currentDetailedWindow.length;

  const report = buildMetaStudioReport(matches, filters, {
    now,
    sourceAsOf,
    sourcePeriodRecords,
    sourcePeriodRecordsExact,
    loadedPeriodRecords: currentDetailedWindow.length,
    detailWindowTruncated: !currentWindowComplete,
    comparisonAvailable: comparisonWindowComplete,
    comparisonWindowComplete,
  });

  return metaStudioJson({ report });
}
