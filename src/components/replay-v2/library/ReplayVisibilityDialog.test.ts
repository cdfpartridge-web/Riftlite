import { createElement } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplayVisibilityDialog } from "./ReplayVisibilityDialog";

const auth = vi.hoisted(() => ({ currentUser: null as null | { isAnonymous: boolean; getIdToken: () => Promise<string> }, authStateReady: vi.fn(async () => undefined) }));
vi.mock("firebase/auth", () => ({ getAuth: () => auth }));
vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));

const replay = { replayId: "rl2_owner", title: "Akali vs Irelia", visibility: "private" as const };
afterEach(() => { vi.unstubAllGlobals(); auth.currentUser = null; });

describe("replay visibility editor", () => {
  it("loads owner-only metadata for the direct desktop entry without changing visibility", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ replay })));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(createElement(ReplayVisibilityDialog, { replayId: replay.replayId, onClose: vi.fn() }));
    expect(await view.findByRole("radio", { name: /Private/ })).toBeChecked();
    expect(view.getByRole("button", { name: "Save visibility" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/v2/replays/rl2_owner?manage=visibility", expect.objectContaining({ credentials: "include", cache: "no-store" }));
  });

  it("uses bearer auth for a website owner and waits for server confirmation", async () => {
    auth.currentUser = { isAnonymous: false, getIdToken: async () => "linked-token" };
    let resolveSave: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveSave = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const view = render(createElement(ReplayVisibilityDialog, { replayId: replay.replayId, replay, onClose, onSaved }));
    fireEvent.click(view.getByRole("radio", { name: /^Public/ }));
    fireEvent.click(view.getByRole("button", { name: "Save visibility" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toBeInstanceOf(Headers);
    expect(new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get("Authorization")).toBe("Bearer linked-token");
    expect(view.getByRole("button", { name: "Saving…" })).toBeDisabled();
    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    resolveSave(new Response(JSON.stringify({ replay: { ...replay, visibility: "public" } })));
    await view.findByText(/Saved. This replay is now public/);
    expect(onSaved).toHaveBeenCalledWith("public");
  });

  it("keeps errors visible and allows retry without reporting a failed change as saved", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "Try later" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ replay: { ...replay, visibility: "unlisted" } })));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    const view = render(createElement(ReplayVisibilityDialog, { replayId: replay.replayId, replay, onClose: vi.fn(), onSaved }));
    fireEvent.click(view.getByRole("radio", { name: /Unlisted/ }));
    fireEvent.click(view.getByRole("button", { name: "Save visibility" }));
    expect(await view.findByRole("alert")).toHaveTextContent("Try later");
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Save visibility" }));
    await view.findByText(/Saved. This replay is now unlisted/);
    expect(onSaved).toHaveBeenCalledWith("unlisted");
  });

  it.each([401, 403])("shows an actionable auth error without controls for rejected owner reads (%s)", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: status === 403 ? "replay_owner_required" : "authentication_required" }), { status })));
    const view = render(createElement(ReplayVisibilityDialog, { replayId: replay.replayId, onClose: vi.fn() }));
    expect(await view.findByRole("alert")).toHaveTextContent(status === 401 ? "session has expired" : "Only the account that uploaded");
    expect(view.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("requires confirmation of this replay and selection, and lets Cancel discard an unsaved choice", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay: { ...replay, visibility: "private" } }))));
    const onSaved = vi.fn(); const onClose = vi.fn();
    const view = render(createElement(ReplayVisibilityDialog, { replayId: replay.replayId, replay, onClose, onSaved }));
    fireEvent.click(view.getByRole("radio", { name: /^Public/ }));
    fireEvent.click(view.getByRole("button", { name: "Save visibility" }));
    expect(await view.findByRole("alert")).toHaveTextContent("did not confirm the change");
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps editor keyboard input away from the underlying replay shortcuts", () => {
    const playerShortcut = vi.fn();
    window.addEventListener("keydown", playerShortcut);
    try {
      const view = render(createElement(ReplayVisibilityDialog, { replayId: replay.replayId, replay, onClose: vi.fn() }));
      fireEvent.keyDown(view.getByRole("button", { name: "Cancel" }), { key: " " });
      expect(playerShortcut).not.toHaveBeenCalled();
    } finally { window.removeEventListener("keydown", playerShortcut); }
  });
});
