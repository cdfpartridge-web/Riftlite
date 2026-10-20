import { createElement } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./useReplayAccountReview", () => import("./__fixtures__/signed-out-review-account"));

import { normalizeRawCaptureV1, type CanonicalReplayV2 } from "@/lib/replay-v2";
import { syntheticBo3Capture } from "@/lib/replay-v2/__fixtures__/synthetic-captures";

vi.mock("firebase/auth", () => ({
  getAuth: () => ({ authStateReady: async () => undefined, currentUser: null }),
}));
vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));

import { ReplayV2Player } from "./ReplayV2Player";

const preferenceKey = "riftlite.replay.details-hidden.v1";
const replayId = "rp_side_panel";
let replay: CanonicalReplayV2;

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", `/replays/${replayId}?t=2.5`);
  replay = normalizeRawCaptureV1(syntheticBo3Capture());
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  // Keep time fixed so a layout change cannot be mistaken for a playback seek.
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
    headers: { "content-type": "application/json" },
    status: 200,
  })));
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => undefined;
  if (!HTMLElement.prototype.animate) {
    HTMLElement.prototype.animate = () => ({ pause() {}, play() {} }) as Animation;
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

async function openReplay() {
  const view = render(createElement(ReplayV2Player, { replayId }));
  await view.findByRole("slider", { name: "Replay progress" });
  return view;
}

describe("replay side panel preference", () => {
  it("expands the board without remounting details, refetching, or changing playback and activity", async () => {
    const view = await openReplay();
    const details = view.getByRole("complementary", { name: "Replay details" });
    const timeline = view.getByRole("slider", { name: "Replay progress" });
    const toggle = view.getByRole("button", { name: "Hide side panel" });
    const logTab = view.getByRole("tab", { name: /Match log/ });
    fireEvent.click(logTab);
    expect(toggle).toHaveAttribute("data-control", "details-panel");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(details).not.toHaveAttribute("hidden");
    expect(timeline).toHaveValue("2500");

    fireEvent.click(toggle);
    expect(view.container.querySelector("[data-replay-details]")).toBe(details);
    expect(details).toHaveAttribute("hidden");
    expect(view.container.querySelector('[data-details-hidden="true"]')).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Show side panel" })).toHaveAttribute("aria-expanded", "false");
    expect(view.queryByRole("tab", { name: /Match log/ })).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "Play replay" })).toBeInTheDocument();
    expect(timeline).toHaveValue("2500");

    fireEvent.click(view.getByRole("button", { name: "Play replay" }));
    fireEvent.click(view.getByRole("button", { name: "Show side panel" }));
    expect(view.getByRole("button", { name: "Pause replay" })).toBeInTheDocument();
    expect(timeline).toHaveValue("2500");
    expect(view.getByRole("complementary", { name: "Replay details" })).toBe(details);
    expect(logTab).toHaveAttribute("aria-selected", "true");
    expect(view.container.querySelector('[data-details-hidden="true"]')).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Hide side panel" }));
    expect(view.getByRole("button", { name: "Pause replay" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("remembers a hidden panel on a fresh mount and remembers showing it again", async () => {
    const first = await openReplay();
    fireEvent.click(first.getByRole("button", { name: "Hide side panel" }));
    expect(window.localStorage.getItem(preferenceKey)).toBe("true");
    first.unmount();

    const second = await openReplay();
    const show = await second.findByRole("button", { name: "Show side panel" });
    expect(second.container.querySelector("[data-replay-details]")).toHaveAttribute("hidden");
    fireEvent.click(show);
    expect(window.localStorage.getItem(preferenceKey)).toBe("false");
    second.unmount();

    const third = await openReplay();
    expect(third.getByRole("button", { name: "Hide side panel" })).toHaveAttribute("aria-expanded", "true");
    expect(third.getByRole("complementary", { name: "Replay details" })).not.toHaveAttribute("hidden");
  });

  it("still allows both layout choices when browser storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    const view = await openReplay();
    fireEvent.click(view.getByRole("button", { name: "Hide side panel" }));
    expect(view.container.querySelector("[data-replay-details]")).toHaveAttribute("hidden");
    fireEvent.click(view.getByRole("button", { name: "Show side panel" }));
    expect(view.getByRole("complementary", { name: "Replay details" })).not.toHaveAttribute("hidden");
    expect(write).toHaveBeenCalledWith(preferenceKey, "true");
    expect(write).toHaveBeenCalledWith(preferenceKey, "false");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reveals timeline notes while preserving an unsaved draft across hiding", async () => {
    const view = await openReplay();
    fireEvent.click(view.getByRole("button", { name: "Add replay note at 0:02.500" }));
    const title = await view.findByRole("textbox", { name: "Replay note title" });
    const body = view.getByRole("textbox", { name: "Replay note" });
    fireEvent.change(title, { target: { value: "Check might before combat" } });
    fireEvent.change(body, { target: { value: "Keep the temporary buff in mind." } });
    fireEvent.click(view.getByRole("button", { name: "Hide side panel" }));
    expect(title).toBeInTheDocument();
    expect(view.queryByRole("textbox", { name: "Replay note title" })).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Show side panel" }));
    expect(view.getByRole("textbox", { name: "Replay note title" })).toBe(title);
    expect(title).toHaveValue("Check might before combat");
    expect(body).toHaveValue("Keep the temporary buff in mind.");
    expect(view.getByRole("tab", { name: /Notes/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(view.getByRole("button", { name: "Save note" }));
    const marker = await view.findByRole("slider", { name: "Replay note 1, Check might before combat, 0:02.500" });
    fireEvent.click(view.getByRole("button", { name: "Hide side panel" }));
    fireEvent.click(marker);
    expect(view.getByRole("button", { name: "Hide side panel" })).toHaveAttribute("aria-expanded", "true");
    expect(view.container.querySelector("[data-replay-note-inspector]")).toHaveTextContent("Keep the temporary buff in mind.");
    expect(view.getByRole("slider", { name: "Replay progress" })).toHaveValue("2500");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("temporarily opens details for analysis and restores the saved preference on return", async () => {
    window.localStorage.setItem(preferenceKey, "true");
    const view = await openReplay();
    fireEvent.click(view.getByRole("button", { name: "Take control" }));
    await waitFor(() => expect(view.container.querySelector("[data-analysis-panel]")).toBeInTheDocument());
    expect(view.getByRole("button", { name: "Hide side panel" })).toBeDisabled();
    expect(view.getByRole("complementary", { name: "Replay details" })).not.toHaveAttribute("hidden");
    expect(window.localStorage.getItem(preferenceKey)).toBe("true");

    fireEvent.click(view.container.querySelector<HTMLButtonElement>('[data-control="analysis"]')!);
    expect(view.getByRole("button", { name: "Show side panel" })).toBeEnabled();
    expect(view.container.querySelector("[data-replay-details]")).toHaveAttribute("hidden");
    expect(view.getByRole("slider", { name: "Replay progress" })).toHaveValue("2500");
    expect(window.localStorage.getItem(preferenceKey)).toBe("true");
  });

  it("keeps caster and training details available regardless of the viewer preference", async () => {
    window.localStorage.setItem(preferenceKey, "true");
    const variants = [
      { mode: "caster" as const },
      { trainingReplay: replay },
      { trainingReplay: replay, trainingEditable: true },
    ];
    for (const props of variants) {
      const view = render(createElement(ReplayV2Player, { replayId, ...props }));
      const details = await view.findByRole("complementary", { name: "Replay details" });
      expect(details).not.toHaveAttribute("hidden");
      expect(view.container.querySelector('[data-control="details-panel"]')).not.toBeInTheDocument();
      expect(view.container.querySelector('[data-details-hidden="true"]')).not.toBeInTheDocument();
      expect(window.localStorage.getItem(preferenceKey)).toBe("true");
      view.unmount();
    }
  });
});
