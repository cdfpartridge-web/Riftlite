import { createElement } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/auth", () => ({
  getAuth: () => ({}),
  onIdTokenChanged: (_auth: unknown, onUser: (user: null) => void) => {
    onUser(null);
    return () => undefined;
  },
}));

vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));

import { ReplayLibrary } from "./ReplayLibrary";

describe("embedded replay library", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads the linked desktop owner's replays through the HttpOnly session", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const items = url.includes("scope=mine")
        ? [{
            replayId: "rl2_private_owner",
            visibility: "private",
            status: "ready",
            title: "LeBlanc vs Fiora",
            platform: "atlas",
            messageCount: 42,
            capturedAt: "2026-07-09T12:00:00.000Z",
            createdAt: "2026-07-10T12:00:00.000Z",
            updatedAt: "2026-07-10T12:01:00.000Z",
          }]
        : [];
      return new Response(JSON.stringify({ items }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(createElement(ReplayLibrary, { embedded: true }));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "LeBlanc vs Fiora" })).toBeInTheDocument();
    });
    expect(view.getByRole("tab", { name: "My replays" })).toHaveAttribute("aria-selected", "true");
    expect(view.getByRole("tab", { name: "My replays" })).toBeEnabled();
    expect(view.getByRole("tab", { name: "Public replays" })).toHaveAttribute("aria-selected", "false");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/replays?scope=mine",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(view.queryByText("Manual upload")).not.toBeInTheDocument();
    expect(view.queryByRole("link", { name: "Combine two replays" })).not.toBeInTheDocument();
    expect(view.queryByText("Sign in to manage your replays")).not.toBeInTheDocument();
    expect(view.getByRole("link", { name: /Watch replay/i })).toHaveAttribute(
      "href",
      "/replays/rl2_private_owner?embed=1",
    );
    expect(view.getByText(/9 Jul 2026/)).toBeInTheDocument();
  });

  it("keeps the manual combiner hidden from the website replay library", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));

    const view = render(createElement(ReplayLibrary));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "No public replays yet" })).toBeInTheDocument();
    });
    expect(view.queryByRole("link", { name: "Combine two replays" })).not.toBeInTheDocument();
  });

  it("falls back to public replays when the embedded owner session is unauthorized", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("scope=mine")) {
        return new Response(JSON.stringify({
          code: "authentication_required",
          error: "A linked RiftLite account session is required.",
        }), {
          headers: { "content-type": "application/json" },
          status: 401,
        });
      }
      return new Response(JSON.stringify({ items: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(createElement(ReplayLibrary, { embedded: true }));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "Showing public replays" })).toBeInTheDocument();
      expect(view.getByRole("heading", { name: "No public replays yet" })).toBeInTheDocument();
    });
    expect(view.getByText(/Reconnect your account in RiftLite/i)).toBeInTheDocument();
    expect(view.getByRole("tab", { name: "Public replays" })).toHaveAttribute("aria-selected", "true");
    expect(view.getByRole("tab", { name: "My replays" })).toHaveAttribute("aria-selected", "false");
    expect(view.getByRole("tab", { name: "My replays" })).toBeDisabled();
    expect(view.queryByText("A linked RiftLite account session is required.")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/replays?scope=mine",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/replays?scope=public",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("explains automatic upload when an authenticated embedded library is empty", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const view = render(createElement(ReplayLibrary, { embedded: true }));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "No uploaded replays yet" })).toBeInTheDocument();
    });
    expect(view.getByText("Enable automatic upload in RiftLite Settings and complete an Atlas game.")).toBeInTheDocument();
    expect(view.queryByText(/Upload your first raw capture above/i)).not.toBeInTheDocument();
    expect(view.getByRole("tab", { name: "My replays" })).toHaveAttribute("aria-selected", "true");
    expect(view.getByRole("tab", { name: "My replays" })).toBeEnabled();
  });

  it("pauses processing refreshes while hidden and refreshes immediately when visible", async () => {
    let mineRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const isMine = String(input).includes("scope=mine");
      if (isMine) mineRequests += 1;
      return new Response(JSON.stringify({
        items: isMine ? [{
          replayId: "rl2_processing",
          visibility: "private",
          status: "processing",
          title: "Processing replay",
          platform: "atlas",
          messageCount: 42,
          createdAt: "2026-07-10T12:00:00.000Z",
          updatedAt: "2026-07-10T12:01:00.000Z",
        }] : [],
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    let visibilityState: DocumentVisibilityState = "visible";
    const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const view = render(createElement(ReplayLibrary, { embedded: true }));

    try {
      await waitFor(() => {
        expect(mineRequests).toBe(1);
        expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000);
      });
      const pollingCallIndex = setIntervalSpy.mock.calls.findIndex((call) => call[1] === 5_000);
      const pollingTimer = setIntervalSpy.mock.results[pollingCallIndex]?.value;

      visibilityState = "hidden";
      fireEvent(document, new Event("visibilitychange"));
      expect(clearIntervalSpy).toHaveBeenCalledWith(pollingTimer);

      visibilityState = "visible";
      fireEvent(document, new Event("visibilitychange"));
      await waitFor(() => expect(mineRequests).toBe(2));
      expect(setIntervalSpy.mock.calls.filter((call) => call[1] === 5_000)).toHaveLength(2);
    } finally {
      view.unmount();
      if (originalVisibilityState) {
        Object.defineProperty(document, "visibilityState", originalVisibilityState);
      } else {
        Reflect.deleteProperty(document, "visibilityState");
      }
    }
  });

  it("filters public replays by player and opponent legend", async () => {
    const item = (replayId: string, title: string, playerLegend: string, opponentLegend: string) => ({
      replayId,
      visibility: "public",
      status: "ready",
      title,
      platform: "atlas",
      messageCount: 42,
      capturedAt: "2026-07-09T12:00:00.000Z",
      createdAt: "2026-07-10T12:00:00.000Z",
      updatedAt: "2026-07-10T12:01:00.000Z",
      listing: {
        version: 1,
        playerName: "Player one",
        opponentName: "Player two",
        playerLegend,
        opponentLegend,
        format: "bo1",
        result: "win",
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [
      item("rl2_akali_fiora", "Akali vs Fiora", "Akali", "Fiora"),
      item("rl2_kennen_jinx", "Kennen vs Jinx", "Kennen", "Jinx"),
      item("rl2_akali_jinx", "Akali vs Jinx", "Akali", "Jinx"),
    ] }), { headers: { "content-type": "application/json" }, status: 200 })));

    const view = render(createElement(ReplayLibrary));
    await waitFor(() => expect(view.getByRole("heading", { name: "Akali vs Fiora" })).toBeInTheDocument());

    fireEvent.change(view.getByLabelText("Player legend"), { target: { value: "Akali" } });
    expect(view.queryByRole("heading", { name: "Kennen vs Jinx" })).not.toBeInTheDocument();
    expect(view.getByText("2 of 3 replays")).toBeInTheDocument();

    fireEvent.change(view.getByLabelText("Opponent legend"), { target: { value: "Jinx" } });
    expect(view.getByRole("heading", { name: "Akali vs Jinx" })).toBeInTheDocument();
    expect(view.queryByRole("heading", { name: "Akali vs Fiora" })).not.toBeInTheDocument();
    expect(view.getByText("1 of 3 replays")).toBeInTheDocument();
  });
});
