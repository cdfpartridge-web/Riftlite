import { createElement } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  MetaStudioLeader,
  MetaStudioMatchup,
  MetaStudioReport,
  MetaStudioSplit,
} from "@/lib/community/meta-studio";

import { MatrixScene } from "./MetaStudioCanvas";

function split(winRate: number): MetaStudioSplit {
  return {
    series: 10,
    wins: winRate / 10,
    losses: 10 - winRate / 10,
    draws: 0,
    decisiveSeries: 10,
    winRate,
  };
}

function matchup(opponentLegend: string, winRate: number): MetaStudioMatchup {
  return {
    ...split(winRate),
    opponentLegend,
    first: split(winRate),
    second: split(winRate),
    directCaptures: split(winRate),
    reverseCaptures: split(100 - winRate),
    classification: winRate >= 55 ? "favorable" : winRate <= 45 ? "unfavorable" : "even",
    confidence: "medium",
  };
}

function leader(
  legend: string,
  rank: number,
  winRate: number,
  matchups: MetaStudioMatchup[],
): MetaStudioLeader {
  return {
    ...split(winRate),
    rank,
    previousRank: null,
    rankDelta: null,
    legend,
    playRate: 50,
    adjustedWinRate: winRate,
    first: split(winRate),
    second: split(winRate),
    favorableMatchups: 0,
    evenMatchups: 0,
    unfavorableMatchups: 0,
    matchupCoverage: matchups.length,
    cardArtUrl: "",
    cardId: "",
    matchups,
  };
}

describe("Meta Studio matchup matrix", () => {
  it("blanks mirror cells and shows overall legend win rates on the row cards", () => {
    const report = {
      leaders: [
        leader("Ahri", 1, 60, [matchup("Ahri", 80), matchup("Jinx", 60)]),
        leader("Jinx", 2, 40, [matchup("Ahri", 40), matchup("Jinx", 70)]),
      ],
    } as MetaStudioReport;
    const view = render(createElement(MatrixScene, {
      report,
      selection: null,
      onPreview: vi.fn(),
      onLeave: vi.fn(),
      onPin: vi.fn(),
    }));

    expect(view.getByText("60.0% overall")).toBeInTheDocument();
    expect(view.getByText("40.0% overall")).toBeInTheDocument();
    expect(view.getByLabelText("Ahri mirror matchup hidden")).toHaveTextContent("");
    expect(view.getByLabelText("Jinx mirror matchup hidden")).toHaveTextContent("");
    expect(view.queryByRole("button", { name: /Pooled for Ahri vs Ahri/i })).toBeNull();
    expect(view.getByRole("button", { name: /Pooled for Ahri vs Jinx/i })).toBeInTheDocument();
    expect(view.getByText("TOP-12 POOLED FIELD")).toBeInTheDocument();
    expect(view.getByText("Symmetric matchup matrix")).toBeInTheDocument();
    expect(view.getByText("Ahri pilots")).toBeInTheDocument();
    expect(view.getByText("Jinx pilots")).toBeInTheDocument();
    expect(view.getByText("6W / 4L · n=10")).toBeInTheDocument();
    expect(view.getByText("4W / 6L · n=10")).toBeInTheDocument();
  });
});
