import { createElement } from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./useReplayAccountReview", () => import("./__fixtures__/signed-out-review-account"));
vi.mock("firebase/auth", () => ({
  getAuth: () => ({ authStateReady: async () => undefined, currentUser: null }),
  onIdTokenChanged: (_auth: unknown, callback: (user: null) => void) => { callback(null); return () => undefined; },
}));
vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));
import { ReplayV2Player } from "./ReplayV2Player";
import { atlasPostgameMulliganFixture, atlasPostgamePlayerFixture } from "./__fixtures__/atlas-postgame-player";

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

  it("shows verified opponent cards in Opening hands and Mulligan while preserving our hand and Player view", async () => {
    const fixture = atlasPostgameMulliganFixture();
    const before = JSON.stringify(fixture.canonical);
    mockFixture(fixture);
    const view = render(createElement(ReplayV2Player, { replayId: fixture.replayId }));
    const all = await view.findByRole("button", { name: "All cards" });
    await waitFor(() => expect(all).toBeEnabled());
    for (const scene of ["battlefields", "initiative", "opening"]) {
      fireEvent.click(view.getByRole("button", { name: "Next action" }));
      await waitFor(() => expect(view.container.querySelector(`[data-scene="${scene}"]`)).toBeInTheDocument());
    }
    const ownOpeningBefore = view.container.querySelector('[data-opening-player="a"]')!.innerHTML;
    fireEvent.click(all);
    await waitFor(() => expect(all).toHaveAttribute("aria-pressed", "true"));
    const opening = view.container.querySelector('[data-scene="opening"]')!;
    const openingPanel = within(opening as HTMLElement).getByRole("region", { name: "Player Beta mulligan summary" });
    expect(within(openingPanel).getByRole("button", { name: "Daring Poro" })).toBeInTheDocument();
    expect(within(openingPanel).getByRole("button", { name: "Harnessed Dragon" })).toBeInTheDocument();
    expect(within(openingPanel).getByLabelText("2 returned cards, identities unknown")).toBeInTheDocument();
    expect(openingPanel.querySelector('[data-card-id="b-opening"]')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-opening-player="a"]')!.innerHTML).toBe(ownOpeningBefore);
    fireEvent.click(view.getByRole("button", { name: "Player view" }));
    await waitFor(() => expect(opening.querySelector("[data-atlas-mulligan]")).not.toBeInTheDocument());
    expect(opening.querySelector('[data-opening-player="b"]')!.querySelectorAll('[aria-label="Hidden card"]')).toHaveLength(4);
    expect(view.container.querySelector('[data-opening-player="a"]')!.innerHTML).toBe(ownOpeningBefore);
    fireEvent.click(all);
    await waitFor(() => expect(all).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    const panel = await view.findByRole("region", { name: "Player Beta mulligan summary" });
    const kept = panel.querySelector('[data-atlas-mulligan-group="kept"]') as HTMLElement;
    const replacements = panel.querySelector('[data-atlas-mulligan-group="replacements"]') as HTMLElement;
    expect(within(kept).getByRole("button", { name: "Daring Poro" })).toBeInTheDocument();
    expect(within(kept).getByRole("button", { name: "Eager Apprentice" })).toBeInTheDocument();
    expect(within(replacements).getByRole("button", { name: "Harnessed Dragon" })).toBeInTheDocument();
    expect(within(replacements).getByRole("button", { name: "Black Rose Dignitary" })).toBeInTheDocument();
    expect(panel.querySelectorAll("img")).toHaveLength(4);
    expect(panel.querySelector('[data-card-id="b-opening"]')).not.toBeInTheDocument();
    expect(within(panel).getByLabelText("2 returned cards, identities unknown")).toBeInTheDocument();
    const own = view.container.querySelector('[data-mulligan-player="a"]')!;
    const ownBefore = own.innerHTML;
    fireEvent.click(view.getByRole("button", { name: "Player view" }));
    await waitFor(() => expect(view.container.querySelector("[data-atlas-mulligan]")).not.toBeInTheDocument());
    expect(view.container.querySelector('[data-mulligan-player="a"]')?.innerHTML).toBe(ownBefore);
    expect(view.container.querySelector('[data-mulligan-player="b"] [aria-label="Hidden card"]')).toBeInTheDocument();
    expect(JSON.stringify(fixture.canonical)).toBe(before);
  });

  it.each([["opening", 3, "data-opening-player"], ["mulligan", 4, "data-mulligan-player"]])("removes the %s summary when access is revoked", async (_scene, steps, playerAttribute) => {
    const fixture = atlasPostgameMulliganFixture();
    let revoked = false;
    mockFixture(fixture, () => revoked);
    const view = render(createElement(ReplayV2Player, { replayId: fixture.replayId }));
    const all = await view.findByRole("button", { name: "All cards" });
    await waitFor(() => expect(all).toBeEnabled());
    fireEvent.click(all);
    await waitFor(() => expect(all).toHaveAttribute("aria-pressed", "true"));
    for (let index = 0; index < Number(steps); index++) fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await view.findByRole("region", { name: "Player Beta mulligan summary" });
    revoked = true;
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(view.container.querySelector("[data-atlas-mulligan]")).not.toBeInTheDocument());
    expect(view.container.querySelector(`[${playerAttribute}="b"] [aria-label="Hidden card"]`)).toBeInTheDocument();
  });

  it.each([["opening", 3, "data-opening-player"], ["mulligan", 4, "data-mulligan-player"]])("keeps old attachments playable and explains missing %s information", async (_scene, steps, playerAttribute) => {
    const fixture = atlasPostgameMulliganFixture(true);
    mockFixture(fixture);
    const view = render(createElement(ReplayV2Player, { replayId: fixture.replayId }));
    const all = await view.findByRole("button", { name: "All cards" });
    await waitFor(() => expect(all).toBeEnabled());
    fireEvent.click(all);
    await waitFor(() => expect(all).toHaveAttribute("aria-pressed", "true"));
    for (let index = 0; index < Number(steps); index++) fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await view.findByText("This Atlas replay has no verified mulligan details. Captured view is shown.");
    expect(view.container.querySelector("[data-atlas-mulligan]")).not.toBeInTheDocument();
    expect(view.container.querySelector(`[${playerAttribute}="b"] [aria-label="Hidden card"]`)).toBeInTheDocument();
  });
});

function mockFixture(fixture: ReturnType<typeof atlasPostgameMulliganFixture>, revoked = () => false) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/atlas-postgame") && revoked()) return new Response(JSON.stringify({ error: "Access expired" }), { status: 403 });
    const body = url.includes("/atlas-postgame") ? url.includes("metadata=1") ? fixture.metadata : fixture.supplement : { replay: fixture.canonical };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
}
