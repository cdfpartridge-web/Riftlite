import { describe, expect, it } from "vitest";

import {
  buildMetaStudioReport,
  META_STUDIO_AGGREGATION_METHOD,
  parseMetaStudioFilters,
  type MetaStudioFilters,
} from "@/lib/community/meta-studio";
import { buildMatrix } from "@/lib/community/aggregate";
import type { CommunityMatch } from "@/lib/types";

const NOW = Date.UTC(2026, 6, 30, 12);
const DAY = 24 * 60 * 60 * 1000;

const FILTERS: MetaStudioFilters = {
  range: "7d",
  season: "vendetta-preview",
  format: "all",
  platform: "all",
  minSample: 5,
};

function match(
  id: string,
  myChampion: string,
  oppChampion: string,
  result: string,
  overrides: Partial<CommunityMatch> = {},
): CommunityMatch {
  return {
    id,
    uid: `uid-${id}`,
    username: `Player ${id}`,
    date: new Date(NOW - DAY).toISOString(),
    result,
    myChampion,
    oppChampion,
    oppName: "Opponent",
    fmt: "Bo1",
    platform: "atlas",
    score: result === "Win" ? "1-0" : "0-1",
    wentFirst: "1st",
    myBattlefield: "",
    oppBattlefield: "",
    flags: "",
    games: [],
    deckName: "",
    deckSourceUrl: "",
    deckSourceKey: "",
    deckSnapshot: null,
    createdAt: NOW - DAY,
    ...overrides,
  };
}

describe("Meta Studio report", () => {
  it("adds an inverted opponent perspective without doubling source coverage", () => {
    const report = buildMetaStudioReport([
      match("one-capture", "Akali", "Annie", "Win", { wentFirst: "1st" }),
    ], FILTERS, { now: NOW });
    const akali = report.leaders.find((leader) => leader.legend === "Akali");
    const annie = report.leaders.find((leader) => leader.legend === "Annie");

    expect(report.coverage).toMatchObject({
      detailedRecords: 1,
      rankedRecords: 1,
      matrixReadyRecords: 1,
      legendAppearances: 2,
      uniquePlayers: 1,
    });
    expect(akali).toMatchObject({
      series: 1,
      wins: 1,
      losses: 0,
      playRate: 50,
      first: { series: 1, wins: 1 },
      second: { series: 0 },
    });
    expect(annie).toMatchObject({
      series: 1,
      wins: 0,
      losses: 1,
      playRate: 50,
      first: { series: 0 },
      second: { series: 1, losses: 1 },
    });
  });

  it("builds deterministic rankings, matchup classes, seat splits, and rank movement", () => {
    const matches: CommunityMatch[] = [];
    for (let index = 0; index < 7; index += 1) {
      matches.push(match(`akali-win-${index}`, "Akali", "Annie", "Win", {
        wentFirst: index < 4 ? "1st" : "2nd",
      }));
    }
    for (let index = 0; index < 3; index += 1) {
      matches.push(match(`akali-loss-${index}`, "Akali", "Annie", "Loss", {
        wentFirst: "2nd",
      }));
    }
    for (let index = 0; index < 8; index += 1) {
      matches.push(match(`annie-current-${index}`, "Annie", "Akali", index < 4 ? "Win" : "Loss"));
    }

    // Previous period: Annie was above Akali, so Akali should show positive movement.
    for (let index = 0; index < 8; index += 1) {
      matches.push(match(`annie-previous-${index}`, "Annie", "Akali", index < 6 ? "Win" : "Loss", {
        createdAt: NOW - DAY * 10,
      }));
      matches.push(match(`akali-previous-${index}`, "Akali", "Annie", index < 3 ? "Win" : "Loss", {
        createdAt: NOW - DAY * 10,
      }));
    }

    const report = buildMetaStudioReport(matches, FILTERS, { now: NOW });
    const akali = report.leaders.find((leader) => leader.legend === "Akali");

    expect(report.leaders[0]?.legend).toBe("Akali");
    expect(akali).toMatchObject({
      rank: 1,
      previousRank: 2,
      rankDelta: 1,
      series: 18,
      wins: 11,
      losses: 7,
      winRate: 61.1,
    });
    expect(akali?.first).toMatchObject({ series: 4, wins: 4, winRate: 100 });
    expect(akali?.second).toMatchObject({ series: 14, wins: 7, losses: 7, winRate: 50 });
    expect(akali?.matchups[0]).toMatchObject({
      opponentLegend: "Annie",
      classification: "favorable",
      confidence: "medium",
      directCaptures: { series: 10, wins: 7, losses: 3 },
      reverseCaptures: { series: 8, wins: 4, losses: 4 },
    });
    expect(akali?.adjustedWinRate).toBeGreaterThan(50);
    expect(akali?.adjustedWinRate).toBeLessThan(akali?.winRate ?? 0);
  });

  it("matches the public matrix symmetric pooling contract", () => {
    const matches = [
      ...Array.from({ length: 10 }, (_, index) =>
        match(`akali-win-${index}`, "Akali", "Annie", "Win"),
      ),
      match("akali-loss", "Akali", "Annie", "Loss"),
      ...Array.from({ length: 12 }, (_, index) =>
        match(`annie-win-${index}`, "Annie", "Akali", "Win"),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        match(`annie-loss-${index}`, "Annie", "Akali", "Loss"),
      ),
    ];

    const report = buildMetaStudioReport(matches, FILTERS, { now: NOW });
    const matrix = buildMatrix(matches);
    const akali = report.leaders.find((leader) => leader.legend === "Akali");
    const annie = report.leaders.find((leader) => leader.legend === "Annie");
    const matrixAkali = matrix.cells.find(
      (cell) => cell.myLegend === "Akali" && cell.oppLegend === "Annie",
    );

    expect(report).toMatchObject({
      schemaVersion: 2,
      aggregationMethod: META_STUDIO_AGGREGATION_METHOD,
      coverage: {
        detailedRecords: 33,
        rankedRecords: 33,
        matrixReadyRecords: 33,
        legendAppearances: 66,
        uniquePlayers: 33,
      },
    });
    expect(akali).toMatchObject({
      series: 33,
      wins: 20,
      losses: 13,
      winRate: 60.6,
      playRate: 50,
      first: { series: 11, wins: 10, losses: 1 },
      second: { series: 22, wins: 10, losses: 12 },
    });
    expect(annie).toMatchObject({
      series: 33,
      wins: 13,
      losses: 20,
      winRate: 39.4,
      playRate: 50,
    });
    expect(akali?.matchups[0]).toMatchObject({
      opponentLegend: "Annie",
      series: 33,
      wins: 20,
      losses: 13,
      winRate: 60.6,
      directCaptures: { series: 11, wins: 10, losses: 1 },
      reverseCaptures: { series: 22, wins: 12, losses: 10 },
    });
    expect(akali?.matchups[0]).toMatchObject({
      wins: matrixAkali?.wins,
      losses: matrixAkali?.losses,
      draws: matrixAkali?.draws,
      decisiveSeries: matrixAkali?.decisiveGames,
      series: matrixAkali?.totalGames,
      winRate: matrixAkali?.winRate,
    });
    expect((akali?.winRate ?? 0) + (annie?.winRate ?? 0)).toBe(100);
  });

  it("does not turn unknown outcomes into losses and keeps percentages in the 0..100 unit", () => {
    const report = buildMetaStudioReport([
      match("win", "Akali", "Annie", "Win"),
      match("unknown", "Akali", "Annie", "Unknown"),
      match("blank", "Akali", "Annie", ""),
    ], FILTERS, { now: NOW });

    expect(report.coverage.detailedRecords).toBe(3);
    expect(report.coverage.rankedRecords).toBe(1);
    expect(report.coverage.legendAppearances).toBe(2);
    expect(report.leaders[0]).toMatchObject({
      series: 1,
      wins: 1,
      losses: 0,
      winRate: 100,
    });
    expect(report.leaders[0]?.adjustedWinRate).toBeLessThanOrEqual(100);
  });

  it("normalizes second and millisecond timestamps identically and uses game-one seat first", () => {
    const milliseconds = match("milliseconds", "Akali", "Annie", "Win", {
      createdAt: NOW - DAY,
      wentFirst: "2nd",
      games: [{ myBf: "", oppBf: "", wentFirst: "1st", result: "Win", myPoints: 0, oppPoints: 0 }],
    });
    const seconds = match("seconds", "Akali", "Annie", "Loss", {
      createdAt: Math.floor((NOW - DAY) / 1000),
      wentFirst: "1st",
      games: [{ myBf: "", oppBf: "", wentFirst: "2nd", result: "Loss", myPoints: 0, oppPoints: 0 }],
    });

    const report = buildMetaStudioReport([milliseconds, seconds], FILTERS, { now: NOW });
    expect(report.coverage.detailedRecords).toBe(2);
    expect(report.leaders[0]?.first).toMatchObject({ series: 1, wins: 1 });
    expect(report.leaders[0]?.second).toMatchObject({ series: 1, losses: 1 });
  });

  it("falls back to the match seat when game one contains an invalid seat value", () => {
    const report = buildMetaStudioReport([
      match("seat-fallback", "Akali", "Annie", "Win", {
        wentFirst: "2nd",
        games: [{
          myBf: "",
          oppBf: "",
          wentFirst: "undecided",
          result: "Win",
          myPoints: 0,
          oppPoints: 0,
        }],
      }),
    ], FILTERS, { now: NOW });

    expect(report.leaders[0]?.second).toMatchObject({ series: 1, wins: 1 });
  });

  it("filters format and platform, removes superseded rows, and deduplicates exact ids", () => {
    const filters: MetaStudioFilters = { ...FILTERS, format: "bo3", platform: "tcga" };
    const original = match("same-id", "Akali", "Annie", "Loss", {
      fmt: "Bo3",
      platform: "tcga",
      createdAt: NOW - DAY * 2,
    });
    const replacement = match("same-id", "Akali", "Annie", "Win", {
      fmt: "Bo3",
      platform: "tcga",
      createdAt: NOW - DAY,
    });
    const report = buildMetaStudioReport([
      original,
      replacement,
      match("atlas", "Akali", "Annie", "Win", { fmt: "Bo3", platform: "atlas" }),
      match("bo1", "Akali", "Annie", "Win", { fmt: "Bo1", platform: "tcga" }),
      match("superseded", "Akali", "Annie", "Win", { fmt: "Bo3", platform: "tcga", superseded: true }),
      match("merged", "Akali", "Annie", "Win", {
        fmt: "Bo3",
        platform: "tcga",
        mergedIntoMatchId: "replacement",
      }),
    ], filters, { now: NOW });

    expect(report.coverage.detailedRecords).toBe(1);
    expect(report.leaders[0]).toMatchObject({ wins: 1, losses: 0 });
  });

  it("removes source rows represented by a combined series before filtering", () => {
    const source = match("source-document", "Akali", "Annie", "Win", {
      fmt: "Bo1",
      localMatchId: "source-game",
    });
    const combined = match("combined-series", "Akali", "Annie", "Loss", {
      fmt: "Bo3",
      combinedFromMatchIds: ["source-game"],
    });

    const allFormats = buildMetaStudioReport([source, combined], FILTERS, { now: NOW });
    const bo1 = buildMetaStudioReport(
      [source, combined],
      { ...FILTERS, format: "bo1" },
      { now: NOW },
    );

    expect(allFormats.coverage.detailedRecords).toBe(1);
    expect(allFormats.leaders.find((leader) => leader.legend === "Akali"))
      .toMatchObject({ series: 1, wins: 0, losses: 1 });
    expect(bo1.coverage.detailedRecords).toBe(0);
    expect(bo1.leaders).toEqual([]);
  });

  it("does not double mirrors or expose them as matchup reads", () => {
    const report = buildMetaStudioReport([
      match("mirror", "Akali", "Akali", "Win"),
    ], FILTERS, { now: NOW });

    expect(report.coverage).toMatchObject({
      detailedRecords: 1,
      matrixReadyRecords: 1,
      legendAppearances: 1,
    });
    expect(report.leaders).toHaveLength(1);
    expect(report.leaders[0]).toMatchObject({
      legend: "Akali",
      series: 1,
      wins: 1,
      losses: 0,
      playRate: 100,
      matchups: [],
    });
  });

  it("marks samples below the selected threshold as insufficient", () => {
    const report = buildMetaStudioReport([
      match("one", "Akali", "Annie", "Win"),
      match("two", "Akali", "Annie", "Win"),
    ], { ...FILTERS, minSample: 5 }, { now: NOW });

    expect(report.leaders[0]?.matchups[0]).toMatchObject({
      classification: "insufficient",
      confidence: "insufficient",
    });
  });

  it("only accepts card art from RiftLite's trusted card CDN hosts", () => {
    const deckSnapshot = (imageUrl: string, cardId = "OGS-001") => ({
      legend: "Akali",
      legendKey: "akali",
      legendEntry: { qty: 1, name: "Akali", imageUrl, cardId },
      runes: [],
      battlefields: [],
      mainDeck: [],
      sideboard: [],
    });
    const malicious = buildMetaStudioReport([
      match("malicious-art", "Akali", "Annie", "Win", {
        deckSnapshot: deckSnapshot("https://tracker.example/pixel.gif", "<script>"),
      }),
    ], FILTERS, { now: NOW });
    const trustedUrl =
      "https://assets.riftatlas-workers.com/riftbound/cards/small-v2/OGS-001.webp";
    const trusted = buildMetaStudioReport([
      match("trusted-art", "Akali", "Annie", "Win", {
        deckSnapshot: deckSnapshot(trustedUrl),
      }),
    ], FILTERS, { now: NOW });

    expect(malicious.leaders[0]).toMatchObject({ cardArtUrl: "", cardId: "" });
    expect(trusted.leaders[0]).toMatchObject({
      cardArtUrl: trustedUrl,
      cardId: "OGS-001",
    });
  });

  it("suppresses rank movement when there is no usable prior-period result", () => {
    const report = buildMetaStudioReport([
      match("current-only", "Akali", "Annie", "Win"),
    ], FILTERS, {
      now: NOW,
      comparisonAvailable: true,
      comparisonWindowComplete: true,
    });

    expect(report.coverage.comparisonAvailable).toBe(false);
    expect(report.leaders[0]).toMatchObject({
      previousRank: null,
      rankDelta: null,
    });
  });

  it("anchors source windows separately from report generation time", () => {
    const openedAt = NOW + DAY * 2;
    const report = buildMetaStudioReport([
      match("source-row", "Akali", "Annie", "Win"),
    ], FILTERS, {
      now: openedAt,
      sourceAsOf: NOW,
      loadedPeriodRecords: 1,
      sourcePeriodRecords: 1,
      sourcePeriodRecordsExact: true,
    });

    expect(report.generatedAt).toBe(openedAt);
    expect(report.window.end).toBe(NOW);
    expect(report.coverage.sourceAsOf).toBe(NOW);
    expect(report.coverage.detailedRecords).toBe(1);
  });
});

describe("Meta Studio filters", () => {
  it("defaults to a weekly current-season report and validates query values", () => {
    expect(parseMetaStudioFilters(new URLSearchParams(), NOW)).toEqual(FILTERS);
    expect(parseMetaStudioFilters(new URLSearchParams(
      "range=30d&season=&format=bo3&platform=tcga&minSample=20",
    ), NOW)).toEqual({
      range: "30d",
      season: "",
      format: "bo3",
      platform: "tcga",
      minSample: 20,
    });
  });
});
