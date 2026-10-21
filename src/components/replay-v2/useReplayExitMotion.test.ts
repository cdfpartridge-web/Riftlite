import { createElement, useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayActionEvent } from "@/lib/replay-v2";
import { useReplayExitMotion } from "./useReplayExitMotion";
import type { ReplayMovementSource } from "./card-movement-cues";

type TestAnimation = Animation & { duration: number };
let animations: TestAnimation[];
let reduced: boolean;
let reducedListeners: Set<() => void>;
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");

function action(index: number, from = "base", to = "trash", owner = "self"): ReplayActionEvent {
  return {
    id: `event-${index}`, index, at: index * 100, atMs: index * 100, sourceMessageId: `packet-${index}`, gameId: "game-1",
    kind: "action", actionType: "authoritative_patch_commit", action: {},
    confirmation: { status: "confirmed", authority: "authoritative_patch_commit", correlation: "intent_not_observed", commitMessageId: `commit-${index}` },
    patch: { operations: index === 1 ? [{ id: "move", op: "zone_move", cardId: "card-1", from: { playerId: owner, zone: from }, to: { playerId: owner, zone: to, index: 0 } }] : [] },
  };
}
const defaultReplay: ReplayMovementSource = { events: [action(0), action(1), action(2)], series: { perspectivePlayerId: "self" } };
type HarnessProps = { index: number; speed?: number; epoch?: number; enabled?: boolean; suppressed?: boolean; gameId?: string; replay?: ReplayMovementSource; owner?: string; missingPile?: boolean; duplicate?: boolean };
function Harness({ index, speed = 1, epoch = 0, enabled = true, suppressed = false, gameId = "game-1", replay = defaultReplay, owner = "self", missingPile, duplicate }: HarnessProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReplayExitMotion({ rootRef, replay, eventIndex: index, gameId, speed, suppressMotion: suppressed, enabled, motionEpoch: epoch });
  const card = (key: string) => createElement("button", { key, "data-card-id": "card-1", "data-card-motion-id": "card-1", "aria-label": "Private metadata", "data-card-code": "PRIVATE" },
    createElement("span", { className: "rendered-card-face", id: "do-not-clone-id", "aria-label": "Private metadata" },
      createElement("img", { src: "/already-rendered-card.png", alt: "Private name", draggable: false }),
    ),
  );
  // eslint-disable-next-line react-hooks/refs -- React attaches this test-host ref during commit; createElement does not read it.
  return createElement("div", { ref: rootRef, "data-test-root": "true" },
    createElement("div", { "data-player-id": owner }, index === 0 ? [card("one"), ...(duplicate ? [card("two")] : [])] : null),
    missingPile ? null : createElement("div", { "data-replay-pile-player-id": owner, "data-replay-pile-zone": "discard" }),
    missingPile ? null : createElement("div", { "data-replay-pile-player-id": owner, "data-replay-pile-zone": "runeDeck" }),
  );
}

beforeEach(() => {
  animations = [];
  reduced = false;
  reducedListeners = new Set();
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener: (_: string, fn: () => void) => reducedListeners.add(fn), removeEventListener: (_: string, fn: () => void) => reducedListeners.delete(fn) }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const values = this.hasAttribute("data-test-root") ? [0, 0, 1590, 962] : this.hasAttribute("data-card-id") ? [200, 300, 90, 126] : this.hasAttribute("data-replay-pile-zone") ? [1300, 700, 60, 84] : [0, 0, 0, 0];
    return { x: values[0], y: values[1], left: values[0], top: values[1], width: values[2], height: values[3], right: values[0] + values[2], bottom: values[1] + values[3], toJSON() {} };
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, writable: true, value: vi.fn((_frames, options) => {
    const animation = {
      duration: options.duration, playbackRate: 1, onfinish: null, oncancel: null, playState: "running",
      pause: vi.fn(), play: vi.fn(), cancel: vi.fn(), updatePlaybackRate: vi.fn(),
    } as unknown as TestAnimation;
    animation.cancel = vi.fn(() => animation.oncancel?.call(animation, {} as AnimationPlaybackEvent));
    animation.updatePlaybackRate = vi.fn((rate: number) => { animation.playbackRate = rate; });
    animations.push(animation);
    return animation;
  }) });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

describe("useReplayExitMotion", () => {
  it("flies the previous rendered face to trash and removes interactive and identity attributes", () => {
    const view = render(createElement(Harness, { index: 0 }));
    view.rerender(createElement(Harness, { index: 1 }));
    const ghost = view.container.querySelector<HTMLElement>("[data-replay-exit-motion=trash]")!;
    expect(ghost).not.toBeNull();
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    expect(ghost).toHaveAttribute("inert");
    expect(ghost.querySelector("button, [data-card-id], [data-card-motion-id], [id], [aria-label], [draggable]")).toBeNull();
    expect(ghost.querySelector("img")).toHaveAttribute("alt", "");
    expect(ghost.style.left).toBe("200px");
    expect(animations[0].duration).toBe(480);
    act(() => animations[0].onfinish?.call(animations[0], {} as AnimationPlaybackEvent));
    expect(ghost.isConnected).toBe(false);
  });

  it("keeps an opponent hand card a neutral back even when canonical/private data knows its art", () => {
    const replay = { ...defaultReplay, events: [action(0), action(1, "hand", "trash", "opponent")] };
    const view = render(createElement(Harness, { index: 0, replay, owner: "opponent" }));
    view.rerender(createElement(Harness, { index: 1, replay, owner: "opponent" }));
    const ghost = view.container.querySelector("[data-replay-exit-motion]")!;
    expect(ghost.textContent).toBe("R");
    expect(ghost.querySelector("img")).toBeNull();
    expect(ghost.innerHTML).not.toMatch(/Private|PRIVATE|already-rendered/);
  });

  it("animates rune recycling using the same-player rune deck anchor", () => {
    const replay = { ...defaultReplay, events: [action(0), action(1, "runeArea", "runeDeck")] };
    const view = render(createElement(Harness, { index: 0, replay }));
    view.rerender(createElement(Harness, { index: 1, replay }));
    expect(view.container.querySelector("[data-replay-exit-motion=rune-recycle]")).not.toBeNull();
  });

  it("does not duplicate a ghost for no-op packets or speed changes, and retimes the existing animation", () => {
    const view = render(createElement(Harness, { index: 0 }));
    view.rerender(createElement(Harness, { index: 1 }));
    view.rerender(createElement(Harness, { index: 2 }));
    view.rerender(createElement(Harness, { index: 2, speed: 4 }));
    expect(animations).toHaveLength(1);
    expect(animations[0].updatePlaybackRate).toHaveBeenCalledWith(4);
    expect(view.container.querySelectorAll("[data-replay-exit-motion]")).toHaveLength(1);
  });

  it("does not delete a paused ghost on a wall-clock timer", () => {
    vi.useFakeTimers();
    try {
      const view = render(createElement(Harness, { index: 0 }));
      view.rerender(createElement(Harness, { index: 1 }));
      animations[0].pause();
      act(() => vi.advanceTimersByTime(60_000));
      expect(view.container.querySelector("[data-replay-exit-motion]")).not.toBeNull();
      expect(animations[0].cancel).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it.each([{ epoch: 1 }, { enabled: false }, { suppressed: true }, { gameId: "game-2" }, { index: 0 }])("cleans up on playback discontinuity %j", (change) => {
    const view = render(createElement(Harness, { index: 0 }));
    view.rerender(createElement(Harness, { index: 1 }));
    view.rerender(createElement(Harness, { index: 1, ...change }));
    expect(view.container.querySelector("[data-replay-exit-motion]")).toBeNull();
    expect(animations[0].cancel).toHaveBeenCalledOnce();
  });

  it("suppresses initial/deep-link layout and cleans active ghosts when reduced motion changes", () => {
    const view = render(createElement(Harness, { index: 1 }));
    expect(animations).toHaveLength(0);
    view.rerender(createElement(Harness, { index: 0 }));
    view.rerender(createElement(Harness, { index: 1 }));
    act(() => { reduced = true; reducedListeners.forEach((listener) => listener()); });
    expect(view.container.querySelector("[data-replay-exit-motion]")).toBeNull();
    view.rerender(createElement(Harness, { index: 0 }));
    view.rerender(createElement(Harness, { index: 1 }));
    expect(animations).toHaveLength(1);
  });

  it.each([{ missingPile: true }, { duplicate: true }])("skips missing/ambiguous geometry safely: %j", (options) => {
    const view = render(createElement(Harness, { index: 0, ...options }));
    view.rerender(createElement(Harness, { index: 1, ...options }));
    expect(animations).toHaveLength(0);
  });

  it("cancels outstanding animations and removes media-query listeners on unmount", () => {
    const view = render(createElement(Harness, { index: 0 }));
    view.rerender(createElement(Harness, { index: 1 }));
    const ghost = view.container.querySelector("[data-replay-exit-motion]")!;
    view.unmount();
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(ghost.isConnected).toBe(false);
    expect(reducedListeners.size).toBe(0);
  });
});
