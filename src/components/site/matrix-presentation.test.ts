import { describe, expect, it } from "vitest";

import type { MatchupCaptureBreakdown, MatchupCell } from "@/lib/types";

import {
  buildMatrixCellPresentations,
  matrixCellKey,
  matrixCellTooltip,
} from "./matrix-presentation";

function breakdown(
  wins: number,
  losses: number,
  draws = 0,
): MatchupCaptureBreakdown {
  const decisiveGames = wins + losses;
  return {
    wins,
    losses,
    draws,
    decisiveGames,
    totalGames: decisiveGames + draws,
    winRate: decisiveGames ? Number(((wins / decisiveGames) * 100).toFixed(1)) : 0,
  };
}

function pooledCell(
  myLegend: string,
  oppLegend: string,
  directCaptures: MatchupCaptureBreakdown,
  reverseCaptures: MatchupCaptureBreakdown,
): MatchupCell {
  const wins = directCaptures.wins + reverseCaptures.losses;
  const losses = directCaptures.losses + reverseCaptures.wins;
  const draws = directCaptures.draws + reverseCaptures.draws;
  const decisiveGames = wins + losses;
  return {
    myLegend,
    oppLegend,
    wins,
    losses,
    draws,
    decisiveGames,
    totalGames: directCaptures.totalGames + reverseCaptures.totalGames,
    winRate: decisiveGames ? Number(((wins / decisiveGames) * 100).toFixed(1)) : 0,
    directCaptures,
    reverseCaptures,
  };
}

describe("matrix presentation contract", () => {
  it("uses the pooled row-perspective result supplied by the aggregate", () => {
    const direct = breakdown(10, 1);
    const reverse = breakdown(12, 10);
    const source = pooledCell("Rek'Sai", "Kennen", direct, reverse);
    const presentation = buildMatrixCellPresentations([source]).get(
      matrixCellKey("Rek'Sai", "Kennen"),
    );

    expect(presentation?.pooled).toBe(source);
    expect(presentation?.pooled).toMatchObject({
      wins: 20,
      losses: 13,
      decisiveGames: 33,
      totalGames: 33,
      winRate: 60.6,
    });
  });

  it("labels reverse captures in the column pilot's native perspective", () => {
    const presentation = buildMatrixCellPresentations([
      pooledCell("Rek'Sai", "Kennen", breakdown(10, 1), breakdown(12, 10)),
    ]).get(matrixCellKey("Rek'Sai", "Kennen"));

    expect(presentation?.direct).toMatchObject({
      pilotLegend: "Rek'Sai",
      opponentLegend: "Kennen",
      wins: 10,
      losses: 1,
    });
    expect(presentation?.reverse).toMatchObject({
      pilotLegend: "Kennen",
      opponentLegend: "Rek'Sai",
      wins: 12,
      losses: 10,
    });
  });

  it("keeps the pooled and both directional sample sizes in the tooltip", () => {
    const presentation = buildMatrixCellPresentations([
      pooledCell("Rek'Sai", "Kennen", breakdown(10, 1), breakdown(12, 10)),
    ]).get(matrixCellKey("Rek'Sai", "Kennen"));

    expect(presentation).toBeDefined();
    const tooltip = matrixCellTooltip(presentation!);
    expect(tooltip).toContain("Pooled for Rek'Sai: 60.6% vs Kennen from 33 captures");
    expect(tooltip).toContain("Rek'Sai pilots: 10W, 1L, 0D from 11 captures (90.9%)");
    expect(tooltip).toContain("Kennen pilots: 12W, 10L, 0D from 22 captures (54.5%)");
  });
});
