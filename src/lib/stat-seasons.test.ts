import { describe, expect, it } from "vitest";
import { CURRENT_STAT_SEASON, RADIANCE_PRESEASON_START_MS as START, STAT_SEASONS, isInStatSeason, statMatchDateValue, statMatchTimestamp } from "./stat-seasons";
import { isInDateFilter } from "./date-filter";
import { parseDateQuery, parseFilters, applyCommunitySeasonFilter } from "./community/filters";
import { buildMetaStudioReport, parseMetaStudioFilters } from "./community/meta-studio";
import { FIXTURE_MATCHES } from "./fixtures/community";

describe("Radiance pre-season boundary", () => {
  const rows = [-1, 0, 1].map((offset) => ({ ...FIXTURE_MATCHES[0], id: String(offset), date: new Date(START + offset).toISOString(), createdAt: START + 86_400_000 }));

  it("closes Vendetta exclusively and starts Radiance inclusively to the millisecond", () => {
    expect(applyCommunitySeasonFilter(rows, { season: CURRENT_STAT_SEASON }).map((row) => row.id)).toEqual(["0", "1"]);
    expect(applyCommunitySeasonFilter(rows, { season: "vendetta-launch" }).map((row) => row.id)).toEqual(["-1"]);
    expect(applyCommunitySeasonFilter(rows, { season: "" })).toEqual(rows);
    expect(STAT_SEASONS.map((season) => season.id)).toEqual([CURRENT_STAT_SEASON, "vendetta-launch", "vendetta-preview", "pre-vendetta", ""]);
  });

  it("uses recorded time rather than a late upload, including date-only historical records", () => {
    expect(statMatchTimestamp({ date: rows[0].date, createdAt: START + 1000 })).toBe(START - 1);
    expect(statMatchTimestamp({ capturedAt: rows[0].date, date: rows[2].date })).toBe(START - 1);
    expect(isInStatSeason(statMatchTimestamp({ date: "2026-10-10", createdAt: START + 1000 }), CURRENT_STAT_SEASON)).toBe(false);
    expect(statMatchTimestamp({ createdAt: START / 1000 })).toBe(START);
    expect(statMatchTimestamp({ date: "invalid", createdAt: START })).toBeNull();
    expect(statMatchTimestamp({ date: "2026-02-30", createdAt: START })).toBeNull();
    expect(isInStatSeason(null, CURRENT_STAT_SEASON)).toBe(false);
    expect(isInStatSeason(null, "")).toBe(true);
  });

  it("keeps capture precedence and date-only calendar meaning consistent with date filters", () => {
    expect(statMatchDateValue({ capturedAt: rows[0].date, date: rows[2].date })).toBe(START - 1);
    expect(statMatchDateValue({ capturedAt: "invalid", date: rows[2].date })).toBeNull();
    expect(isInDateFilter(statMatchDateValue({ date: "2026-10-10", createdAt: START }), { preset: "date", from: "2026-10-10", to: "" }, new Date(), "America/Los_Angeles")).toBe(true);
  });

  it("defaults all web stats entry points to Radiance while preserving explicit archives", () => {
    expect(parseFilters({}).season).toBe(CURRENT_STAT_SEASON);
    expect(parseDateQuery({}).season).toBe(CURRENT_STAT_SEASON);
    expect(parseMetaStudioFilters(new URLSearchParams(), START).season).toBe(CURRENT_STAT_SEASON);
    expect(parseMetaStudioFilters(new URLSearchParams(), START - 1).season).toBe("vendetta-launch");
    for (const season of STAT_SEASONS) {
      expect(parseFilters(new URLSearchParams({ season: season.id })).season).toBe(season.id);
      expect(parseDateQuery({ season: season.id }).season).toBe(season.id);
      expect(parseMetaStudioFilters(new URLSearchParams({ season: season.id }), START).season).toBe(season.id);
    }
    expect(parseFilters({ season: "invalid" }).season).toBe(CURRENT_STAT_SEASON);
  });

  it("uses the same season rows for Meta Studio rankings and comparisons", () => {
    const filters = parseMetaStudioFilters(new URLSearchParams(), START + 1000);
    const report = buildMetaStudioReport(rows, filters, { now: START + 1000 });
    expect(report.coverage.detailedRecords).toBe(2);
    expect(report.coverage.comparisonDetailedRecords).toBe(0);
    const archive = buildMetaStudioReport(rows, { ...filters, season: "vendetta-launch" }, { now: START + 1000 });
    expect(archive.coverage.detailedRecords).toBe(1);
  });
});
