import { createElement } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  MatchupCaptureBreakdown,
  MatchupCell,
  MatrixView,
} from "@/lib/types";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const imageProps = { ...props };
    delete imageProps.priority;
    return createElement("img", imageProps);
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) =>
    createElement("a", { ...props, href }, children as React.ReactNode),
}));

import { MatrixBrowser } from "./matrix-browser";

function breakdown(wins: number, losses: number): MatchupCaptureBreakdown {
  const decisiveGames = wins + losses;
  return {
    wins,
    losses,
    draws: 0,
    decisiveGames,
    totalGames: decisiveGames,
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
  const decisiveGames = wins + losses;
  return {
    myLegend,
    oppLegend,
    wins,
    losses,
    draws: 0,
    decisiveGames,
    totalGames: directCaptures.totalGames + reverseCaptures.totalGames,
    winRate: Number(((wins / decisiveGames) * 100).toFixed(1)),
    directCaptures,
    reverseCaptures,
  };
}

describe("MatrixBrowser", () => {
  it("renders pooled cells while disclosing both native pilot cohorts", () => {
    const direct = breakdown(10, 1);
    const reverse = breakdown(12, 10);
    const matrix: MatrixView = {
      rows: ["Rek'Sai", "Kennen"],
      columns: ["Rek'Sai", "Kennen"],
      cells: [
        pooledCell("Rek'Sai", "Kennen", direct, reverse),
        pooledCell("Kennen", "Rek'Sai", reverse, direct),
      ],
      aggregationMethod: "symmetric-v1",
      matrixReadyMatchCount: 33,
      sourceMatchCount: 33,
      detailMatchCount: 33,
    };

    const view = render(createElement(MatrixBrowser, { matrix, matches: [] }));
    const pooledButton = view.getByTitle(
      "Pooled for Rek'Sai: 60.6% vs Kennen from 33 captures. Native pilot records: Rek'Sai pilots: 10W, 1L, 0D from 11 captures (90.9%); Kennen pilots: 12W, 10L, 0D from 22 captures (54.5%).",
    );

    expect(pooledButton).toHaveTextContent("60.6%");
    expect(pooledButton).toHaveAttribute("aria-label", pooledButton.getAttribute("title"));
    expect(view.container).toHaveTextContent("33 matrix-ready capture records");
    expect(view.container).toHaveTextContent("60.6% overall");
    expect(view.container).toHaveTextContent("39.4% overall");
    expect(view.container).toHaveTextContent("10W / 1L / 0D");
    expect(view.container).toHaveTextContent("12W / 10L / 0D");
  });

  it("leaves populated mirror matchups blank while retaining the legend's overall rate", () => {
    const direct = breakdown(8, 2);
    const matrix: MatrixView = {
      rows: ["Kennen"],
      columns: ["Kennen"],
      cells: [pooledCell("Kennen", "Kennen", direct, breakdown(0, 0))],
      aggregationMethod: "symmetric-v1",
      matrixReadyMatchCount: 10,
      sourceMatchCount: 10,
      detailMatchCount: 10,
    };

    const view = render(createElement(MatrixBrowser, { matrix, matches: [] }));
    const mirror = view.getByLabelText("Kennen mirror matchup hidden");

    expect(mirror).toHaveTextContent("");
    expect(mirror.querySelector("button")).toBeNull();
    expect(mirror.querySelector("[data-matrix-mirror]")).toBeInTheDocument();
    expect(view.container).toHaveTextContent("80.0% overall");
  });
});
