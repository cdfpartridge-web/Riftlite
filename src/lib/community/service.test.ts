import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FILTERS } from "@/lib/constants";
import { FIXTURE_MATCHES } from "@/lib/fixtures/community";
import { RADIANCE_PRESEASON_START_MS as START } from "@/lib/stat-seasons";

const data = vi.hoisted(() => ({
  filterCommunityMatchesByDays: vi.fn((matches: unknown[]) => matches),
  getCommunityAggregateCounts: vi.fn(),
  getCommunityMatchWindow: vi.fn(),
  getCommunityRangeMatchWindow: vi.fn(),
  getCommunityRangeStats: vi.fn(),
}));

vi.mock("@/lib/community/data", () => data);

import { getLegendMeta, getMatrix, getFilteredCommunityMatches, getPaginatedDecks, getPaginatedMatches } from "./service";

describe("community service format filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    data.getCommunityRangeStats.mockResolvedValue({
      legendMeta: [{ legend: "Cached", games: 999, wins: 999, losses: 0, draws: 0, winRate: 100 }],
      matrix: {
        rows: ["Cached"],
        columns: ["Cached"],
        cells: [],
        aggregationMethod: "symmetric-v1",
        matrixReadyMatchCount: 999,
      },
    });
    data.getCommunityRangeMatchWindow.mockResolvedValue([
      { ...FIXTURE_MATCHES[0], id: "bo1", fmt: "Bo1" },
      { ...FIXTURE_MATCHES[1], id: "bo3", fmt: "Best of 3" },
    ]);
  });

  it("bypasses unfiltered range aggregates for BO3 meta and matrix requests", async () => {
    const filters = {
      ...DEFAULT_FILTERS,
      range: "7d",
      season: "",
      format: "bo3",
    };

    const [meta, matrix] = await Promise.all([
      getLegendMeta(filters),
      getMatrix(filters),
    ]);

    expect(data.getCommunityRangeStats).not.toHaveBeenCalled();
    expect(data.getCommunityRangeMatchWindow).toHaveBeenCalledWith(7);
    expect(meta.reduce((sum, row) => sum + row.games, 0)).toBe(1);
    expect(matrix.matrixReadyMatchCount).toBe(1);
  });

  it("retains the precomputed fast path when no format is selected", async () => {
    const meta = await getLegendMeta({
      ...DEFAULT_FILTERS,
      range: "7d",
      season: "",
      format: "",
    });

    expect(data.getCommunityRangeStats).toHaveBeenCalledWith(7);
    expect(data.getCommunityRangeMatchWindow).not.toHaveBeenCalled();
    expect(meta[0]?.legend).toBe("Cached");
  });

  it("applies the Radiance boundary before rows, deck totals, meta and matrix, bypassing all-season caches", async () => {
    data.getCommunityRangeMatchWindow.mockResolvedValue([
      { ...FIXTURE_MATCHES[0], id: "earlier-late-upload", date: new Date(START - 1).toISOString(), createdAt: START + 1000 },
      { ...FIXTURE_MATCHES[0], id: "radiance", date: new Date(START).toISOString(), createdAt: START + 1000 },
    ]);
    const filters = { ...DEFAULT_FILTERS, range: "7d" };
    const [rows, page, decks, meta, matrix] = await Promise.all([
      getFilteredCommunityMatches(filters), getPaginatedMatches(filters), getPaginatedDecks(filters), getLegendMeta(filters), getMatrix(filters),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["radiance"]);
    expect(page.total).toBe(1);
    expect(decks.items.reduce((sum, deck) => sum + deck.games, 0)).toBe(1);
    expect(meta.reduce((sum, legend) => sum + legend.games, 0)).toBe(1);
    expect(matrix.matrixReadyMatchCount).toBe(1);
    expect(data.getCommunityRangeStats).not.toHaveBeenCalled();
  });
});
