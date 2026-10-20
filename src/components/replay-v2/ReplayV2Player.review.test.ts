import { createElement } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./useReplayAccountReview", () => import("./__fixtures__/signed-out-review-account"));
import { normalizeRawCaptureV1, type CanonicalReplayV2 } from "@/lib/replay-v2";
import { syntheticBo3Capture } from "@/lib/replay-v2/__fixtures__/synthetic-captures";

vi.mock("firebase/auth", () => ({ getAuth: () => ({ authStateReady: async () => undefined, currentUser: null }) }));
vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));
vi.mock("./review-model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./review-model")>();
  return { ...actual, buildReplayReview: vi.fn(actual.buildReplayReview) };
});
import { buildReplayReview } from "./review-model";
import { ReplayV2Player } from "./ReplayV2Player";
import { replayNotesStorageKey } from "./replay-notes";

const replayId = "rp_review_tools";
const preferenceKey = "riftlite.replay.details-hidden.v1";
let replay: CanonicalReplayV2;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", `/replays/${replayId}?t=2.5`);
  replay = normalizeRawCaptureV1(syntheticBo3Capture());
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), { headers: { "content-type": "application/json" }, status: 200 })));
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => undefined;
  if (!HTMLElement.prototype.animate) HTMLElement.prototype.animate = () => ({ pause() {}, play() {} }) as Animation;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); window.history.replaceState({}, "", "/"); });

async function open() {
  const view = render(createElement(ReplayV2Player, { replayId }));
  await view.findByRole("slider", { name: "Replay progress" });
  return view;
}

describe("review player integration", () => {
  it("builds only when opened, pauses and seeks exactly, caches across playback and restores panel preference", async () => {
    window.localStorage.setItem(preferenceKey, "true");
    const view = await open();
    await view.findByRole("button", { name: "Show side panel" });
    expect(buildReplayReview).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Play replay" }));
    fireEvent.click(view.getByRole("button", { name: "Review game" }));
    expect(view.getByRole("complementary", { name: "Game review" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Play replay" })).toBeInTheDocument();
    expect(buildReplayReview).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(preferenceKey)).toBe("true");
    fireEvent.click(view.getByRole("tab", { name: "Search" }));
    const entries = view.container.querySelectorAll<HTMLButtonElement>("[data-review-event]");
    expect(entries.length).toBeGreaterThan(0);
    const targetIndex = Number(entries[0].getAttribute("data-review-event"));
    fireEvent.click(entries[0]);
    expect(view.getByRole("slider", { name: "Replay progress" })).toHaveValue(String(replay.events[targetIndex].atMs));
    expect(view.container.querySelector(`[data-review-event="${targetIndex}"]`)).toHaveAttribute("aria-current", "true");
    fireEvent.click(view.getByRole("button", { name: "Back to replay" }));
    expect(view.getByRole("button", { name: "Show side panel" })).toBeInTheDocument();
    expect(view.container.querySelector("[data-replay-details]")).toHaveAttribute("hidden");
    fireEvent.click(view.getByRole("button", { name: "Review game" }));
    expect(buildReplayReview).toHaveBeenCalledOnce();
    expect(view.getByRole("tab", { name: "Search" })).toHaveAttribute("aria-selected", "true");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps a note draft intact while reviewing and returns to the same editor", async () => {
    const view = await open();
    fireEvent.click(view.getByRole("button", { name: "Add replay note at 0:02.500" }));
    const title = view.getByRole("textbox", { name: "Replay note title" });
    const body = view.getByRole("textbox", { name: "Replay note" });
    fireEvent.change(title, { target: { value: "Keep this draft" } });
    fireEvent.change(body, { target: { value: "Would contesting have helped?" } });
    fireEvent.click(view.getByRole("button", { name: "Review game" }));
    expect(title).toBeInTheDocument();
    expect(view.queryByRole("textbox", { name: "Replay note title" })).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Resume your note" }));
    expect(view.getByRole("textbox", { name: "Replay note title" })).toBe(title);
    expect(title).toHaveValue("Keep this draft");
    expect(body).toHaveValue("Would contesting have helped?");
  });

  it("anchors thoughts to the selected canonical event even when another event has the same timestamp", async () => {
    const index = buildReplayReview(replay);
    const moment = index.moments.find((entry) => entry.eventIndex < replay.events.length - 1)!;
    replay.events[moment.eventIndex + 1].atMs = moment.atMs;
    vi.mocked(buildReplayReview).mockClear();
    const view = await open();
    fireEvent.click(view.getByRole("button", { name: "Review game" }));
    fireEvent.change(view.getByRole("combobox", { name: "Game" }), { target: { value: moment.gameId } });
    fireEvent.click(view.getByRole("button", { name: "Add a thought" }));
    fireEvent.change(view.getByRole("textbox", { name: "Replay note" }), { target: { value: "Review this exact action" } });
    fireEvent.click(view.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(window.localStorage.getItem(replayNotesStorageKey(replayId))).not.toBeNull());
    const saved = JSON.parse(window.localStorage.getItem(replayNotesStorageKey(replayId))!);
    expect(saved.notes[0].eventIndex).toBe(moment.eventIndex);
    expect(saved.notes[0].eventId).toBe(replay.events[moment.eventIndex].id);
    expect(saved.notes[0].atMs).toBe(moment.atMs);
    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    fireEvent.click(view.container.querySelector('[data-replay-note-marker]')!);
    fireEvent.click(view.getByRole("button", { name: "Review game" }));
    fireEvent.click(view.getByRole("tab", { name: "Search" }));
    expect(view.container.querySelector(`[data-review-event="${moment.eventIndex}"]`)).toHaveAttribute("aria-current", "true");
  });

  it("does not add review tools to caster or training layouts", async () => {
    for (const props of [{ mode: "caster" as const }, { trainingReplay: replay }, { trainingReplay: replay, trainingEditable: true }]) {
      const view = render(createElement(ReplayV2Player, { replayId, ...props }));
      await view.findByRole("complementary", { name: "Replay details" });
      expect(view.queryByRole("button", { name: "Review game" })).not.toBeInTheDocument();
      view.unmount();
    }
    expect(buildReplayReview).not.toHaveBeenCalled();
  });
});
