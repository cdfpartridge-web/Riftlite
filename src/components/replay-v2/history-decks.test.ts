import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("firebase/auth", () => ({
  getAuth: () => ({ authStateReady: async () => undefined, currentUser: null }),
}));
vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));
import { ReplayHistoryDeckPanel } from "./ReplayHistoryDeckPanel";
import { AtlasHistoryDecks } from "./AtlasHistoryDecks";
import type { AtlasMatchHistory } from "@/lib/replay-v2/atlas-history";

const before = [
  { section: "legend" as const, quantity: 1, name: "Irelia, Blade Dancer" },
  { section: "mainDeck" as const, quantity: 1, name: "Pyke, Returned" },
  { section: "mainDeck" as const, quantity: 1, name: "Vex, Apathetic" },
];
const after = [before[0], { section: "mainDeck" as const, quantity: 2, name: "Adaptatron" }];
const history: AtlasMatchHistory = {
  version: 1,
  updatedAt: "2026-09-11T12:00:00Z",
  games: [1, 2].map((gameNumber) => ({
    gameNumber,
    historyId: "g" + gameNumber,
    startedAt: Date.parse("2026-09-11T11:22:48.975Z"),
    roomCode: "",
    myName: "BMU",
    opponentName: "Bine",
    myPoints: 7,
    opponentPoints: 4,
    me: { availability: "unavailable", cards: [] },
    opponent: { availability: "available", cards: gameNumber === 1 ? before : after },
  })),
};

describe("post-game replay deck panel", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it("lets the viewer compare games and explains unavailable decks", () => {
    render(createElement(AtlasHistoryDecks, { history }));
    fireEvent.click(screen.getByRole("button", { name: /Game 2/ }));
    expect(screen.getByText("+2 Adaptatron")).toBeVisible();
    expect(screen.getByText("−1 Pyke, Returned")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Your deck" }));
    expect(screen.getByText(/has not provided/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Copy deck list" })).not.toBeInTheDocument();
  });
  it("loads only on opening, pauses playback, opens the current game and handles closing", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ history }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const onOpen = vi.fn();
    render(
      createElement(ReplayHistoryDeckPanel, {
        replayId: "replay-1",
        apiBasePath: "/api/v2/replays",
        gameNumber: 2,
        onOpen,
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Match decks/ }));
    expect(onOpen).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText("+2 Adaptatron")).toBeVisible());
    const playbackShortcut = vi.fn();
    window.addEventListener("keydown", playbackShortcut);
    fireEvent.keyDown(screen.getByRole("button", { name: "Copy deck list" }), { key: "ArrowRight" });
    expect(playbackShortcut).not.toHaveBeenCalled();
    window.removeEventListener("keydown", playbackShortcut);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v2/replays/replay-1/decks",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close match decks" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("does not reveal cached decks when a different replay denies access", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    render(
      createElement(ReplayHistoryDeckPanel, {
        replayId: "other",
        apiBasePath: "/api/v2/replays",
        gameNumber: 1,
        onOpen: vi.fn(),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Match decks/ }));
    await waitFor(() => expect(screen.getByText(/available to the replay owner/)).toBeVisible());
    expect(screen.queryByText("Adaptatron")).not.toBeInTheDocument();
  });
  it("closes and clears the first replay's decks when switching to another replay", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ history }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 403 })));
    const props = { apiBasePath: "/api/v2/replays", gameNumber: 2, onOpen: vi.fn() };
    const view = render(createElement(ReplayHistoryDeckPanel, { ...props, replayId: "first" }));
    fireEvent.click(screen.getByRole("button", { name: /Match decks/ }));
    await waitFor(() => expect(screen.getByText("+2 Adaptatron")).toBeVisible());
    view.rerender(createElement(ReplayHistoryDeckPanel, { ...props, replayId: "second" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("+2 Adaptatron")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Match decks/ }));
    await waitFor(() => expect(screen.getByText(/available to the replay owner/)).toBeVisible());
    expect(screen.queryByText("+2 Adaptatron")).not.toBeInTheDocument();
  });
});
