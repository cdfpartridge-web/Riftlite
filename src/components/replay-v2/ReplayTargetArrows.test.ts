import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayState } from "@/lib/replay-v2/types";
import { ReplayTargetArrows, replayArrowElement } from "./ReplayTargetArrows";

let board: HTMLDivElement;
let callbacks: Map<number, FrameRequestCallback>;
let frameId: number;
const rectangle = (x: number, y: number, width = 80, height = 110) => ({
  x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() {},
});
function anchor(id: string, kind: "board" | "chain", x: number) {
  const element = document.createElement("div");
  element.dataset.cardId = id;
  element.dataset.replayCardAnchor = kind;
  element.getBoundingClientRect = () => rectangle(x, 200);
  board.append(element);
  return element;
}
function state(): ReplayState {
  const card = (id: string) => ({ id, name: "Public card", fields: {} });
  return {
    seriesId: "series", gameId: "game", gameOrdinal: 1, phase: "in_game", appliedEventIndex: 3,
    chat: [], log: [],
    room: { phase: "in_game", rawPhase: "game", gameNumber: 1, fields: { targetArrowsByPlayer: {
      own: [{ sourceCardId: "a", targetCardId: "b", sourceAnchor: "board", targetAnchor: "board" }],
      enemy: [{ sourceCardId: "a", targetCardId: "b", sourceAnchor: "chain", targetAnchor: "board" }],
    } } },
    players: {
      own: { id: "own", name: "One", fields: {}, boardFields: {}, zones: { base: [card("a")] } },
      enemy: { id: "enemy", name: "Two", fields: {}, boardFields: {}, zones: { base: [card("b")] } },
    },
    chain: [{ id: "entry", fields: { card: { id: "a", name: "Public spell" } } }],
  };
}
function props(replayState = state()) {
  return { rootRef: { current: board }, state: replayState, eventIndex: 3, perspectivePlayerId: "own", speed: 1, playing: false, suppressed: false };
}
function measureFrame() {
  act(() => {
    const pending = [...callbacks];
    callbacks.clear();
    for (const [, callback] of pending) callback(performance.now());
  });
}
beforeEach(() => {
  board = document.createElement("div");
  board.getBoundingClientRect = () => rectangle(0, 0, 1590, 962);
  Object.defineProperty(board, "offsetWidth", { value: 1590 });
  document.body.append(board);
  callbacks = new Map(); frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  anchor("a", "board", 100); anchor("a", "chain", 400); anchor("b", "board", 800);
});
afterEach(() => { cleanup(); board.remove(); vi.unstubAllGlobals(); });

describe("captured target arrows", () => {
  it.each([
    [400, 0], [-400, 0], [0, 400], [0, -400],
    [400, 300], [-400, 300], [400, -300], [-400, -300], [12, -12],
  ])("points the arrowhead toward the target at offset (%i, %i)", (dx, dy) => {
    replayArrowElement(board, "a", "board")!.getBoundingClientRect = () => rectangle(600, 400);
    replayArrowElement(board, "b", "board")!.getBoundingClientRect = () => rectangle(600 + dx, 400 + dy);
    const view = render(createElement(ReplayTargetArrows, props()));
    measureFrame();
    const line = view.container.querySelector('[data-recorded-target-arrow="ours"] path[marker-end]')!;
    const coordinates = line.getAttribute("d")!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number);
    expect(coordinates).toHaveLength(8);
    expect(coordinates.every(Number.isFinite)).toBe(true);
    const tangentX = coordinates[6] - coordinates[4];
    const tangentY = coordinates[7] - coordinates[5];
    // Marker rotation is determined by the final tangent, not the overall chord.
    const alignment = (tangentX * dx + tangentY * dy) / (Math.hypot(tangentX, tangentY) * Math.hypot(dx, dy));
    expect(alignment).toBeCloseTo(1, 10);
    const markerId = line.getAttribute("marker-end")!.slice(5, -1);
    expect([...view.container.querySelectorAll("marker")].find(marker => marker.id === markerId)).toHaveAttribute("orient", "auto");
  });

  it("measures an initially mounted board after its parent ref attaches", () => {
    const rootRef: { current: HTMLDivElement | null } = { current: null };
    const view = render(createElement("div", { ref: (element: HTMLDivElement | null) => {
      rootRef.current = element;
      if (!element) return;
      element.getBoundingClientRect = board.getBoundingClientRect;
      Object.defineProperty(element, "offsetWidth", { configurable: true, value: 1590 });
      for (const child of [...board.children]) element.append(child);
    } }, createElement(ReplayTargetArrows, { ...props(), rootRef })));
    measureFrame();
    expect(view.getByRole("img", { name: "2 recorded targeting arrows" })).toBeInTheDocument();
  });

  it("uses the correct board or chain copy and distinguishes the two players", () => {
    const view = render(createElement(ReplayTargetArrows, props()));
    measureFrame();
    const own = view.container.querySelector('[data-recorded-target-arrow="ours"]');
    const enemy = view.container.querySelector('[data-recorded-target-arrow="theirs"]');
    expect(own?.querySelector("circle")).toHaveAttribute("cx", "140");
    expect(enemy?.querySelector("circle")).toHaveAttribute("cx", "440");
    expect(view.getByRole("img", { name: "2 recorded targeting arrows" })).toBeInTheDocument();
    expect(view.getByText("Our arrows")).toBeInTheDocument();
    expect(view.getByText("Enemy arrows")).toBeInTheDocument();
  });

  it("clears immediately on authoritative clear, scene entry or missing public endpoints", () => {
    const initial = props();
    const view = render(createElement(ReplayTargetArrows, initial));
    measureFrame();
    const cleared = state(); cleared.room.fields.targetArrowsByPlayer = {};
    view.rerender(createElement(ReplayTargetArrows, { ...initial, state: cleared, eventIndex: 4 }));
    expect(view.queryByRole("img")).toBeNull();
    view.rerender(createElement(ReplayTargetArrows, { ...initial, suppressed: true }));
    measureFrame(); expect(view.queryByRole("img")).toBeNull();
    const hidden = state(); hidden.players.enemy.zones.base[0].isPlaceholder = true;
    view.rerender(createElement(ReplayTargetArrows, { ...initial, state: hidden }));
    measureFrame(); expect(view.queryByRole("img")).toBeNull();
  });

  it("remeasures positions when the perspective changes at the same event", () => {
    const initial = props();
    const view = render(createElement(ReplayTargetArrows, initial));
    measureFrame();
    const source = replayArrowElement(board, "a", "board")!;
    source.getBoundingClientRect = () => rectangle(300, 600);
    view.rerender(createElement(ReplayTargetArrows, { ...initial, perspectivePlayerId: "enemy" }));
    measureFrame();
    expect(view.container.querySelector('[data-recorded-target-arrow="theirs"] circle')).toHaveAttribute("cx", "340");
    expect(view.container.querySelector('[data-recorded-target-arrow="theirs"] circle')).toHaveAttribute("cy", "655");
  });

  it("follows a resumed card animation even before the next replay event", () => {
    const initial = props();
    const view = render(createElement(ReplayTargetArrows, initial));
    measureFrame();
    const source = replayArrowElement(board, "a", "board")!;
    source.getBoundingClientRect = () => rectangle(200, 300);
    view.rerender(createElement(ReplayTargetArrows, { ...initial, playing: true }));
    measureFrame();
    expect(view.container.querySelector('[data-recorded-target-arrow="ours"] circle')).toHaveAttribute("cx", "240");
    expect(view.container.querySelector('[data-recorded-target-arrow="ours"] circle')).toHaveAttribute("cy", "355");
  });

  it("resolves exact marker IDs without using them as selectors", () => {
    const marker = document.createElement("div");
    marker.dataset.replayArrowAnchorId = 'base-area-marker:p"1';
    board.append(marker);
    expect(replayArrowElement(board, 'base-area-marker:p"1', "board")).toBe(marker);
    expect(replayArrowElement(board, 'base-area-marker:p"1', "chain")).toBeUndefined();
  });

  it("uses unique SVG marker IDs when more than one player is mounted", () => {
    const first = render(createElement(ReplayTargetArrows, props()));
    const second = render(createElement(ReplayTargetArrows, props()));
    measureFrame();
    const firstIds = [...first.container.querySelectorAll("marker")].map(element => element.id);
    const secondIds = [...second.container.querySelectorAll("marker")].map(element => element.id);
    expect(firstIds).toHaveLength(2);
    expect(secondIds.every(id => !firstIds.includes(id))).toBe(true);
    first.unmount(); second.unmount();
    expect(callbacks.size).toBe(0);
  });
});
