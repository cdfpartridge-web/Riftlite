import { describe, expect, it } from "vitest";

import {
  buildDeckGroups,
  buildLegendMeta,
  buildMatrix,
  buildOverview,
} from "@/lib/community/aggregate";
import { applyCommunityFilters, parseFilters } from "@/lib/community/filters";
import { FIXTURE_MATCHES } from "@/lib/fixtures/community";

describe("community aggregation", () => {
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

  it("uses the lifetime match counter for headline totals", () => {
    const overview = buildOverview(FIXTURE_MATCHES, {
      privateMatchCount: 5,
      privatePlayerCount: 2,
      publicLifetimeMatchCount: 1234,
      publicLifetimePlayerCount: 99,
      publicPlayerIndexReady: true,
    });

    expect(overview.totalMatches).toBe(1239);
    expect(overview.publicLifetimeMatches).toBe(1234);
    expect(overview.statsWindowMatches).toBe(FIXTURE_MATCHES.length);
    expect(overview.privateMatches).toBe(5);
    expect(overview.totalPlayers).toBe(101);
    expect(overview.publicLifetimePlayers).toBe(99);
    expect(overview.playerCountMode).toBe("lifetime");
  });

  it("never lets a stale lifetime counter undercut the stats window", () => {
    const overview = buildOverview(FIXTURE_MATCHES, {
      privateMatchCount: 0,
      privatePlayerCount: 0,
      publicLifetimeMatchCount: 1,
    });

    expect(overview.publicLifetimeMatches).toBe(FIXTURE_MATCHES.length);
    expect(overview.totalMatches).toBe(FIXTURE_MATCHES.length);
  });

  it("keeps player totals in recent mode until the player index is backfilled", () => {
    const overview = buildOverview(FIXTURE_MATCHES, {
      privateMatchCount: 0,
      privatePlayerCount: 2,
      publicLifetimeMatchCount: 1234,
      publicLifetimePlayerCount: 99,
      publicPlayerIndexReady: false,
    });

    expect(overview.publicLifetimePlayers).toBeUndefined();
    expect(overview.totalPlayers).toBe(overview.statsWindowPlayers + 2);
    expect(overview.playerCountMode).toBe("recent");
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
