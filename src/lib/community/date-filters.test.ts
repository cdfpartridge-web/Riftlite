import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FILTERS } from "@/lib/constants";
import { FIXTURE_MATCHES } from "@/lib/fixtures/community";
import { applyCommunityFilters, dateQueryValue, parseFilters } from "./filters";

const data = vi.hoisted(() => ({
  getCommunityMatchWindow: vi.fn(), getCommunityRangeMatchWindow: vi.fn(),
  getCommunityRangeStats: vi.fn(), getCommunityAggregateCounts: vi.fn(), filterCommunityMatchesByDays: vi.fn(),
}));
vi.mock("./data", () => data);
import { getFilteredCommunityMatches, getLegendMeta, getMatrix, getPaginatedDecks, getPaginatedMatches } from "./service";

describe("community calendar dates", () => {
  const filters = { ...DEFAULT_FILTERS, season: "", range: "date", from: "2026-09-18", timeZone: "Europe/London" };
  const included = { ...FIXTURE_MATCHES[0], id: "included", date: "2026-09-17T23:00:00Z", createdAt: Date.parse("2026-09-17T23:00:00Z") / 1000 };
  const excluded = { ...FIXTURE_MATCHES[1], id: "excluded", date: "2026-09-18T23:00:00Z", createdAt: Date.parse("2026-09-18T23:00:00Z") / 1000 };

  beforeEach(() => { vi.clearAllMocks(); data.getCommunityMatchWindow.mockResolvedValue([excluded]); data.getCommunityRangeMatchWindow.mockResolvedValue([included, excluded]); });

  it("parses shareable dates and a validated timezone without discarding other facets", () => {
    const parsed = parseFilters(new URLSearchParams("range=custom&from=2026-09-17&to=2026-09-18&timeZone=Europe%2FLondon&format=bo3"));
    expect(parsed).toMatchObject({ range: "custom", from: "2026-09-17", to: "2026-09-18", timeZone: "Europe/London", format: "bo3" });
    expect(parseFilters(new URLSearchParams("timeZone=not-a-zone")).timeZone).toBe("UTC");
  });

  it("uses the same dated records for rows, decks, meta and matrix without unfiltered cached totals", async () => {
    const [rows, page, decks, meta, matrix] = await Promise.all([
      getFilteredCommunityMatches(filters), getPaginatedMatches(filters), getPaginatedDecks(filters), getLegendMeta(filters), getMatrix(filters),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["included"]);
    expect(page.total).toBe(1);
    expect(decks.items.reduce((total, deck) => total + deck.games, 0)).toBe(1);
    expect(meta.reduce((total, row) => total + row.games, 0)).toBe(1);
    expect(matrix.matrixReadyMatchCount).toBe(1);
    expect(data.getCommunityRangeMatchWindow).toHaveBeenCalledWith(30);
    expect(data.getCommunityRangeStats).not.toHaveBeenCalled();
  });

  it("uses the recorded date before the upload timestamp", () => {
    const lateUpload = { ...included, date: "2026-09-18T12:00:00Z", createdAt: Date.parse("2026-09-20T12:00:00Z") / 1000 };
    expect(applyCommunityFilters([lateUpload], filters).map((match) => match.id)).toEqual(["included"]);
    expect(applyCommunityFilters([lateUpload], { ...filters, from: "2026-09-20" })).toEqual([]);
  });

  it("does not leak unfiltered results for invalid date queries", () => {
    expect(applyCommunityFilters([included], { ...filters, from: "2026-09-18junk" })).toEqual([]);
    expect(applyCommunityFilters([included], { ...filters, range: "custom", to: "2026-09-17" })).toEqual([]);
    expect(applyCommunityFilters([included], { ...filters, range: "custom", to: "" })).toEqual([]);
  });
  it("keeps existing 24-hour and 14-day periods identifiable on drilldowns", () => {
    expect(dateQueryValue({ ...DEFAULT_FILTERS, range: "1d" }).preset).toBe("1d");
    expect(dateQueryValue({ ...DEFAULT_FILTERS, range: "14d" }).preset).toBe("14d");
  });

});
