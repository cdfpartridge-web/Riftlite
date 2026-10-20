import { createElement } from "react";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplayReviewPanel } from "./ReplayReviewPanel";
import type { ReplayReviewEntry, ReplayReviewIndex } from "./review-model";

afterEach(cleanup);

function entry(eventIndex: number, gameId = "game-1", label = "Yasuo moved to Battlefield A"): ReplayReviewEntry {
  return { id: `entry-${eventIndex}`, eventIndex, atMs: eventIndex * 1_000, gameId, gameNumber: gameId === "game-1" ? 1 : 2, kind: "move", label, summary: "Recorded movement", cardNames: ["Yasuo"], searchText: `${label} move yasuo`.toLowerCase() };
}

function fixture(): ReplayReviewIndex {
  const first = entry(4);
  const second = entry(7, "game-1", "Yasuo: might changed");
  second.kind = "status";
  const last = entry(12, "game-2", "Yasuo moved to base");
  return {
    games: [{ id: "game-1", number: 1, partial: false }, { id: "game-2", number: 2, partial: true }],
    entries: [first, second, last],
    moments: [{ ...first, prompt: "What did you want to achieve?", combatId: "combat-1" }, { ...second, prompt: "What changed?" }, { ...last, prompt: "What would you try next time?" }],
    combats: [{ id: "combat-1", gameId: "game-1", gameNumber: 1, label: "Battlefield A", startEventIndex: 3, endEventIndex: 7, startMs: 3_000, endMs: 7_000, incomplete: false,
      before: { sides: [{ playerId: "p1", label: "Our side", cards: [{ id: "card-1", name: "Yasuo", equipment: ["Doran’s Blade"], statuses: ["Buff"], exhausted: false, hidden: false, might: 5 }], might: { total: 5, unitCount: 1, unknownCount: 0 } }] },
      after: { sides: [{ playerId: "p1", label: "Our side", cards: [{ id: "card-1", name: "Yasuo", equipment: ["Doran’s Blade"], statuses: ["Stunned"], exhausted: true, hidden: false, might: 3 }], might: { total: 3, unitCount: 1, unknownCount: 0 } }] },
      changes: [first, second] }],
  };
}

function open(index = fixture(), extra = {}) {
  const onSeek = vi.fn();
  const onAddNote = vi.fn();
  const onClose = vi.fn();
  const view = render(createElement(ReplayReviewPanel, { index, panelId: "review", initialGameId: "game-1", currentEventIndex: 0, range: { startMs: 0, endMs: 99_000 }, canAddNote: true, noteDraftOpen: false, onSeek, onAddNote, onClose, ...extra }));
  return { ...view, onSeek, onAddNote, onClose };
}

describe("simple replay review tools", () => {
  it("walks through exact moments, opens the existing thought pathway and retains game context", () => {
    const view = open();
    expect(view.getByText("Moment 1 of 2")).toBeInTheDocument();
    expect(view.onSeek).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Show this moment" }));
    expect(view.onSeek).toHaveBeenLastCalledWith(4);
    fireEvent.click(view.getByRole("button", { name: "Next moment →" }));
    expect(view.onSeek).toHaveBeenLastCalledWith(7);
    expect(view.getByText("Moment 2 of 2")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Add a thought" }));
    expect(view.onAddNote).toHaveBeenCalledWith(7);
    fireEvent.change(view.getByRole("combobox", { name: "Game" }), { target: { value: "game-2" } });
    expect(view.getByText("Moment 1 of 1")).toBeInTheDocument();
    expect(view.getByText(/This capture is incomplete/)).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Show this moment" }));
    expect(view.onSeek).toHaveBeenLastCalledWith(12);
  });

  it("shows captured combat cards, gear, statuses, totals and ordered seekable changes", () => {
    const view = open();
    fireEvent.click(view.getByRole("button", { name: "See combat breakdown →" }));
    expect(view.getByRole("tab", { name: "Combat" })).toHaveAttribute("aria-selected", "true");
    expect(view.getByText("5 might")).toBeInTheDocument();
    expect(view.getByText("Gear: Doran’s Blade")).toBeInTheDocument();
    expect(view.getByText("Buff")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Show before on board" }));
    expect(view.onSeek).toHaveBeenLastCalledWith(3);
    fireEvent.click(view.getByRole("button", { name: /^After$/ }));
    expect(view.getByText("3 might")).toBeInTheDocument();
    expect(view.getByText("Exhausted · Stunned")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Show after on board" }));
    expect(view.onSeek).toHaveBeenLastCalledWith(7);
    const changes = view.container.querySelectorAll("[data-review-event]");
    expect(Array.from(changes).map((button) => button.getAttribute("data-review-event"))).toEqual(["4", "7"]);
    fireEvent.click(changes[0]);
    expect(view.onSeek).toHaveBeenLastCalledWith(4);
  });

  it("searches by card/action with separate game and action filters and useful empty states", () => {
    const view = open();
    fireEvent.click(view.getByRole("tab", { name: "Search" }));
    const query = view.getByRole("searchbox", { name: "Card or action" });
    fireEvent.change(query, { target: { value: "yasuo" } });
    expect(view.getByText(/2 recorded actions matching/)).toBeInTheDocument();
    fireEvent.change(view.getByRole("combobox", { name: "Action type" }), { target: { value: "status" } });
    expect(view.getByText(/1 recorded action matching/)).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: /Yasuo: might changed/ }));
    expect(view.onSeek).toHaveBeenLastCalledWith(7);
    fireEvent.change(query, { target: { value: "missing-card" } });
    expect(view.getByRole("heading", { name: "No matching actions" })).toBeInTheDocument();
    fireEvent.change(query, { target: { value: "" } });
    fireEvent.change(view.getByRole("combobox", { name: "Action type" }), { target: { value: "all" } });
    fireEvent.change(view.getByRole("combobox", { name: "Game" }), { target: { value: "game-2" } });
    expect(view.getByText(/1 recorded action · select one to jump/)).toBeInTheDocument();
    fireEvent.click(view.getByRole("tab", { name: "Combat" }));
    expect(view.getByRole("heading", { name: "No battlefield contests captured" })).toBeInTheDocument();
  });

  it("bounds large result lists and restricts review to the active clip", () => {
    const index = fixture();
    index.entries = Array.from({ length: 90 }, (_, position) => entry(position + 1));
    const view = open(index, { range: { startMs: 5_000, endMs: 85_000 } });
    fireEvent.click(view.getByRole("tab", { name: "Search" }));
    expect(view.container.querySelectorAll("[data-review-event]")).toHaveLength(40);
    expect(view.getByText(/81 recorded actions/)).toBeInTheDocument();
    expect(view.container.querySelector("[data-review-event='4']")).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Show 40 more" }));
    expect(view.container.querySelectorAll("[data-review-event]")).toHaveLength(80);
    fireEvent.click(view.getByRole("button", { name: "Show 40 more" }));
    expect(view.container.querySelectorAll("[data-review-event]")).toHaveLength(81);
    expect(view.queryByRole("button", { name: "Show 40 more" })).not.toBeInTheDocument();
  });

  it("supports keyboard tabs and closing without leaking arrow shortcuts to replay playback", () => {
    const view = open();
    const windowKeys = vi.fn();
    window.addEventListener("keydown", windowKeys);
    const walkthrough = view.getByRole("tab", { name: "Walkthrough" });
    walkthrough.focus();
    fireEvent.keyDown(walkthrough, { key: "ArrowRight" });
    const combat = view.getByRole("tab", { name: "Combat" });
    expect(combat).toHaveFocus();
    expect(combat).toHaveAttribute("aria-selected", "true");
    expect(windowKeys).not.toHaveBeenCalled();
    fireEvent.keyDown(combat, { key: "End" });
    expect(view.getByRole("tab", { name: "Search" })).toHaveFocus();
    expect(within(view.getByRole("tabpanel")).getByRole("searchbox")).toBeInTheDocument();
    fireEvent.keyDown(view.getByRole("searchbox"), { key: "Escape" });
    expect(view.onClose).toHaveBeenCalledOnce();
    window.removeEventListener("keydown", windowKeys);
  });

  it("respects shared-note read-only state and preserves an existing draft", () => {
    const shared = open(fixture(), { canAddNote: false });
    expect(shared.queryByRole("button", { name: "Add a thought" })).not.toBeInTheDocument();
    shared.unmount();
    const draft = open(fixture(), { noteDraftOpen: true });
    fireEvent.click(draft.getByRole("button", { name: "Resume your note" }));
    expect(draft.onAddNote).toHaveBeenCalledWith(4);
  });
});
