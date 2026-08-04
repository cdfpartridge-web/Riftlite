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

function publicReplay(replayId: string, title: string) {
  return {
    replayId,
    visibility: "public",
    status: "ready",
    title,
    platform: "atlas",
    messageCount: 42,
    capturedAt: "2026-07-09T12:00:00.000Z",
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:01:00.000Z",
  };
}

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

  it("shows the persisted partial-capture warning on a ready replay", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({
      items: String(input).includes("scope=mine") ? [{
        ...publicReplay("rl2_partial", "Partial replay"),
        visibility: "private",
        warnings: [{
          code: "replay_capture_missing_mulligan",
          message: "The replay did not capture the opening mulligan.",
        }],
      }] : [],
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));

    const view = render(createElement(ReplayLibrary, { embedded: true }));

    await waitFor(() => {
      expect(view.getByText("Partial capture: The replay did not capture the opening mulligan.")).toBeInTheDocument();
    });
    expect(view.getByRole("link", { name: /Watch replay/i })).toBeEnabled();
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
    expect(view.getByText("Enable automatic upload in RiftLite Settings and complete a game on TCGA or RiftAtlas.")).toBeInTheDocument();
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

  it("loads successive public pages and deduplicates replay ids", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const cursor = new URL(String(input), "https://www.riftlite.com").searchParams.get("cursor");
      return new Response(JSON.stringify(cursor ? {
        items: [
          publicReplay("rl2_second", "Second replay refreshed"),
          publicReplay("rl2_third", "Third replay"),
        ],
        pageInfo: { hasMore: false, nextCursor: null },
      } : {
        items: [
          publicReplay("rl2_first", "First replay"),
          publicReplay("rl2_second", "Second replay"),
        ],
        pageInfo: { hasMore: true, nextCursor: "page-2" },
      }), { headers: { "content-type": "application/json" }, status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(createElement(ReplayLibrary));
    const loadMore = await view.findByRole("button", { name: "Load more replays" });
    fireEvent.click(loadMore);

    await waitFor(() => expect(view.getByRole("heading", { name: "Third replay" })).toBeInTheDocument());
    expect(view.getByRole("heading", { name: "First replay" })).toBeInTheDocument();
    expect(view.getByRole("heading", { name: "Second replay refreshed" })).toBeInTheDocument();
    expect(view.queryByRole("heading", { name: "Second replay" })).not.toBeInTheDocument();
    expect(view.getByText("3 replays")).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Load more replays" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/replays?scope=public&cursor=page-2",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("keeps loaded public cards when loading more fails and allows a retry", async () => {
    let pageAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const cursor = new URL(String(input), "https://www.riftlite.com").searchParams.get("cursor");
      if (!cursor) {
        return new Response(JSON.stringify({
          items: [publicReplay("rl2_first", "First replay")],
          pageInfo: { hasMore: true, nextCursor: "retry-page" },
        }), { headers: { "content-type": "application/json" }, status: 200 });
      }
      pageAttempts += 1;
      if (pageAttempts === 1) {
        return new Response(JSON.stringify({ error: "Archive page is temporarily unavailable." }), {
          headers: { "content-type": "application/json" },
          status: 503,
        });
      }
      return new Response(JSON.stringify({
        items: [publicReplay("rl2_second", "Second replay")],
        pageInfo: { hasMore: false, nextCursor: null },
      }), { headers: { "content-type": "application/json" }, status: 200 });
    }));

    const view = render(createElement(ReplayLibrary));
    fireEvent.click(await view.findByRole("button", { name: "Load more replays" }));

    const retry = await view.findByRole("button", { name: "Try loading again" });
    expect(view.getByRole("heading", { name: "First replay" })).toBeInTheDocument();
    expect(view.getByText("Archive page is temporarily unavailable.")).toBeInTheDocument();
    fireEvent.click(retry);

    await waitFor(() => expect(view.getByRole("heading", { name: "Second replay" })).toBeInTheDocument());
    expect(view.getByRole("heading", { name: "First replay" })).toBeInTheDocument();
    expect(pageAttempts).toBe(2);
  });

  it("refreshes the public archive from page one and replaces its continuation cursor", async () => {
    let firstPageRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://www.riftlite.com");
      const cursor = url.searchParams.get("cursor");
      if (cursor) {
        return new Response(JSON.stringify({ items: [], pageInfo: { hasMore: false, nextCursor: null } }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      firstPageRequests += 1;
      return new Response(JSON.stringify({
        items: [publicReplay(`rl2_page_${firstPageRequests}`, `Page ${firstPageRequests} replay`)],
        pageInfo: { hasMore: true, nextCursor: `cursor-${firstPageRequests}` },
      }), { headers: { "content-type": "application/json" }, status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(createElement(ReplayLibrary));
    await view.findByRole("heading", { name: "Page 1 replay" });
    fireEvent.click(view.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(view.getByRole("heading", { name: "Page 2 replay" })).toBeInTheDocument());
    expect(view.queryByRole("heading", { name: "Page 1 replay" })).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Load more replays" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/replays?scope=public&cursor=cursor-2",
      expect.objectContaining({ cache: "no-store" }),
    ));
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v2/replays?scope=public&cursor=cursor-1",
      expect.anything(),
    );
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

  it("uses processed matchup identity when an old generated title is stale", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [{
      replayId: "rl2_corrected_listing",
      visibility: "public",
      status: "ready",
      title: "Unknown vs Renekton",
      platform: "atlas",
      messageCount: 42,
      capturedAt: "2026-07-09T12:00:00.000Z",
      createdAt: "2026-07-10T12:00:00.000Z",
      updatedAt: "2026-07-10T12:01:00.000Z",
      listing: {
        version: 1,
        playerName: "Player one",
        opponentName: "Player two",
        playerLegend: "Ambessa",
        opponentLegend: "Renekton",
        format: "bo3",
        result: "win",
      },
    }] }), { headers: { "content-type": "application/json" }, status: 200 })));

    const view = render(createElement(ReplayLibrary));
    await waitFor(() => expect(view.getByRole("heading", { name: "Ambessa vs Renekton" })).toBeInTheDocument());
    expect(view.queryByRole("heading", { name: "Unknown vs Renekton" })).not.toBeInTheDocument();
  });
});
