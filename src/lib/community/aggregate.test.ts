import { describe, expect, it } from "vitest";

import { buildDeckGroups, buildLeaderboard, buildLegendMeta, buildMatrix } from "@/lib/community/aggregate";
import { applyCommunityFilters, parseFilters } from "@/lib/community/filters";
import { FIXTURE_MATCHES } from "@/lib/fixtures/community";

describe("community aggregation", () => {
  it("ranks leaderboard entries by Wilson score", () => {
    const rows = buildLeaderboard(FIXTURE_MATCHES);
    expect(rows[0]?.player).toBe("BMU Casts");
    expect(rows[0]?.confidenceScore).toBeGreaterThan(rows[1]?.confidenceScore ?? 0);
  });

  it("sorts legend meta by games played", () => {
    const rows = buildLegendMeta(FIXTURE_MATCHES);
    expect(rows[0]?.legend).toBe("Ahri");
    expect(rows[0]?.games).toBeGreaterThanOrEqual(rows[1]?.games ?? 0);
  });

  it("builds matchup cells and preserves row ordering", () => {
    const matrix = buildMatrix(FIXTURE_MATCHES);
    expect(matrix.rows[0]).toBe("Ahri");
    expect(matrix.cells.find((cell) => cell.myLegend === "Ahri" && cell.oppLegend === "Jinx")?.wins).toBe(1);
  });

  it("groups decks by source key", () => {
    const decks = buildDeckGroups(FIXTURE_MATCHES);
    const ahriDeck = decks.find((deck) => deck.sourceKey === "ahri-tempo-001");
    expect(ahriDeck?.games).toBe(3);
  });

  it("matches desktop filter semantics", () => {
    const filters = parseFilters({
      legend: "Ahri",
      result: "Win",
      seat: "1st",
      battlefield: "Sunken",
      flags: "featured",
    });
    const filtered = applyCommunityFilters(FIXTURE_MATCHES, filters);
    expect(filtered).toHaveLength(2);
  });
});
