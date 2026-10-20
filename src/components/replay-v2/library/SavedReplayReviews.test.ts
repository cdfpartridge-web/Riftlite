import { createElement } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as null | { uid: string; isAnonymous: boolean; getIdToken: () => Promise<string> }, listeners: new Set<(user: unknown) => void>() }));
vi.mock("firebase/auth", () => ({ getAuth: () => ({}), onIdTokenChanged: (_auth: unknown, listener: (user: unknown) => void) => { auth.listeners.add(listener); listener(auth.user); return () => auth.listeners.delete(listener); } }));
vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));
import { SavedReplayReviews } from "./SavedReplayReviews";
import { ReplayLibrary } from "./ReplayLibrary";

const replayId = `rl2_${"a".repeat(32)}`;
const summary = { replayId, revision: 2, createdAt: 100, updatedAt: 100, title: "Shen vs Mel", platform: "atlas", available: true, noteCount: 1 };
const note = { id: "note-1", atMs: 80_000, eventId: "e1", eventIndex: 1, gameId: "g1", gameNumber: 1, turn: 1, title: "Remember this", body: "My own private analysis", createdAt: 10, updatedAt: 10 };
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
function signIn(uid: string | null) { auth.user = uid ? { uid, isAnonymous: false, getIdToken: async () => `${uid}-token` } : null; auth.listeners.forEach((listener) => listener(auth.user)); }

describe("my saved reviews library", () => {
  beforeEach(() => { auth.user = null; auth.listeners.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("explains private account saving to signed-out visitors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Sign in" }, 401)));
    const view = render(createElement(SavedReplayReviews));
    expect(await view.findByRole("heading", { name: "Sign in to save your reviews" })).toBeInTheDocument();
    expect(view.getByRole("link", { name: "Sign in to RiftLite" })).toHaveAttribute("href", "/account");
    expect(view.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("shows an empty state with the public replay saving instructions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ accountId: "alice", items: [], nextCursor: null })));
    const view = render(createElement(SavedReplayReviews));
    expect(await view.findByRole("heading", { name: "No saved reviews yet" })).toBeInTheDocument();
    expect(view.getByText(/Public replays work too/)).toBeInTheDocument();
  });

  it("opens a public replay's private review and requires confirmation before deleting its notes", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "DELETE" ? json({ accountId: "alice", deleted: true, replayId }) : json({ accountId: "alice", items: [summary], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(createElement(SavedReplayReviews, { embedded: true }));
    expect(await view.findByRole("link", { name: "Open review" })).toHaveAttribute("href", `/replays/${replayId}?review=1&embed=1`);
    fireEvent.click(view.getByRole("button", { name: "Remove Shen vs Mel from my reviews" }));
    expect(view.getByRole("group", { name: "Confirm removal" })).toBeInTheDocument();
    expect(view.getByText(/deletes your private notes.*all devices/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "DELETE")).toBe(false);
    fireEvent.click(view.getByRole("button", { name: "Keep review" }));
    expect(view.queryByRole("group", { name: "Confirm removal" })).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Remove Shen vs Mel from my reviews" }));
    fireEvent.click(view.getByRole("button", { name: "Remove review and notes" }));
    await view.findByRole("heading", { name: "No saved reviews yet" });
    const init = fetchMock.mock.calls.find((call) => call[1]?.method === "DELETE")![1]!;
    expect(JSON.parse(init.body as string)).toEqual({ expectedAccountId: "alice", expectedRevision: 2 });
    expect(init.credentials).toBe("include");
  });

  it("keeps saved notes readable when access to the original replay is lost", async () => {
    const fetchMock = vi.fn(async (url: unknown) => String(url).endsWith(replayId) ? json({ accountId: "alice", review: { ...summary, available: false, notes: [note] } }) : json({ accountId: "alice", items: [{ ...summary, available: false }], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(createElement(SavedReplayReviews));
    fireEvent.click(await view.findByRole("button", { name: "View saved notes" }));
    expect(await view.findByText("My own private analysis")).toBeInTheDocument();
    expect(view.getByText("Game 1 · 1:20")).toBeInTheDocument();
    expect(view.queryByRole("link", { name: "Open review" })).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Hide saved notes" }));
    expect(view.queryByText("My own private analysis")).not.toBeInTheDocument();
  });

  it("never accepts a previous account's in-flight private notes after switching accounts", async () => {
    signIn("alice");
    let resolveNotes!: (value: Response) => void;
    const lateNotes = new Promise<Response>((resolve) => { resolveNotes = resolve; });
    const fetchMock = vi.fn(async (url: unknown) => String(url).endsWith(replayId) ? lateNotes : json({ accountId: auth.user?.uid, items: auth.user?.uid === "alice" ? [{ ...summary, available: false }] : [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(createElement(SavedReplayReviews));
    fireEvent.click(await view.findByRole("button", { name: "View saved notes" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith(replayId))).toBe(true));
    act(() => signIn("bob"));
    expect(view.queryByRole("heading", { name: "Shen vs Mel" })).not.toBeInTheDocument();
    await view.findByRole("heading", { name: "No saved reviews yet" });
    await act(async () => resolveNotes(json({ accountId: "alice", review: { ...summary, notes: [note] } })));
    expect(view.queryByText("My own private analysis")).not.toBeInTheDocument();
  });

  it("does not delete a review changed on another device", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "DELETE" ? json({ accountId: "alice", code: "review_conflict", review: { ...summary, revision: 3, notes: [note] } }, 409) : json({ accountId: "alice", items: [summary], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(createElement(SavedReplayReviews));
    fireEvent.click(await view.findByRole("button", { name: "Remove Shen vs Mel from my reviews" }));
    fireEvent.click(view.getByRole("button", { name: "Remove review and notes" }));
    expect(await view.findByRole("alert")).toHaveTextContent("changed on another device");
    expect(view.getByRole("heading", { name: "Shen vs Mel" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "DELETE")).toHaveLength(1);
  });

  it("can paginate past an empty server page without treating it as the end", async () => {
    const fetchMock = vi.fn(async (url: unknown) => String(url).includes("cursor=") ? json({ accountId: "alice", items: [summary], nextCursor: null }) : json({ accountId: "alice", items: [], nextCursor: "opaque-cursor" }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(createElement(SavedReplayReviews));
    fireEvent.click(await view.findByRole("button", { name: "Load more reviews" }));
    expect(await view.findByRole("heading", { name: "Shen vs Mel" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v2/reviews?cursor=opaque-cursor", expect.objectContaining({ credentials: "include" }));
  });

  it("selects My reviews from either desktop or website entry and avoids unrelated replay requests", async () => {
    const fetchMock = vi.fn(async (url: unknown) => { expect(url).toBe("/api/v2/reviews"); return json({ accountId: "alice", items: [], nextCursor: null }); });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(createElement(ReplayLibrary, { embedded: true, initialScope: "reviews" }));
    expect(view.getByRole("tab", { name: "My reviews" })).toHaveAttribute("aria-selected", "true");
    expect(await view.findByRole("heading", { name: "No saved reviews yet" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.every((call) => call[0] === "/api/v2/reviews")).toBe(true);
    expect(view.queryByText("Manual upload")).not.toBeInTheDocument();
  });

  it("refreshes private notes on focus when the original replay is unavailable", async () => {
    let body = "Original note";
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => String(url).endsWith(replayId) ? json({ accountId: "alice", review: { ...summary, available: false, notes: [{ ...note, body }] } }) : json({ accountId: "alice", items: [{ ...summary, available: false }], nextCursor: null })));
    const view = render(createElement(SavedReplayReviews));
    fireEvent.click(await view.findByRole("button", { name: "View saved notes" }));
    expect(await view.findByText("Original note")).toBeInTheDocument();
    body = "Changed on another device";
    act(() => window.dispatchEvent(new Event("focus")));
    expect(await view.findByText("Changed on another device")).toBeInTheDocument();
  });
});
