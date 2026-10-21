import { createElement } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeRawCaptureV1, type CanonicalReplayV2 } from "@/lib/replay-v2";
import { syntheticBo3Capture } from "@/lib/replay-v2/__fixtures__/synthetic-captures";
import type { SavedReplayReview } from "@/lib/replay-reviews";
import type { useReplayAccountReview } from "./useReplayAccountReview";
import { createReplayNotesProject, replayNotesStorageKey, type ReplayNote } from "./replay-notes";

const mocks = vi.hoisted(() => ({ account: null as unknown, saveReview: vi.fn(async () => true), saveNotes: vi.fn(async (notes: unknown) => Boolean(notes)) }));
vi.mock("./useReplayAccountReview", () => ({ useReplayAccountReview: () => mocks.account }));
vi.mock("firebase/auth", () => ({ getAuth: () => ({ authStateReady: async () => undefined, currentUser: null }) }));
vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));
import { ReplayV2Player } from "./ReplayV2Player";

const replayId = "rp_account_review";
let replay: CanonicalReplayV2;
function accountState(patch: Partial<ReturnType<typeof useReplayAccountReview>> = {}): ReturnType<typeof useReplayAccountReview> {
  return { status: "ready", accountId: "account-a", boundaryKey: "account-a:1", sessionKey: 1, review: null, notes: [], saving: false, error: "", conflict: null, pendingNotes: null,
    hasPendingChanges: false, saveReview: mocks.saveReview, saveNotes: mocks.saveNotes, refresh: async () => true, reloadLatest: async () => true, retryDraft: async () => true, ...patch };
}
function note(title: string): ReplayNote {
  const event = replay.events[1];
  if (!event.gameId) throw new Error("The review fixture must start inside a game.");
  return { id: title, title, body: `${title} private text`, atMs: event.atMs, eventId: event.id, eventIndex: 1, gameId: event.gameId, gameNumber: 1, turn: null, createdAt: 1, updatedAt: 1 };
}
function review(notes: ReplayNote[]): SavedReplayReview { return { replayId, revision: 1, notes, createdAt: 1, updatedAt: 1, title: "Public sample", platform: "atlas", available: true }; }
beforeEach(() => {
  vi.clearAllMocks(); window.localStorage.clear(); window.history.replaceState({}, "", `/replays/${replayId}?t=2.5`);
  replay = normalizeRawCaptureV1(syntheticBo3Capture()); mocks.account = accountState();
  mocks.saveNotes.mockResolvedValue(true); mocks.saveReview.mockResolvedValue(true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), { headers: { "content-type": "application/json" } })));
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => undefined;
  if (!HTMLElement.prototype.animate) HTMLElement.prototype.animate = () => ({ pause() {}, play() {} }) as Animation;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); window.history.replaceState({}, "", "/"); });
async function open() { const view = render(createElement(ReplayV2Player, { replayId })); await view.findByRole("slider", { name: "Replay progress" }); return view; }

describe("player account reviews", () => {
  it("opens the review tools directly from a saved-library link", async () => {
    window.history.replaceState({}, "", `/replays/${replayId}?review=1`);
    const view = await open();
    expect(await view.findByRole("complementary", { name: "Game review" })).toBeVisible();
  });
  it("saves a public replay and anchored private notes without importing or rewriting browser notes", async () => {
    const browser = { ...createReplayNotesProject(replayId), notes: [note("Old browser note")] };
    window.localStorage.setItem(replayNotesStorageKey(replayId), JSON.stringify(browser));
    const view = await open();
    fireEvent.click(view.getByRole("button", { name: "Review game" }));
    fireEvent.click(view.getByRole("button", { name: "Save to my reviews" }));
    expect(mocks.saveReview).toHaveBeenCalledOnce(); expect(mocks.saveNotes).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Add a thought" }));
    fireEvent.change(view.getByRole("textbox", { name: "Replay note" }), { target: { value: "My private decision" } });
    mocks.saveNotes.mockImplementation(async (value) => { const notes = value as ReplayNote[]; mocks.account = accountState({ review: review(notes), notes }); return true; });
    fireEvent.click(view.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(view.queryByRole("textbox", { name: "Replay note" })).not.toBeInTheDocument());
    const saved = mocks.saveNotes.mock.calls[0][0] as ReplayNote[];
    expect(saved).toHaveLength(1); expect(saved[0].body).toBe("My private decision");
    expect(saved[0].eventId).toBe(replay.events[saved[0].eventIndex].id);
    expect(JSON.parse(window.localStorage.getItem(replayNotesStorageKey(replayId))!)).toEqual(browser);
    expect(view.queryByText("Old browser note private text")).not.toBeInTheDocument();
  });

  it("hides an account's notes and draft as soon as the identity boundary changes", async () => {
    const notes = [note("Account A secret")]; mocks.account = accountState({ review: review(notes), notes });
    const view = await open(); fireEvent.click(view.getByRole("button", { name: "Review game" }));
    fireEvent.click(view.getByRole("button", { name: "Add a thought" }));
    fireEvent.change(view.getByRole("textbox", { name: "Replay note" }), { target: { value: "Unsaved account A secret" } });
    mocks.account = accountState({ status: "loading", accountId: null, boundaryKey: "switching-b", sessionKey: 2 });
    view.rerender(createElement(ReplayV2Player, { replayId }));
    expect(view.queryByRole("textbox", { name: "Replay note" })).not.toBeInTheDocument();
    expect(view.container.textContent).not.toContain("Account A secret");
    const b = [note("Account B note")]; mocks.account = accountState({ accountId: "account-b", boundaryKey: "account-b:2", sessionKey: 2, review: review(b), notes: b });
    view.rerender(createElement(ReplayV2Player, { replayId }));
    expect(view.container.textContent).not.toContain("Account A secret"); expect(mocks.saveNotes).not.toHaveBeenCalled();
  });

  it("hides an expired account draft, warns before leaving, and restores it only in the same account scope", async () => {
    const view = await open();
    fireEvent.click(view.getByRole("button", { name: "Review game" }));
    fireEvent.click(view.getByRole("button", { name: "Add a thought" }));
    fireEvent.change(view.getByRole("textbox", { name: "Replay note" }), { target: { value: "Private unfinished draft" } });
    mocks.account = accountState({ status: "expired" });
    view.rerender(createElement(ReplayV2Player, { replayId }));
    expect(view.queryByRole("textbox", { name: "Replay note" })).not.toBeInTheDocument();
    expect(view.container.textContent).not.toContain("Private unfinished draft");
    expect(window.localStorage.getItem(replayNotesStorageKey(replayId))).toBeNull();
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    mocks.account = accountState();
    view.rerender(createElement(ReplayV2Player, { replayId }));
    expect(view.getByRole("textbox", { name: "Replay note" })).toHaveValue("Private unfinished draft");
    mocks.account = accountState({ status: "expired" });
    view.rerender(createElement(ReplayV2Player, { replayId }));
    mocks.account = accountState({ accountId: "account-b", boundaryKey: "account-b:2", sessionKey: 2 });
    view.rerender(createElement(ReplayV2Player, { replayId }));
    expect(view.queryByRole("textbox", { name: "Replay note" })).not.toBeInTheDocument();
    expect(view.container.textContent).not.toContain("Private unfinished draft");
    expect(mocks.saveNotes).not.toHaveBeenCalled();
  });

  it("keeps an unsaved note open on failure and exposes explicit conflict recovery", async () => {
    const view = await open(); fireEvent.click(view.getByRole("button", { name: "Review game" })); fireEvent.click(view.getByRole("button", { name: "Add a thought" }));
    fireEvent.change(view.getByRole("textbox", { name: "Replay note" }), { target: { value: "Keep this draft" } });
    mocks.saveNotes.mockImplementation(async value => { const draftNotes = value as ReplayNote[]; mocks.account = accountState({ conflict: { latest: review([note("Other device")]), draftNotes }, pendingNotes: draftNotes, error: "This review changed on another device." }); return false; });
    fireEvent.click(view.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Load latest notes" })).toBeInTheDocument());
    expect(view.getByRole("textbox", { name: "Replay note" })).toHaveValue("Keep this draft");
    expect(view.getByRole("textbox", { name: "Replay note" })).toBeDisabled();
    expect(view.getByRole("textbox", { name: "Replay note title" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Save note" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Use my version" })).toBeInTheDocument();
    expect(window.localStorage.getItem(replayNotesStorageKey(replayId))).toBeNull();
  });
});
