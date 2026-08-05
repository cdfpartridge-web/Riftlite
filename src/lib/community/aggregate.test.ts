import { describe, expect, it } from "vitest";

import {
  buildDeckGroups,
  buildLegendMeta,
  buildMatrix,
  buildOverview,
  ensureSymmetricMatrix,
} from "@/lib/community/aggregate";
import { applyCommunityFilters, parseFilters } from "@/lib/community/filters";
import { FIXTURE_MATCHES } from "@/lib/fixtures/community";
import type { CommunityMatch, MatrixView } from "@/lib/types";

function matrixMatch(
  id: string,
  myChampion: string,
  oppChampion: string,
  result: "Win" | "Loss" | "Draw",
  overrides: Partial<CommunityMatch> = {},
): CommunityMatch {
  return {
    ...FIXTURE_MATCHES[0],
    id,
    myChampion,
    oppChampion,
    result,
    ...overrides,
  };
}

describe("community aggregation", () => {
  it("sorts legend meta by games played", () => {
    const rows = buildLegendMeta(FIXTURE_MATCHES);
    expect(rows[0]?.legend).toBe("Ahri");
    expect(rows[0]?.games).toBeGreaterThanOrEqual(rows[1]?.games ?? 0);
  });

  it("builds matchup cells with one shared participation ordering", () => {
    const matrix = buildMatrix(FIXTURE_MATCHES);
    expect(matrix.rows).toEqual(matrix.columns);
    expect(matrix.matrixReadyMatchCount).toBe(FIXTURE_MATCHES.length);
    expect(matrix.cells.find((cell) => cell.myLegend === "Ahri" && cell.oppLegend === "Jinx")?.wins).toBe(1);
  });

  it("pools both capture directions by match count and returns complementary cells", () => {
    const matches = [
      ...Array.from({ length: 10 }, (_, index) =>
        matrixMatch(`reksai-win-${index}`, "Rek'Sai", "Kennen", "Win"),
      ),
      matrixMatch("reksai-loss", "Rek'Sai", "Kennen", "Loss"),
      ...Array.from({ length: 12 }, (_, index) =>
        matrixMatch(`kennen-win-${index}`, "Kennen", "Rek'Sai", "Win"),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        matrixMatch(`kennen-loss-${index}`, "Kennen", "Rek'Sai", "Loss"),
      ),
    ];

    const matrix = buildMatrix(matches);
    const reksai = matrix.cells.find(
      (cell) => cell.myLegend === "Rek'Sai" && cell.oppLegend === "Kennen",
    );
    const kennen = matrix.cells.find(
      (cell) => cell.myLegend === "Kennen" && cell.oppLegend === "Rek'Sai",
    );

    expect(reksai).toMatchObject({
      wins: 20,
      losses: 13,
      decisiveGames: 33,
      totalGames: 33,
      winRate: 60.6,
      directCaptures: { wins: 10, losses: 1, totalGames: 11, winRate: 90.9 },
      reverseCaptures: { wins: 12, losses: 10, totalGames: 22, winRate: 54.5 },
    });
    expect(kennen).toMatchObject({
      wins: 13,
      losses: 20,
      decisiveGames: 33,
      totalGames: 33,
      winRate: 39.4,
    });
    expect((reksai?.winRate ?? 0) + (kennen?.winRate ?? 0)).toBe(100);
    expect(matrix.matrixReadyMatchCount).toBe(33);
    expect(matrix.aggregationMethod).toBe("symmetric-v1");
    expect(matrix.rows).toEqual(matrix.columns);
  });

  it("deduplicates ids and repaired-series lineage before pooling", () => {
    const matches = [
      matrixMatch("source-document", "Ahri", "Jinx", "Win", {
        localMatchId: "source-game",
      }),
      matrixMatch("combined-series", "Ahri", "Jinx", "Loss", {
        combinedFromMatchIds: ["source-game"],
      }),
      matrixMatch("combined-series", "Ahri", "Jinx", "Loss", {
        combinedFromMatchIds: ["source-game"],
      }),
      matrixMatch("superseded", "Ahri", "Jinx", "Win", {
        superseded: true,
      }),
      matrixMatch("merged", "Ahri", "Jinx", "Win", {
        mergedIntoMatchId: "combined-series",
      }),
    ];

    const matrix = buildMatrix(matches);
    const cell = matrix.cells.find(
      (candidate) => candidate.myLegend === "Ahri" && candidate.oppLegend === "Jinx",
    );
    expect(matrix.matrixReadyMatchCount).toBe(1);
    expect(cell).toMatchObject({ wins: 0, losses: 1, totalGames: 1 });
  });

  it("does not double a same-legend matchup into its reverse cohort", () => {
    const matrix = buildMatrix([
      matrixMatch("mirror-win", "Kennen", "Kennen", "Win"),
      matrixMatch("mirror-loss", "Kennen", "Kennen", "Loss"),
      matrixMatch("mirror-draw", "Kennen", "Kennen", "Draw"),
    ]);
    const cell = matrix.cells[0];

    expect(cell).toMatchObject({
      wins: 1,
      losses: 1,
      draws: 1,
      totalGames: 3,
      directCaptures: { totalGames: 3 },
      reverseCaptures: { totalGames: 0 },
    });
    expect(matrix.matrixReadyMatchCount).toBe(3);
  });

  it("losslessly upgrades cached directional matrices without match rows", () => {
    const legacy = {
      rows: ["Rek'Sai", "Kennen"],
      columns: ["Kennen", "Rek'Sai"],
      cells: [
        {
          myLegend: "Rek'Sai",
          oppLegend: "Kennen",
          wins: 10,
          losses: 1,
          draws: 0,
          decisiveGames: 11,
          totalGames: 11,
          winRate: 90.9,
        },
        {
          myLegend: "Kennen",
          oppLegend: "Rek'Sai",
          wins: 12,
          losses: 10,
          draws: 0,
          decisiveGames: 22,
          totalGames: 22,
          winRate: 54.5,
        },
      ],
      sourceMatchCount: 5_000,
      detailMatchCount: 500,
    } as unknown as MatrixView;

    const upgraded = ensureSymmetricMatrix(legacy);
    expect(upgraded.matrixReadyMatchCount).toBe(33);
    expect(upgraded.sourceMatchCount).toBe(5_000);
    expect(upgraded.detailMatchCount).toBe(500);
    expect(
      upgraded.cells.find(
        (cell) => cell.myLegend === "Rek'Sai" && cell.oppLegend === "Kennen",
      ),
    ).toMatchObject({ wins: 20, losses: 13, totalGames: 33, winRate: 60.6 });
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

  it("parses and applies BO1 and BO3 aliases", () => {
    const matches = [
      matrixMatch("bo1", "Ahri", "Jinx", "Win", { fmt: "Bo1" }),
      matrixMatch("best-of-one", "Ahri", "Jinx", "Loss", { fmt: "Best of 1" }),
      matrixMatch("bo3", "Ahri", "Jinx", "Win", { fmt: "BO3" }),
      matrixMatch("best-of-three", "Ahri", "Jinx", "Loss", { fmt: "best-of-3" }),
    ];

    const bo1 = applyCommunityFilters(
      matches,
      parseFilters({ season: "", format: "BEST OF 1" }),
    );
    const bo3 = applyCommunityFilters(
      matches,
      parseFilters({ season: "", format: "Bo3" }),
    );

    expect(bo1.map((match) => match.id)).toEqual(["bo1", "best-of-one"]);
    expect(bo3.map((match) => match.id)).toEqual(["bo3", "best-of-three"]);
    expect(parseFilters({ format: "unsupported" }).format).toBe("");
  });

  it("keeps BO3 source games out of the BO1 filter after a series is combined", () => {
    const source = matrixMatch("source", "Ahri", "Jinx", "Win", {
      fmt: "Bo1",
      localMatchId: "source-local-id",
    });
    const series = matrixMatch("series", "Ahri", "Jinx", "Loss", {
      fmt: "Bo3",
      combinedFromMatchIds: ["source-local-id"],
    });

    expect(applyCommunityFilters(
      [source, series],
      parseFilters({ season: "", format: "bo1" }),
    )).toEqual([]);
    expect(applyCommunityFilters(
      [source, series],
      parseFilters({ season: "", format: "bo3" }),
    ).map((match) => match.id)).toEqual(["series"]);
  });
});
