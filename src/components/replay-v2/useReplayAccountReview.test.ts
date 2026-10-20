import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ReplayNote } from "./replay-notes";

const auth = vi.hoisted(() => ({ user: null as null | { uid: string; isAnonymous: boolean; getIdToken: () => Promise<string> }, listeners: new Set<(user: unknown) => void>() }));
vi.mock("firebase/auth", () => ({ getAuth: () => ({}), onIdTokenChanged: (_auth: unknown, listener: (user: unknown) => void) => { auth.listeners.add(listener); listener(auth.user); return () => auth.listeners.delete(listener); } }));
vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));
import { useReplayAccountReview } from "./useReplayAccountReview";

const replayId = `rl2_${"a".repeat(32)}`;
const note = (body = "My private thought"): ReplayNote => ({ id: "note-1", atMs: 1200, eventId: "event-1", eventIndex: 3, gameId: "game-1", gameNumber: 1, turn: 1, title: "Opening", body, createdAt: 10, updatedAt: 10 });
const review = (revision = 1, notes = [note()]) => ({ replayId, revision, notes, createdAt: 10, updatedAt: 10, title: "Shen vs Mel", platform: "atlas", available: true });
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
function signIn(uid: string | null) { auth.user = uid ? { uid, isAnonymous: false, getIdToken: async () => `${uid}-token` } : null; auth.listeners.forEach((listener) => listener(auth.user)); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe("private account replay reviews", () => {
  beforeEach(() => { auth.user = null; auth.listeners.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

  it("shows signed-out state without reading or importing browser-local notes", async () => {
    window.localStorage.setItem(`riftlite:replay-notes:v1:${replayId}`, JSON.stringify({ notes: [note("Another browser user's note")] }));
    const storageRead = vi.spyOn(Storage.prototype, "getItem");
    const fetchMock = vi.fn(async () => json({ error: "Sign in" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReplayAccountReview({ replayId }));
    await waitFor(() => expect(result.current.status).toBe("signed-out"));
    expect(result.current.notes).toEqual([]);
    expect(storageRead).not.toHaveBeenCalled();
    expect(await result.current.saveReview()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("supports the desktop HttpOnly account and creates an empty private bookmark", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "PUT" ? json({ accountId: "canonical-alice", review: review(1, []) }) : json({ accountId: "canonical-alice", review: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReplayAccountReview({ replayId }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => { expect(await result.current.saveReview()).toBe(true); });
    const init = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT")![1]!;
    expect(JSON.parse(init.body as string)).toEqual({ expectedAccountId: "canonical-alice", expectedRevision: null, notes: [] });
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    expect(result.current.review?.revision).toBe(1);
  });

  it("sends Firebase authentication but binds saves to the canonical account and loaded revision", async () => {
    signIn("firebase-alice");
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => json({ accountId: "canonical-alice", review: review(init?.method === "PUT" ? 2 : 1) }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReplayAccountReview({ replayId }));
    await waitFor(() => expect(result.current.review?.revision).toBe(1));
    await act(async () => { expect(await result.current.saveNotes([note()])).toBe(true); });
    const init = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT")![1]!;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer firebase-alice-token");
    expect(JSON.parse(init.body as string)).toEqual({ expectedAccountId: "canonical-alice", expectedRevision: 1, notes: [note()] });
  });

  it("clears notes immediately when accounts switch and ignores the old account's in-flight response", async () => {
    signIn("alice");
    const late = deferred<Response>();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { calls += 1; return calls === 1 ? json({ accountId: "alice", review: review() }) : calls === 2 ? late.promise : json({ accountId: "bob", review: null }); }));
    const { result } = renderHook(() => useReplayAccountReview({ replayId }));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    const oldSession = result.current.sessionKey;
    act(() => { void result.current.refresh(); });
    await waitFor(() => expect(calls).toBe(2));
    act(() => signIn("bob"));
    expect(result.current.notes).toEqual([]);
    expect(result.current.sessionKey).not.toBe(oldSession);
    await waitFor(() => expect(result.current.accountId).toBe("bob"));
    await act(async () => late.resolve(json({ accountId: "alice", review: review(2, [note("Alice must stay private")]) })));
    expect(result.current.accountId).toBe("bob");
    expect(result.current.notes).toEqual([]);
  });

  it("does not send a request after its Firebase token finishes for a previous account", async () => {
    const token = deferred<string>();
    auth.user = { uid: "alice", isAnonymous: false, getIdToken: () => token.promise };
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => { expect(url).toBe(`/api/v2/reviews/${replayId}`); expect(init?.credentials).toBe("include"); return json({ accountId: "bob", review: null }); });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReplayAccountReview({ replayId }));
    act(() => signIn("bob"));
    await waitFor(() => expect(result.current.accountId).toBe("bob"));
    await act(async () => token.resolve("alice-token"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer bob-token");
  });

  it("keeps an editor's base revision on focus, preserves a conflicting draft and retries only deliberately", async () => {
    let remoteRevision = 1;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method !== "PUT") return json({ accountId: "alice", review: review(remoteRevision) });
      const body = JSON.parse(init.body as string);
      if (body.expectedRevision !== remoteRevision) return json({ accountId: "alice", code: "review_conflict", error: "Conflict", review: review(remoteRevision) }, 409);
      return json({ accountId: "alice", review: review(++remoteRevision, body.notes) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ paused }) => useReplayAccountReview({ replayId, paused }), { initialProps: { paused: false } });
    await waitFor(() => expect(result.current.review?.revision).toBe(1));
    rerender({ paused: true });
    remoteRevision = 2;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(result.current.review?.revision).toBe(1);
    await act(async () => { expect(await result.current.saveNotes([note("My unsaved draft")])).toBe(false); });
    expect(result.current.conflict?.latest?.revision).toBe(2);
    expect(result.current.pendingNotes?.[0].body).toBe("My unsaved draft");
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(1);
    await act(async () => { expect(await result.current.retryDraft()).toBe(true); });
    expect(result.current.notes[0].body).toBe("My unsaved draft");
    expect(result.current.review?.revision).toBe(3);
    expect(result.current.pendingNotes).toBe(null);
  });

  it("retains the pending draft when reload fails, and discards only after a successful explicit reload", async () => {
    let mode = "initial";
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "PUT") return json({ accountId: "alice", code: "review_conflict", review: review(2) }, 409);
      if (mode === "offline") throw new Error("Offline");
      return json({ accountId: "alice", review: review(mode === "initial" ? 1 : 2) });
    }));
    const { result } = renderHook(() => useReplayAccountReview({ replayId, paused: true }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => { await result.current.saveNotes([note("Keep this draft")]); });
    mode = "offline";
    await act(async () => { expect(await result.current.reloadLatest()).toBe(false); });
    expect(result.current.pendingNotes?.[0].body).toBe("Keep this draft");
    expect(result.current.status).toBe("ready");
    mode = "online";
    await act(async () => { expect(await result.current.reloadLatest()).toBe(true); });
    expect(result.current.pendingNotes).toBe(null);
    expect(result.current.review?.revision).toBe(2);
  });

  it("refreshes other-device changes on focus without writing local storage", async () => {
    let revision = 1;
    vi.stubGlobal("fetch", vi.fn(async () => json({ accountId: "alice", review: review(revision, [note(`Version ${revision}`)]) })));
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useReplayAccountReview({ replayId }));
    await waitFor(() => expect(result.current.notes[0]?.body).toBe("Version 1"));
    revision = 2;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(result.current.notes[0]?.body).toBe("Version 2"));
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it("recognizes a changed desktop cookie account even during a draft", async () => {
    let accountId = "alice";
    vi.stubGlobal("fetch", vi.fn(async () => json({ accountId, review: accountId === "alice" ? review() : null })));
    const { result } = renderHook(() => useReplayAccountReview({ replayId, paused: true }));
    await waitFor(() => expect(result.current.accountId).toBe("alice"));
    const boundary = result.current.boundaryKey;
    accountId = "bob";
    await act(async () => { await result.current.refresh(); });
    expect(result.current.accountId).toBe("bob");
    expect(result.current.notes).toEqual([]);
    expect(result.current.boundaryKey).not.toBe(boundary);
  });

  it("clears all old notes and pending drafts if a write detects an account mismatch", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "PUT" ? json({ accountId: "bob", code: "review_account_changed" }, 409) : json({ accountId: "alice", review: review() })));
    const { result } = renderHook(() => useReplayAccountReview({ replayId }));
    await waitFor(() => expect(result.current.accountId).toBe("alice"));
    await act(async () => { expect(await result.current.saveNotes([note("Alice draft")])).toBe(false); });
    expect(result.current.notes).toEqual([]);
    expect(result.current.pendingNotes).toBe(null);
    expect(result.current.accountId).toBe(null);
  });

  it("cannot replace a failed initial note-save draft with an empty bookmark", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "PUT" ? json({ accountId: "alice", code: "review_conflict", review: review() }, 409) : json({ accountId: "alice", review: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReplayAccountReview({ replayId }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => { expect(await result.current.saveNotes([note("Keep my first thought")])).toBe(false); });
    await act(async () => { expect(await result.current.saveReview()).toBe(false); });
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(1);
    expect(result.current.pendingNotes?.[0].body).toBe("Keep my first thought");
  });

  it("hides private notes on cookie expiry and restores the same account's edit revision after reconnecting", async () => {
    let expired = false;
    let remoteRevision = 1;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (expired) return json({ code: "authentication_required" }, 401);
      if (init?.method === "PUT") return json({ accountId: "alice", code: "review_conflict", review: review(remoteRevision) }, 409);
      return json({ accountId: "alice", review: review(remoteRevision) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ paused }) => useReplayAccountReview({ replayId, paused }), { initialProps: { paused: false } });
    await waitFor(() => expect(result.current.review?.revision).toBe(1));
    const boundary = result.current.boundaryKey;
    rerender({ paused: true });
    expired = true;
    await act(async () => { await result.current.refresh(); });
    expect(result.current.status).toBe("expired");
    expect(result.current.notes).toEqual([]);
    expect(result.current.review).toBe(null);
    expect(result.current.hasPendingChanges).toBe(true);
    expect(result.current.boundaryKey).toBe(boundary);
    expired = false;
    remoteRevision = 2;
    await act(async () => { await result.current.refresh(); });
    expect(result.current.status).toBe("ready");
    expect(result.current.review?.revision).toBe(1);
    expect(result.current.boundaryKey).toBe(boundary);
    await act(async () => { await result.current.saveNotes([note("My work before reconnecting")]); });
    const init = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT")![1]!;
    expect(JSON.parse(init.body as string).expectedRevision).toBe(1);
    expect(result.current.conflict?.latest?.revision).toBe(2);
  });

  it("keeps a failed note-save draft hidden in memory through expiry and a failed reconnect", async () => {
    let mode = "initial";
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (mode === "expired") return json({ code: "authentication_required" }, 401);
      if (mode === "offline") throw new Error("Connection unavailable");
      if (init?.method === "PUT") return json({ accountId: "alice", review: review(2, JSON.parse(init.body as string).notes) });
      return json({ accountId: "alice", review: review() });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReplayAccountReview({ replayId }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const boundary = result.current.boundaryKey;
    mode = "expired";
    await act(async () => { expect(await result.current.saveNotes([note("Do not lose this thought")])).toBe(false); });
    expect(result.current.status).toBe("expired");
    expect(result.current.pendingNotes).toBe(null);
    expect(result.current.conflict).toBe(null);
    expect(result.current.notes).toEqual([]);
    expect(result.current.hasPendingChanges).toBe(true);
    mode = "offline";
    await act(async () => { expect(await result.current.refresh()).toBe(false); });
    expect(result.current.status).toBe("expired");
    expect(result.current.hasPendingChanges).toBe(true);
    mode = "reconnected";
    await act(async () => { await result.current.refresh(); });
    expect(result.current.status).toBe("ready");
    expect(result.current.pendingNotes?.[0].body).toBe("Do not lose this thought");
    expect(result.current.boundaryKey).toBe(boundary);
    await act(async () => { expect(await result.current.retryDraft()).toBe(true); });
    expect(result.current.notes[0].body).toBe("Do not lose this thought");
    expect(result.current.hasPendingChanges).toBe(false);
  });

  it("discards an expired account's held draft instead of exposing it to a different canonical account", async () => {
    let mode = "alice";
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "PUT" ? json({ code: "authentication_required" }, 401) : json({ accountId: mode, review: mode === "alice" ? review() : null })));
    const { result } = renderHook(() => useReplayAccountReview({ replayId }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => { await result.current.saveNotes([note("Alice's held draft")]); });
    const boundary = result.current.boundaryKey;
    expect(result.current.status).toBe("expired");
    mode = "bob";
    await act(async () => { await result.current.refresh(); });
    expect(result.current.accountId).toBe("bob");
    expect(result.current.status).toBe("ready");
    expect(result.current.notes).toEqual([]);
    expect(result.current.pendingNotes).toBe(null);
    expect(result.current.hasPendingChanges).toBe(false);
    expect(result.current.boundaryKey).not.toBe(boundary);
    expect(await result.current.retryDraft()).toBe(false);
  });

  it("treats an explicit Firebase sign-out as a boundary that clears a held expired draft", async () => {
    signIn("alice");
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => !auth.user || init?.method === "PUT" ? json({ code: "authentication_required" }, 401) : json({ accountId: "alice", review: review() })));
    const { result } = renderHook(() => useReplayAccountReview({ replayId }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => { await result.current.saveNotes([note("Held draft")]); });
    expect(result.current.status).toBe("expired");
    act(() => signIn(null));
    expect(result.current.hasPendingChanges).toBe(false);
    await waitFor(() => expect(result.current.status).toBe("signed-out"));
    act(() => signIn("alice"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.pendingNotes).toBe(null);
    expect(result.current.notes[0].body).toBe("My private thought");
  });

  it("handles an expired Firebase credential without falling back to a different cookie account", async () => {
    let expired = false;
    auth.user = { uid: "alice", isAnonymous: false, getIdToken: async () => { if (expired) throw Object.assign(new Error("Expired"), { code: "auth/user-token-expired" }); return "alice-token"; } };
    const fetchMock = vi.fn(async () => json({ accountId: "alice", review: review() }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReplayAccountReview({ replayId }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expired = true;
    await act(async () => { await result.current.refresh(); });
    expect(result.current.status).toBe("expired");
    expect(result.current.notes).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
