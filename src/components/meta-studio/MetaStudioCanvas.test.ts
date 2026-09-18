import { createElement } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  MetaStudioLeader,
  MetaStudioMatchup,
  MetaStudioReport,
  MetaStudioSplit,
} from "@/lib/community/meta-studio";

import { MatrixScene, MetaStudioCanvas, MetaStudioDateControls } from "./MetaStudioCanvas";
import { buildMetaStudioReport, type MetaStudioFilters } from "@/lib/community/meta-studio";

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


const DATE_FILTERS: MetaStudioFilters = { range: "30d", season: "", format: "all", platform: "all", minSample: 5 };

describe("Meta Studio report dates", () => {
  it("keeps individual date edits local until valid Apply and includes browser timezone", () => {
    const onChange = vi.fn();
    const view = render(createElement(MetaStudioDateControls, { filters: DATE_FILTERS, onChange }));
    fireEvent.change(view.getByLabelText("Window"), { target: { value: "date" } });
    fireEvent.change(view.getByLabelText("Selected date"), { target: { value: "2026-09-08" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(view.getByRole("status")).toHaveTextContent("Date selection not applied");
    fireEvent.click(view.getByRole("button", { name: "Apply dates" }));
    expect(onChange).toHaveBeenCalledWith({ ...DATE_FILTERS, range: "date", from: "2026-09-08", to: "2026-09-08", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  });

  it("blocks incomplete and reversed ranges without requesting or relabelling report data", () => {
    const onChange = vi.fn();
    const view = render(createElement(MetaStudioDateControls, { filters: DATE_FILTERS, onChange }));
    fireEvent.change(view.getByLabelText("Window"), { target: { value: "custom" } });
    fireEvent.change(view.getByLabelText("From"), { target: { value: "2026-09-08" } });
    fireEvent.change(view.getByLabelText("To"), { target: { value: "2026-09-07" } });
    expect(view.getByRole("alert")).toHaveTextContent("End date must be on or after start date");
    expect(view.getByRole("button", { name: "Apply dates" })).toBeDisabled();
    fireEvent.change(view.getByLabelText("To"), { target: { value: "" } });
    expect(view.getByRole("alert")).toHaveTextContent("Choose an end date");
    expect(view.getByRole("button", { name: "Apply dates" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(view.getByLabelText("To"), { target: { value: "2026-09-09" } });
    fireEvent.click(view.getByRole("button", { name: "Apply dates" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ range: "custom", from: "2026-09-08", to: "2026-09-09" }));
  });

  it("preserves rolling windows and clears explicit dates without resetting other filters", () => {
    const onChange = vi.fn();
    const filters: MetaStudioFilters = { ...DATE_FILTERS, format: "bo3", range: "date", from: "2026-09-08", to: "2026-09-08", timeZone: "Europe/London" };
    const view = render(createElement(MetaStudioDateControls, { filters, onChange }));
    for (const label of ["Last 24 hours", "Last 7 days", "Last 14 days", "Last 30 days"]) {
      expect(view.getByRole("option", { name: label })).toBeInTheDocument();
    }
    fireEvent.click(view.getByRole("button", { name: "Clear dates" }));
    expect(view.getByLabelText("Window")).toHaveValue("30d");
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, range: "30d", from: undefined, to: undefined, timeZone: undefined });
    fireEvent.change(view.getByLabelText("Window"), { target: { value: "14d" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, range: "14d", from: undefined, to: undefined, timeZone: undefined });
  });

  it("cancels an unapplied date draft locally without a redundant loading request", () => {
    const onChange = vi.fn();
    const view = render(createElement(MetaStudioDateControls, { filters: DATE_FILTERS, onChange }));
    fireEvent.change(view.getByLabelText("Window"), { target: { value: "date" } });
    fireEvent.click(view.getByRole("button", { name: "Clear dates" }));
    expect(view.getByLabelText("Window")).toHaveValue("30d");
    expect(view.queryByLabelText("Selected date")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(view.getByLabelText("Window"), { target: { value: "custom" } });
    fireEvent.change(view.getByLabelText("Window"), { target: { value: "30d" } });
    expect(view.queryByLabelText("From")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("retains usable controls and accurate timezone labels when selected dates have no rows", () => {
    const filters: MetaStudioFilters = { ...DATE_FILTERS, range: "date", from: "2026-09-18", to: "2026-09-18", timeZone: "Pacific/Auckland" };
    const report = buildMetaStudioReport([], filters, { now: Date.parse("2026-09-18T12:00:00Z") });
    const onFiltersChange = vi.fn();
    const view = render(createElement(MetaStudioCanvas, {
      report, filters, loading: false, error: "", preview: false, onFiltersChange,
      onOpenLiveTakeover: vi.fn(), onOpenCreatorVideos: vi.fn(), onLock: vi.fn(), onRefresh: vi.fn(),
    }));
    expect(view.getByText("Applied report: 18 Sept 2026 — 18 Sept 2026 · Pacific/Auckland")).toBeInTheDocument();
    expect(view.getByLabelText("Selected date")).toHaveValue("2026-09-18");
    expect(view.getByText(/available retained community history only/)).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Clear dates" })).toBeEnabled();
    fireEvent.click(view.getByRole("button", { name: "Reset to a broad report" }));
    expect(onFiltersChange).toHaveBeenCalledWith(DATE_FILTERS);
  });
});
