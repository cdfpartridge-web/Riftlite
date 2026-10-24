import { createElement } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./useReplayAccountReview", () => import("./__fixtures__/signed-out-review-account"));
vi.mock("firebase/auth", () => ({
  getAuth: () => ({ authStateReady: async () => undefined, currentUser: null }),
  onIdTokenChanged: (_auth: unknown, callback: (user: null) => void) => { callback(null); return () => undefined; },
}));
vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));
import { ReplayV2Player } from "./ReplayV2Player";
import { atlasPostgamePlayerFixture } from "./__fixtures__/atlas-postgame-player";

describe("All cards through the complete replay player", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    HTMLElement.prototype.animate ??= () => ({ pause() {}, play() {} } as Animation);
    HTMLElement.prototype.scrollTo ??= () => undefined;
    window.history.replaceState({}, "", "/replays/fixture");
    localStorage.clear();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it.each([false, true])("renders opponent identities/images after a real reveal and seek (housekeeping=%s)", async (housekeeping) => {
    const fixture = atlasPostgamePlayerFixture(housekeeping);
    const before = JSON.stringify(fixture.canonical);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/atlas-postgame")
        ? url.includes("metadata=1") ? fixture.metadata : fixture.supplement
        : { replay: fixture.canonical };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const view = render(createElement(ReplayV2Player, { replayId: fixture.replayId }));
    const all = await view.findByRole("button", { name: "All cards" });
    await waitFor(() => expect(all).toBeEnabled());
    fireEvent.click(all);
    await waitFor(() => expect(all).toHaveAttribute("aria-pressed", "true"));
    expect(view.container.querySelector('[data-atlas-all-cards="true"]')).not.toBeInTheDocument();
    const timeline = view.getByRole("slider", { name: "Replay progress" });
    fireEvent.change(timeline, { target: { value: "15500" } });
    await waitFor(() => expect(view.container.querySelector('[data-atlas-all-cards="true"]')).toBeInTheDocument());
    const hand = view.container.querySelector('[data-hand-layout="top"] [data-hand-cards]')!;
    expect(hand.querySelector('[aria-label="Daring Poro"]')).toBeInTheDocument();
    expect(hand.querySelector("img")).toHaveAttribute("src", expect.stringContaining("OGN-135"));
    fireEvent.click(view.getByRole("button", { name: "Player view" }));
    await waitFor(() => expect(hand.querySelector('[aria-label="Daring Poro"]')).not.toBeInTheDocument());
    expect(hand.querySelector('[aria-label="Hidden card"]')).toBeInTheDocument();
    expect(JSON.stringify(fixture.canonical)).toBe(before);
  });
});
