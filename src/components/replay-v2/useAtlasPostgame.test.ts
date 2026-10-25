import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalReplayV2, ReplayState } from "@/lib/replay-v2";

const auth = vi.hoisted(() => ({ user: null as null | { uid: string; isAnonymous: boolean; getIdToken: () => Promise<string> }, listeners: new Set<(user: unknown) => void>() }));
const core = vi.hoisted(() => ({ decode: vi.fn(), match: vi.fn(), encode: vi.fn(), project: vi.fn(), mulligan: vi.fn() }));
vi.mock("firebase/auth", () => ({ getAuth: () => ({}), onIdTokenChanged: (_: unknown, listener: (user: unknown) => void) => { auth.listeners.add(listener); listener(auth.user); return () => auth.listeners.delete(listener); } }));
vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));
vi.mock("@/lib/replay-v2/atlas-postgame", () => ({ decodeAtlasPostgameReplay: core.decode, matchAtlasPostgameReplay: core.match, encodeAtlasPostgameReplay: core.encode, projectAtlasPostgameState: core.project, buildAtlasMulliganSummary: core.mulligan }));
import { useAtlasPostgame } from "./useAtlasPostgame";

const replay = { replayId: "test" } as unknown as CanonicalReplayV2;
const position = { gameId: "g1", appliedEventIndex: 5 } as ReplayState;
const game = { gameId: "g1", gameNumber: 1, frameCount: 12, sha256: "hash1", shared: false };
const metadata = (accountId = "alice", available = true) => ({ accountId, canManage: accountId === "alice", available, games: available ? [game] : [] });
const full = (accountId = "alice") => ({ ...metadata(accountId), exports: [{ gameId: "g1", replay: { format: "riftatlas-replay" } }] });
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
const useTestHook = () => useAtlasPostgame({ replayId: "test", apiBasePath: "/api/v2/replays", replay });
const file = () => ({ size: 30, text: async () => "atlas export" }) as File;
function signIn(uid: string | null) { auth.user = uid ? { uid, isAnonymous: false, getIdToken: async () => `${uid}-token` } : null; auth.listeners.forEach(fn => fn(auth.user)); }

describe("Atlas post-game viewer account boundary", () => {
  beforeEach(() => {
    auth.user = null; auth.listeners.clear(); vi.clearAllMocks();
    core.decode.mockReturnValue({ view: { frames: [] } }); core.match.mockReturnValue({ gameId: "g1" }); core.encode.mockReturnValue({ format: "riftatlas-replay" });
    core.project.mockImplementation(state => ({ state: { ...state, imported: true }, available: true }));
    core.mulligan.mockReturnValue({ gameId: "g1", players: {} });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("defaults to Player view and loads hidden information only after All cards is chosen", async () => {
    const fetcher = vi.fn(async (url: unknown) => json(String(url).includes("metadata=1") ? metadata() : full())); vi.stubGlobal("fetch", fetcher);
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(useTestHook);
    await waitFor(() => expect(result.current.metadata?.available).toBe(true));
    expect(result.current.allCards).toBe(false); expect(core.decode).not.toHaveBeenCalled(); expect(result.current.project(position)).toBeNull(); expect(result.current.mulliganSummaries).toEqual([]);
    await act(async () => result.current.showAllCards());
    expect(result.current.allCards).toBe(true); expect(result.current.project(position)?.available).toBe(true); expect(result.current.mulliganSummaries).toHaveLength(1);
    act(() => result.current.showPlayerView()); expect(result.current.project(position)).toBeNull(); expect(result.current.mulliganSummaries).toEqual([]);
    await act(async () => result.current.showAllCards()); expect(core.decode).toHaveBeenCalledTimes(1);
    expect(storage).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.filter(call => !String(call[0]).includes("metadata=1"))).toHaveLength(2);
  });

  it("clears imported identities immediately on account switch and ignores a late reveal response", async () => {
    signIn("alice"); let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => String(url).includes("metadata=1") ? json(metadata(auth.user?.uid ?? "public", auth.user?.uid === "alice")) : new Promise<Response>(done => { resolve = done; })));
    const { result } = renderHook(useTestHook); await waitFor(() => expect(result.current.metadata?.accountId).toBe("alice"));
    let request!: Promise<void>; act(() => { request = result.current.showAllCards(); }); await waitFor(() => expect(resolve).toBeTypeOf("function"));
    act(() => signIn("bob")); expect(result.current.prepared).toEqual([]); expect(result.current.allCards).toBe(false); expect(result.current.mulliganSummaries).toEqual([]);
    await act(async () => { resolve(json(full("alice"))); await request; });
    await waitFor(() => expect(result.current.metadata?.accountId).toBe("bob")); expect(result.current.project(position)).toBeNull(); expect(core.decode).not.toHaveBeenCalled();
  });

  it("rejects wrong-game files locally and does not send them to the server", async () => {
    const fetcher = vi.fn(async () => json(metadata("alice", false))); vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(useTestHook); await waitFor(() => expect(result.current.metadata?.canManage).toBe(true));
    core.match.mockImplementationOnce(() => { throw new Error("This Atlas file belongs to a different replay."); });
    await act(async () => { expect(await result.current.importFile(file())).toBe(false); });
    expect(result.current.error).toContain("different replay"); expect(fetcher.mock.calls).toHaveLength(1); expect(result.current.allCards).toBe(false);
  });

  it("imports privately with a replacement revision and requires explicit sharing", async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => json(init?.method === "PATCH" ? { ...metadata(), games: [{ ...game, shared: true }] } : metadata())); vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(useTestHook); await waitFor(() => expect(result.current.metadata?.canManage).toBe(true));
    await act(async () => { expect(await result.current.importFile(file())).toBe(true); });
    const put = fetcher.mock.calls.find(call => call[1]?.method === "PUT")![1]!;
    expect(JSON.parse(String(put.body))).toEqual({ replay: { format: "riftatlas-replay" }, expectedAccountId: "alice", expectedSha256: "hash1" });
    expect(result.current.allCards).toBe(false); expect(result.current.metadata?.games[0].shared).toBe(false);
    await act(async () => result.current.setShared("g1", true));
    expect(JSON.parse(String(fetcher.mock.calls.find(call => call[1]?.method === "PATCH")![1]!.body))).toEqual({ gameId: "g1", shared: true, expectedAccountId: "alice", expectedSha256: "hash1" });
    expect(result.current.metadata?.games[0].shared).toBe(true);
  });

  it("loses private data when access expires and cannot use a cached reveal", async () => {
    let expired = false;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => expired ? json({ error: "Session expired" }, 401) : json(String(url).includes("metadata=1") ? metadata() : full())));
    const { result } = renderHook(useTestHook); await waitFor(() => expect(result.current.metadata?.available).toBe(true));
    await act(async () => result.current.showAllCards()); expect(result.current.allCards).toBe(true);
    expired = true; act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.prepared).toEqual([])); expect(result.current.project(position)).toBeNull(); expect(result.current.mulliganSummaries).toEqual([]);
  });

  it("drops an already visible mulligan summary on account change or attachment replacement", async () => {
    signIn("alice"); let replaced = false;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      const current = metadata(auth.user?.uid ?? "public");
      if (replaced) current.games = [{ ...game, sha256: "replacement" }];
      return json(String(url).includes("metadata=1") ? current : full(auth.user?.uid ?? "public"));
    }));
    const { result } = renderHook(useTestHook);
    await waitFor(() => expect(result.current.metadata?.available).toBe(true));
    await act(async () => result.current.showAllCards());
    expect(result.current.mulliganSummaries).toHaveLength(1);
    replaced = true; act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.mulliganSummaries).toEqual([]));
    expect(result.current.allCards).toBe(false);
    replaced = false; act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.metadata?.games[0].sha256).toBe("hash1"));
    await act(async () => result.current.showAllCards());
    expect(result.current.mulliganSummaries).toHaveLength(1);
    act(() => signIn("bob"));
    expect(result.current.mulliganSummaries).toEqual([]);
    expect(result.current.prepared).toEqual([]);
  });

  it("keeps an older server usable when the optional endpoint is not deployed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Not found" }, 404)));
    const { result } = renderHook(useTestHook); await act(async () => {});
    expect(result.current.error).toBe(""); expect(result.current.allCards).toBe(false); expect(result.current.metadata).toBeNull();
  });
});
