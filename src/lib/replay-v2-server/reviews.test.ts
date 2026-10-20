import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayNote } from "@/components/replay-v2/replay-notes";

const mocks = vi.hoisted(() => ({ getFirestoreAdmin: vi.fn(), verifyFirebaseIdToken: vi.fn(), hubAccess: vi.fn(), identityUids: vi.fn() }));
vi.mock("@/lib/firebase/admin", () => ({ getFirestoreAdmin: mocks.getFirestoreAdmin, verifyFirebaseIdToken: mocks.verifyFirebaseIdToken }));
vi.mock("@/lib/social/server", () => ({ identityUidsFor: mocks.identityUids }));
vi.mock("@/lib/replay-v2-server/hub-grants", () => ({ privateReplayHubAccessAllowsViewer: mocks.hubAccess }));

import { GET as listRoute } from "@/app/api/v2/reviews/route";
import { GET as getRoute, PUT, DELETE } from "@/app/api/v2/reviews/[replayId]/route";
import { MAX_REVIEW_JSON_BYTES } from "@/lib/replay-reviews";
import { REPLAY_EMBED_COOKIE, signReplayEmbedSession } from "./session";
import { deleteSavedReplayReview, listSavedReplayReviews, readSavedReplayReview, saveReplayReview } from "./reviews";

const REPLAY_ID = `rl2_${"a".repeat(32)}`;
const REPLAY_ID_B = `rl2_${"b".repeat(32)}`;
const ORIGIN = "https://www.riftlite.com";
const secret = "private-review-test-session-secret-32-bytes";
const note: ReplayNote = { id: "note-a", atMs: 10, eventId: "event-a", eventIndex: 2, gameId: "game-a", gameNumber: 1, turn: 1, title: "Private thought", body: "Keep my analysis to myself.", createdAt: 1, updatedAt: 2 };
let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("REPLAY_EMBED_SESSION_SECRET", secret);
  db = fakeDb();
  db.records.set(`replayV2/${REPLAY_ID}`, source());
  mocks.getFirestoreAdmin.mockReturnValue(db);
  mocks.identityUids.mockImplementation(async (uid: string) => [uid]);
  mocks.hubAccess.mockResolvedValue(false);
  mocks.verifyFirebaseIdToken.mockImplementation(async (token: string) => token === "invalid" ? null : ({ uid: token, riftlite_linked_account: true }));
});
afterEach(() => vi.unstubAllEnvs());

describe("account-private review storage and replay permissions", () => {
  it("saves somebody else's public replay without mutating the replay or public indexes", async () => {
    const before = structuredClone(db.records.get(`replayV2/${REPLAY_ID}`));
    const saved = await saveReplayReview("reviewer", REPLAY_ID, input("reviewer"));
    expect(saved).toMatchObject({ revision: 1, notes: [note], available: true, title: "Test match" });
    expect(db.records.get(`replayV2/${REPLAY_ID}`)).toEqual(before);
    expect(db.writes).toEqual([`replayPrivateReviews/reviewer/items/${REPLAY_ID}`]);
    expect(await readSavedReplayReview("another-reviewer", REPLAY_ID)).toBeNull();
    expect((await listSavedReplayReviews("another-reviewer")).items).toEqual([]);
  });
  it.each(["unlisted", "private"])("supports authorized %s replay reviews", async (visibility) => {
    db.records.set(`replayV2/${REPLAY_ID}`, source({ visibility }));
    await expect(saveReplayReview("owner", REPLAY_ID, input("owner"))).resolves.toMatchObject({ available: true });
  });
  it("reuses live hub/combined grant access and denies ex-members on later saves", async () => {
    db.records.set(`replayV2/${REPLAY_ID}`, source({ visibility: "private" }));
    mocks.hubAccess.mockResolvedValue(true);
    await saveReplayReview("member", REPLAY_ID, input("member"));
    expect(mocks.hubAccess).toHaveBeenCalledWith(db, expect.objectContaining({ replayId: REPLAY_ID }), "member");
    mocks.hubAccess.mockResolvedValue(false);
    await expect(saveReplayReview("member", REPLAY_ID, input("member", 1))).rejects.toMatchObject({ status: 403, code: "replay_private" });
    expect(await readSavedReplayReview("member", REPLAY_ID)).toMatchObject({ notes: [note], available: false, revision: 1 });
    expect((await listSavedReplayReviews("member")).items[0].available).toBe(false);
  });
  it("denies another account's private replay and never creates a review on denial", async () => {
    db.records.set(`replayV2/${REPLAY_ID}`, source({ visibility: "private" }));
    await expect(saveReplayReview("outsider", REPLAY_ID, input("outsider"))).rejects.toMatchObject({ status: 403 });
    expect(db.writes).toEqual([]);
  });
  it("keeps private notes if the original is deleted and permits removing that private review", async () => {
    await saveReplayReview("reviewer", REPLAY_ID, input("reviewer"));
    db.records.delete(`replayV2/${REPLAY_ID}`);
    expect(await readSavedReplayReview("reviewer", REPLAY_ID)).toMatchObject({ notes: [note], available: false });
    await expect(saveReplayReview("reviewer", REPLAY_ID, input("reviewer", 1))).rejects.toMatchObject({ status: 404 });
    await deleteSavedReplayReview("reviewer", REPLAY_ID, { expectedAccountId: "reviewer", expectedRevision: 1 });
    expect(await readSavedReplayReview("reviewer", REPLAY_ID)).toBeNull();
    expect(db.records.get(`replayPrivateReviews/reviewer/items/${REPLAY_ID}`)).not.toHaveProperty("notes");
  });
  it("rejects not-ready replays and ready records without an artifact", async () => {
    for (const patch of [{ status: "processing" }, { canonicalArtifact: undefined }]) {
      db.records.set(`replayV2/${REPLAY_ID}`, source(patch));
      await expect(saveReplayReview("reviewer", REPLAY_ID, input("reviewer"))).rejects.toMatchObject({ code: "review_replay_not_ready" });
    }
    expect(db.writes).toEqual([]);
  });
  it("returns a summary-only list and does not even read note bodies in list queries", async () => {
    await saveReplayReview("reviewer", REPLAY_ID, input("reviewer"));
    const writeCount = db.writes.length;
    const page = await listSavedReplayReviews("reviewer");
    expect(page.items[0]).toMatchObject({ replayId: REPLAY_ID, noteCount: 1, revision: 1 });
    expect(page.items[0]).not.toHaveProperty("notes");
    expect(JSON.stringify(page)).not.toContain(note.body);
    expect(db.selections[0]).not.toContain("notes");
    expect(db.writes).toHaveLength(writeCount);
  });
  it("paginates independently for the signed-in account with validated opaque cursors", async () => {
    db.records.set(`replayV2/${REPLAY_ID_B}`, source({ replayId: REPLAY_ID_B }));
    await saveReplayReview("reviewer", REPLAY_ID, input("reviewer"));
    await saveReplayReview("reviewer", REPLAY_ID_B, input("reviewer"));
    const first = await listSavedReplayReviews("reviewer", "1");
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await listSavedReplayReviews("reviewer", "1", first.nextCursor);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].replayId).not.toBe(first.items[0].replayId);
    expect(second.nextCursor).toBeNull();
    await expect(listSavedReplayReviews("reviewer", "101")).rejects.toMatchObject({ status: 400 });
    await expect(listSavedReplayReviews("reviewer", "2", "bad cursor")).rejects.toMatchObject({ status: 400 });
  });
  it("does not silently replace corrupt stored cloud notes", async () => {
    await saveReplayReview("reviewer", REPLAY_ID, input("reviewer"));
    const path = `replayPrivateReviews/reviewer/items/${REPLAY_ID}`;
    db.records.set(path, { ...db.records.get(path), notes: [{ ...note, atMs: -1 }] });
    await expect(readSavedReplayReview("reviewer", REPLAY_ID)).rejects.toMatchObject({ code: "review_record_invalid" });
    await expect(saveReplayReview("reviewer", REPLAY_ID, input("reviewer", 1))).rejects.toMatchObject({ code: "review_record_invalid" });
    expect(db.writes).toHaveLength(1);
  });
});

describe("private review concurrency and account switches", () => {
  it("rejects stale updates with the current private review and preserves both server notes and revision", async () => {
    await saveReplayReview("reviewer", REPLAY_ID, input("reviewer"));
    const latest = await saveReplayReview("reviewer", REPLAY_ID, { ...input("reviewer", 1), notes: [{ ...note, body: "Changed on device two" }] });
    await expect(saveReplayReview("reviewer", REPLAY_ID, input("reviewer", 1))).rejects.toMatchObject({ code: "review_conflict", review: latest });
    expect(await readSavedReplayReview("reviewer", REPLAY_ID)).toEqual(latest);
  });
  it("protects deletes and delete/re-create cycles against stale revisions", async () => {
    await saveReplayReview("reviewer", REPLAY_ID, input("reviewer"));
    await deleteSavedReplayReview("reviewer", REPLAY_ID, { expectedAccountId: "reviewer", expectedRevision: 1 });
    const recreated = await saveReplayReview("reviewer", REPLAY_ID, input("reviewer"));
    expect(recreated.revision).toBe(3);
    await expect(saveReplayReview("reviewer", REPLAY_ID, input("reviewer", 1))).rejects.toMatchObject({ code: "review_conflict" });
    await expect(deleteSavedReplayReview("reviewer", REPLAY_ID, { expectedAccountId: "reviewer", expectedRevision: 1 })).rejects.toMatchObject({ code: "review_conflict" });
    expect(await readSavedReplayReview("reviewer", REPLAY_ID)).toEqual(recreated);
  });
  it("rejects payloads captured for a previous account before touching Firestore", async () => {
    await expect(saveReplayReview("account-b", REPLAY_ID, input("account-a"))).rejects.toMatchObject({ code: "review_account_changed" });
    await expect(deleteSavedReplayReview("account-b", REPLAY_ID, { expectedAccountId: "account-a", expectedRevision: 1 })).rejects.toMatchObject({ code: "review_account_changed" });
    expect(mocks.getFirestoreAdmin).not.toHaveBeenCalled();
  });
});

describe("review routes with real bearer/cookie auth and bounded JSON", () => {
  it("requires an account for reads and never trusts a UID query parameter", async () => {
    await saveReplayReview("owner", REPLAY_ID, input("owner"));
    expect((await getRoute(request("GET"), context())).status).toBe(401);
    const response = await listRoute(new Request(`${ORIGIN}/api/v2/reviews?uid=owner`, { headers: { authorization: "Bearer attacker" } }));
    expect(await response.json()).toMatchObject({ accountId: "attacker", items: [] });
    const detail = await getRoute(request("GET", "attacker"), context());
    expect(await detail.json()).toEqual({ accountId: "attacker", review: null });
  });
  it("accepts canonical account bearer auth and strips account identifiers from public replay records", async () => {
    db.records.set("identityAliases/legacy-device", { canonicalUid: "account-a", sourceUid: "legacy-device" });
    const response = await PUT(request("PUT", "legacy-device", input("account-a")), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accountId: "account-a", review: { notes: [note] } });
    expect(db.writes).toEqual([`replayPrivateReviews/account-a/items/${REPLAY_ID}`]);
    expect(db.records.get(`replayV2/${REPLAY_ID}`)).not.toHaveProperty("notes");
  });
  it("accepts the existing HttpOnly desktop session only for same-origin mutations", async () => {
    const response = await PUT(cookieRequest("PUT", ORIGIN), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accountId: "reviewer" });
    const read = await getRoute(cookieRequest("GET"), context());
    expect(await read.json()).toMatchObject({ review: { notes: [note] } });
  });
  it.each([undefined, "null", "https://evil.example"])("rejects a cookie write from %s", async (origin) => {
    const response = await PUT(cookieRequest("PUT", origin), context());
    expect(response.status).toBe(403);
    expect(db.writes).toEqual([]);
  });
  it("does not fall back to a valid cookie when an explicit bearer token is invalid", async () => {
    const req = cookieRequest("PUT", ORIGIN);
    req.headers.set("Authorization", "Bearer invalid");
    expect((await PUT(req, context())).status).toBe(401);
    expect(db.writes).toEqual([]);
  });
  it("rejects stale account payloads without returning the other account's notes", async () => {
    await saveReplayReview("account-b", REPLAY_ID, input("account-b"));
    const response = await PUT(request("PUT", "account-b", input("account-a")), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ accountId: "account-b", code: "review_account_changed", error: expect.any(String) });
  });
  it("returns optimistic conflicts explicitly instead of overwriting notes", async () => {
    await saveReplayReview("reviewer", REPLAY_ID, input("reviewer"));
    const response = await PUT(request("PUT", "reviewer", input("reviewer")), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ accountId: "reviewer", code: "review_conflict", review: { notes: [note], revision: 1 } });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
  });
  it("rejects spoofed fields and malformed IDs without writes", async () => {
    expect((await PUT(request("PUT", "reviewer", { ...input("reviewer"), uid: "victim" }), context())).status).toBe(400);
    expect((await PUT(request("PUT", "reviewer", input("reviewer")), context("../victim"))).status).toBe(400);
    expect(db.writes).toEqual([]);
  });
  it("rejects oversized bodies including Unicode byte sizes before storage", async () => {
    const req = request("PUT", "reviewer", input("reviewer"));
    req.headers.set("content-length", String(MAX_REVIEW_JSON_BYTES + 1));
    expect((await PUT(req, context())).status).toBe(413);
    const oversized = { ...input("reviewer"), notes: Array.from({ length: 100 }, (_, index) => ({ ...note, id: String(index), body: "😀".repeat(2000) })) };
    expect((await PUT(request("PUT", "reviewer", oversized), context())).status).toBe(413);
    expect(db.writes).toEqual([]);
  });
  it("removes only the caller's review and returns a private no-store response", async () => {
    await saveReplayReview("reviewer", REPLAY_ID, input("reviewer"));
    await saveReplayReview("other", REPLAY_ID, input("other"));
    const response = await DELETE(request("DELETE", "reviewer", { expectedAccountId: "reviewer", expectedRevision: 1 }), context());
    expect(await response.json()).toEqual({ accountId: "reviewer", deleted: true, replayId: REPLAY_ID });
    expect(await readSavedReplayReview("other", REPLAY_ID)).toMatchObject({ notes: [note] });
    expect(response.headers.get("cache-control")).toContain("private");
  });
});

function input(accountId: string, revision: number | null = null) { return { expectedAccountId: accountId, expectedRevision: revision, notes: [note] }; }
function context(replayId = REPLAY_ID) { return { params: Promise.resolve({ replayId }) }; }
function request(method: string, accountId = "", body?: unknown) {
  return new Request(`${ORIGIN}/api/v2/reviews/${REPLAY_ID}`, { method, headers: accountId ? { authorization: `Bearer ${accountId}` } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
}
function cookieRequest(method: string, origin?: string) {
  return new Request(`${ORIGIN}/api/v2/reviews/${REPLAY_ID}`, { method,
    headers: { cookie: `${REPLAY_EMBED_COOKIE}=${signReplayEmbedSession("reviewer", secret)}`, ...(origin ? { origin } : {}) },
    ...(method === "PUT" ? { body: JSON.stringify(input("reviewer")) } : {}),
  });
}
function source(patch: Record<string, unknown> = {}) {
  return { schema: "riftlite-replay-record", version: 2, replayId: REPLAY_ID, ownerUid: "owner", captureId: "capture-a", visibility: "public", status: "ready", title: "Test match", platform: "atlas", canonicalArtifact: { kind: "canonical" }, ...patch };
}

function fakeDb() {
  const records = new Map<string, Record<string, unknown>>();
  const writes: string[] = [];
  const selections: string[][] = [];
  type Ref = { path: string; get: () => Promise<ReturnType<typeof snapshot>>; collection: (name: string) => ReturnType<typeof collection> };
  function snapshot(path: string, fields?: string[]) {
    const stored = records.get(path);
    const data = fields && stored ? Object.fromEntries(fields.filter((key) => key in stored).map((key) => [key, stored[key]])) : stored;
    return { id: path.split("/").at(-1)!, exists: Boolean(data), data: () => data };
  }
  function collection(path: string) {
    let fields: string[] | undefined;
    let maximum = 100;
    let after: [number, string] | undefined;
    const query = {
      doc(id: string): Ref { const full = `${path}/${id}`; return { path: full, get: async () => snapshot(full), collection: (name) => collection(`${full}/${name}`) }; },
      orderBy() { return query; },
      select(...names: string[]) { fields = names; selections.push(names); return query; },
      startAfter(time: number, id: string) { after = [time, id]; return query; },
      limit(count: number) { maximum = count; return query; },
      async get() {
        const paths = [...records.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
          .sort((a, b) => Number(records.get(b)?.updatedAt) - Number(records.get(a)?.updatedAt) || b.localeCompare(a))
          .filter((key) => !after || Number(records.get(key)?.updatedAt) < after[0] || (Number(records.get(key)?.updatedAt) === after[0] && key.split("/").at(-1)! < after[1]));
        return { docs: paths.slice(0, maximum).map((key) => snapshot(key, fields)) };
      },
    };
    return query;
  }
  return {
    records, writes, selections, collection,
    async runTransaction<T>(callback: (transaction: { get: (ref: Ref) => ReturnType<Ref["get"]>; set: (ref: Ref, data: Record<string, unknown>) => void }) => Promise<T>) {
      const pending: Array<[string, Record<string, unknown>]> = [];
      const result = await callback({ get: (ref) => ref.get(), set: (ref, data) => { pending.push([ref.path, structuredClone(data)]); } });
      for (const [path, data] of pending) { records.set(path, data); writes.push(path); }
      return result;
    },
  };
}
