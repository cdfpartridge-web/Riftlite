import { gzipSync, gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(), verifyToken: vi.fn(), aliases: vi.fn(), readable: vi.fn(),
  decode: vi.fn(), encode: vi.fn(), match: vi.fn(), store: vi.fn(), read: vi.fn(), remove: vi.fn(),
}));
vi.mock("@/lib/firebase/admin", () => ({ getFirestoreAdmin: mocks.db, verifyFirebaseIdToken: mocks.verifyToken }));
vi.mock("@/lib/identity-server", () => ({ canonicalIdentityUid: async (uid: string) => uid }));
vi.mock("@/lib/social/server", () => ({ identityUidsFor: mocks.aliases }));
vi.mock("./service", () => ({ readReadableReplayMetadata: mocks.readable }));
vi.mock("@/lib/replay-v2/atlas-postgame", () => ({
  decodeAtlasPostgameReplay: mocks.decode, encodeAtlasPostgameReplay: mocks.encode, matchAtlasPostgameReplay: mocks.match,
}));
vi.mock("./artifacts", () => ({
  storeImmutableArtifact: mocks.store, readImmutableArtifact: mocks.read, deleteImmutableArtifact: mocks.remove,
}));

import { readAtlasPostgame, saveAtlasPostgame, shareAtlasPostgame, MAX_ATLAS_POSTGAME_REQUEST_BYTES } from "./atlas-postgame";
import { atlasPostgameArtifactPointers } from "./atlas-postgame-model";
import { ReplayV2Error } from "./errors";
import { sha256Hex } from "./ids";
import { projectReplaySummaryRecord, sanitizeCanonicalReplay } from "./projection";
import { REPLAY_EMBED_COOKIE, signReplayEmbedSession } from "./session";
import { GET, PATCH, PUT } from "@/app/api/v2/replays/[replayId]/atlas-postgame/route";
import type { ReplayArtifactPointer, ReplayRecord } from "./model";
import { normalizeReplayProviderCapture } from "@/lib/replay-v2/provider-normalization";
import { projectReplayState } from "@/lib/replay-v2/project-state";
import type { JsonObject } from "@/lib/replay-v2/types";

const ID = "rl2_" + "a".repeat(32);
const origin = "https://www.riftlite.com";
const context = { params: Promise.resolve({ replayId: ID }) };
const safeExport = { format: "riftatlas-replay", version: 2, nodes: [["o", [["safe", true]]]], root: { r: 0 } };
const alignment = {
  gameId: "game-1", gameNumber: 1, frameCount: 12, firstElapsedMs: 0, lastElapsedMs: 60000,
  matchedEventCount: 8, firstMatchedEventIndex: 4, lastMatchedEventIndex: 25, frameByEventIndex: { 4: 0, 25: 11 },
};
const canonical = { schema: "riftlite-canonical-replay", version: 2, id: ID,
  source: { schema: "riftreplay-raw-capture" }, series: { games: [{ id: "game-1", gameNumber: 1 }] }, events: [] };
let record: ReplayRecord;
let files: Map<string, Buffer>;
let writes: Array<Record<string, unknown>>;
let granted: Set<string>;
let beforeTransaction: (() => void) | undefined;
let readHook: (() => void) | undefined;

function pointer(kind: "raw" | "canonical", bytes: Buffer, generation = kind + "_" + "b".repeat(32)): ReplayArtifactPointer {
  return { provider: "firestore-chunks", kind, generation, artifactId: ID + "_" + generation,
    chunkCount: 1, sha256: sha256Hex(bytes), bytes: bytes.length, contentType: "application/gzip" };
}
function request(method: string, body?: unknown, headers: Record<string, string> = {}, query = "") {
  return new Request(origin + "/api/v2/replays/" + ID + "/atlas-postgame" + query, {
    method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
function cookie(uid: string) {
  return REPLAY_EMBED_COOKIE + "=" + signReplayEmbedSession(uid, process.env.REPLAY_EMBED_SESSION_SECRET!);
}
async function importGame(gameNumber = 1, input: unknown = { replay: { unsafe: "credential" } }) {
  mocks.match.mockReturnValue({ ...alignment, gameId: "game-" + gameNumber, gameNumber });
  return saveAtlasPostgame("owner", ID, { expectedAccountId: "owner", ...(input as object) });
}
function shareGame(shared: boolean, gameId = "game-1") {
  return shareAtlasPostgame("owner", ID, { expectedAccountId: "owner", shared, gameId,
    expectedSha256: record.atlasPostgame!.games.find(game => game.gameId === gameId)!.sha256 });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("REPLAY_EMBED_SESSION_SECRET", "postgame-session-secret-at-least-32-characters");
  files = new Map(); writes = []; granted = new Set(); beforeTransaction = undefined; readHook = undefined;
  const bytes = gzipSync(Buffer.from(JSON.stringify(canonical)));
  const canonicalArtifact = pointer("canonical", bytes);
  files.set(canonicalArtifact.generation, bytes);
  record = {
    schema: "riftlite-replay-record", version: 2, replayId: ID, ownerUid: "owner", captureId: "original-capture",
    platform: "atlas", visibility: "public", status: "ready", title: "Original title",
    localReplayId: "local-original", matchId: "match-original", seriesId: "series-original", roomCode: "original-room",
    messageCount: 35, expectedRaw: { sha256: "c".repeat(64), bytes: 100 }, canonicalArtifact,
    createdAt: new Date(), updatedAt: new Date(),
  };
  const ref = { get: async () => ({ exists: Boolean(record), data: () => structuredClone(record) }) };
  const database = {
    collection: vi.fn(() => ({ doc: vi.fn(() => ref) })),
    runTransaction: vi.fn(async (fn: (transaction: unknown) => unknown) => {
      beforeTransaction?.(); beforeTransaction = undefined;
      return fn({
        get: async () => ({ exists: Boolean(record), data: () => structuredClone(record) }),
        update: (_ref: unknown, fields: Record<string, unknown>) => { writes.push(fields); record = { ...record, ...fields }; },
      });
    }),
  };
  mocks.db.mockReturnValue(database);
  mocks.aliases.mockResolvedValue([]);
  mocks.verifyToken.mockImplementation(async (token: string) => token === "invalid" ? null : ({ uid: token, riftlite_linked_account: true }));
  mocks.readable.mockImplementation(async (_id: string, uid: string) => {
    if (!record) throw new ReplayV2Error(404, "replay_not_found", "Replay not found.");
    const aliases = new Set([uid, ...await mocks.aliases(uid, database)]);
    if (record.visibility === "private" && !aliases.has(record.ownerUid) && !granted.has(uid)) throw new ReplayV2Error(403, "replay_private", "Replay is private.");
    return structuredClone(record);
  });
  mocks.decode.mockImplementation(value => ({ validated: value, metadata: { roomCode: "original-room" } }));
  mocks.encode.mockReturnValue(safeExport);
  mocks.match.mockReturnValue(alignment);
  mocks.store.mockImplementation(async (_db: unknown, input: { kind: "raw"; generation: string; bytes: Buffer }) => {
    const bytes = Buffer.from(input.bytes), artifact = pointer(input.kind, bytes, input.generation);
    files.set(artifact.generation, bytes); return artifact;
  });
  mocks.read.mockImplementation(async (_db: unknown, artifact: ReplayArtifactPointer) => {
    readHook?.(); readHook = undefined;
    const bytes = files.get(artifact.generation); if (!bytes) throw new Error("Missing synthetic artifact");
    return bytes;
  });
  mocks.remove.mockImplementation(async (_db: unknown, artifact: ReplayArtifactPointer) => { files.delete(artifact.generation); });
});
afterEach(() => vi.unstubAllEnvs());

describe("private per-game Atlas post-game attachments", () => {
  it("accepts an actual-shaped masked player capture through PUT while keeping its opening and all-cards attachment private", async () => {
    const actual = await vi.importActual<typeof import("@/lib/replay-v2/atlas-postgame")>("@/lib/replay-v2/atlas-postgame");
    mocks.decode.mockImplementation(actual.decodeAtlasPostgameReplay);
    mocks.encode.mockImplementation(actual.encodeAtlasPostgameReplay);
    mocks.match.mockImplementation(actual.matchAtlasPostgameReplay);
    const start = 1_790_000_000_000;
    const players = ["a", "b"].map(id => {
      const card = (zone: string) => ({ id: `${id}-${zone}`, name: `${id} ${zone}`, cardCode: `SET-${id}-${zone}`, ownerPlayerId: id });
      return { id, name: `Player ${id}`, board: { score: 0, floatingEnergy: 0, floatingPower: 0,
        hand: [card("hand")], deck: [card("deck")], runeDeck: [card("runeDeck")], legend: [card("legend")],
        base: [], trash: [], battlefieldA: [], battlefieldB: [], champion: [], runeArea: [], handRevealToOpponent: false } };
    });
    const state: JsonObject = { roomCode: "ROOM", createdAt: start - 10_000, gameHistoryStartedAt: start,
      phase: "in_game", gameVariant: "duel", roomMode: "multiplayer", matchFormat: "bo1", gameNumber: 1,
      rewindProtocolVersion: 5, testMode: false, activeTurnPlayerId: "a", turnNumber: 1,
      players, chainEntries: [], log: [], targetArrowsByPlayer: {} };
    const frames = [
      { index: 0, sequence: 10, elapsedMs: 0, actionType: "start", state },
      { index: 1, sequence: 11, elapsedMs: 1000, actionType: "concede", state: { ...state, turnNumber: 2,
        gameHistoryEndedAt: start + 1000, gameOutcome: { winnerPlayerIds: ["a"], reason: "concession" } } },
    ];
    const source = { format: "riftatlas-replay", version: 1, replay: { replayId: "synthetic-completed-game",
      viewerPlayerId: "a", players: players.map(({ id, name }) => ({ id, name })), canFork: true, canSwitchPerspective: true,
      createdAt: start, completedAt: start + 1000, frames } };
    const captureFrames = [{ sequence: 9, elapsedMs: -1000, state: { ...state, phase: "mulligan" } }, ...frames];
    const raw = { schema: "riftreplay-raw-capture", version: 1,
      capture: { captureSessionId: "masked-capture", identity: { firstSeenAt: start - 1000, lastSeenAt: start + 1000 } },
      messages: captureFrames.map((frame, seq) => {
        const snapshot = structuredClone(frame.state) as JsonObject;
        for (const player of snapshot.players as JsonObject[]) {
          const board = player.board as JsonObject;
          for (const zone of ["deck", "runeDeck", ...(player.id === "b" ? ["hand"] : [])]) {
            board[zone] = (board[zone] as JsonObject[]).map((_card, index) => ({
              id: `__hidden_zone__:${player.id}:${zone}:${index}`, name: "", isPlaceholder: true,
              source: zone === "runeDeck" ? "runeDeck" : "mainDeck", exhausted: false, createdAt: 0,
            }));
          }
        }
        return { seq, ts: start + frame.elapsedMs, dir: "in", raw: JSON.stringify({
          type: "authoritative_snapshot", gameInstanceId: "ROOM", viewerPlayerId: "a", sequence: frame.sequence, snapshot,
        }) };
      }) };
    // This is the same provider-normalization + privacy-projection pipeline used
    // by normalizeCapture before production stores a canonical artifact.
    const original = sanitizeCanonicalReplay(normalizeReplayProviderCapture(raw, "atlas", ID).replay);
    const originalJson = JSON.stringify(original), sourceJson = JSON.stringify(source);
    expect(original.source.roomCode).toBe("");
    expect(original.series.roomCode).toBe("");
    record.roomCode = "ROOM";
    const originalBytes = gzipSync(Buffer.from(originalJson)), originalPointer = pointer("canonical", originalBytes);
    files.set(originalPointer.generation, originalBytes); record.canonicalArtifact = originalPointer;
    for (const roomCode of ["OTHER", ""]) {
      record.roomCode = roomCode;
      const rejected = await PUT(request("PUT", { expectedAccountId: "owner", expectedSha256: null, replay: source },
        { authorization: "Bearer owner" }), context);
      expect(rejected.status).toBe(409);
      expect(await rejected.json()).toMatchObject({ code: "postgame_match_mismatch" });
      expect(writes).toEqual([]);
    }
    record.roomCode = "ROOM";
    const response = await PUT(request("PUT", { expectedAccountId: "owner", expectedSha256: null, replay: source },
      { authorization: "Bearer owner" }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ canManage: true, available: true, shared: false,
      games: [{ gameNumber: 1, shared: false, frameCount: 2 }] });
    expect(await readAtlasPostgame("", ID, { metadataOnly: true })).toEqual({
      accountId: "public", canManage: false, available: false, shared: false, games: [],
    });
    expect(await readAtlasPostgame("", ID)).toMatchObject({ available: false, exports: [] });
    const validated = actual.decodeAtlasPostgameReplay(source), aligned = actual.matchAtlasPostgameReplay(original, validated);
    const openingEvent = original.events.find(event => event.kind === "snapshot" && event.snapshot.room.rawPhase === "mulligan")!;
    const opening = projectReplayState(original, openingEvent.index);
    expect(actual.projectAtlasPostgameState(opening, validated, aligned)).toMatchObject({ available: false, state: opening });
    const position = projectReplayState(original, aligned.firstMatchedEventIndex);
    expect(position.players.b.zones.hand[0].name).toBe("");
    expect(actual.projectAtlasPostgameState(position, validated, aligned).state.players.b.zones.hand[0]).toMatchObject({
      id: "__hidden_zone__:b:hand:0", name: "b hand",
    });
    expect(position.players.b.zones.hand[0].name).toBe("");
    expect(record.canonicalArtifact).toEqual(originalPointer);
    expect(files.get(originalPointer.generation)).toEqual(originalBytes);
    expect(JSON.stringify(original)).toBe(originalJson);
    expect(JSON.stringify(source)).toBe(sourceJson);
  });
  it("stores only the re-encoded compact export and leaves the canonical, raw metadata, title, visibility and timeline intact", async () => {
    const before = structuredClone(record);
    const response = await importGame();
    expect(response).toMatchObject({ accountId: "owner", canManage: true, available: true, shared: false,
      games: [{ gameId: "game-1", shared: false, frameCount: 12 }] });
    expect(writes).toHaveLength(1); expect(Object.keys(writes[0])).toEqual(["atlasPostgame"]);
    const { atlasPostgame, ...after } = record;
    expect(after).toEqual(before);
    const bytes = files.get(atlasPostgame!.games[0].artifact.generation)!;
    expect(JSON.parse(gunzipSync(bytes).toString())).toEqual(safeExport);
    expect(gunzipSync(bytes).toString()).not.toContain("credential");
    expect(mocks.match).toHaveBeenCalledWith(canonical, { validated: { unsafe: "credential" }, metadata: { roomCode: "original-room" } });
    expect(projectReplaySummaryRecord(record, false)).not.toHaveProperty("atlasPostgame");
    expect(projectReplaySummaryRecord(record, true)).not.toHaveProperty("atlasPostgame");
  });
  it.each(["", "viewer", "hub-member"])("hides private attachment availability and contents from %s, even on a public replay", async uid => {
    await importGame();
    mocks.read.mockClear();
    expect(await readAtlasPostgame(uid, ID, { metadataOnly: true })).toEqual({
      accountId: uid || "public", canManage: false, available: false, shared: false, games: [],
    });
    expect(await readAtlasPostgame(uid, ID)).toMatchObject({ available: false, exports: [] });
    expect(mocks.read).not.toHaveBeenCalled();
    if (uid) {
      await expect(saveAtlasPostgame(uid, ID, { expectedAccountId: uid, replay: {} })).rejects.toMatchObject({ status: 403 });
      await expect(shareAtlasPostgame(uid, ID, { expectedAccountId: uid, shared: false })).rejects.toMatchObject({ status: 403 });
    }
  });
  it("allows server-verified owner aliases without broadening other accounts", async () => {
    await importGame();
    mocks.aliases.mockImplementation(async uid => uid === "linked-owner" ? ["owner"] : []);
    expect(await readAtlasPostgame("linked-owner", ID)).toMatchObject({ accountId: "linked-owner", canManage: true, exports: [{ gameId: "game-1" }] });
    expect(await readAtlasPostgame("outsider", ID)).toMatchObject({ canManage: false, exports: [] });
  });
  it("preserves other games and shares only the owner's explicitly selected game", async () => {
    await importGame(1); await importGame(2);
    const originalPointer = record.canonicalArtifact;
    const shared = await shareGame(true, "game-2");
    expect(shared.shared).toBe(false);
    expect(shared.games.map(game => [game.gameNumber, game.shared])).toEqual([[1, false], [2, true]]);
    expect(await readAtlasPostgame("", ID)).toMatchObject({ accountId: "public", canManage: false,
      games: [{ gameNumber: 2 }], exports: [{ gameId: "game-2", replay: safeExport }] });
    expect(record.canonicalArtifact).toEqual(originalPointer);
    await shareGame(false, "game-2");
    expect(await readAtlasPostgame("", ID)).toMatchObject({ available: false, exports: [] });
  });
  it("keeps explicit sharing subject to current original replay/hub access", async () => {
    await importGame(); await shareGame(true);
    record.visibility = "private"; granted.add("member");
    expect(await readAtlasPostgame("member", ID)).toMatchObject({ available: true, canManage: false });
    granted.clear();
    await expect(readAtlasPostgame("member", ID)).rejects.toMatchObject({ status: 403 });
    await expect(readAtlasPostgame("", ID)).rejects.toMatchObject({ status: 403 });
  });
  it("honours unsharing or revoked original access while an artifact is being read", async () => {
    await importGame(); await shareGame(true);
    readHook = () => { record.atlasPostgame!.games[0].shared = false; };
    expect(await readAtlasPostgame("", ID)).toMatchObject({ available: false, exports: [] });
    await shareGame(true);
    readHook = () => { record.visibility = "private"; };
    await expect(readAtlasPostgame("", ID)).rejects.toMatchObject({ status: 403 });
  });
  it("preserves fractional Atlas timestamps without corrupting attachment metadata", async () => {
    mocks.match.mockReturnValue({ ...alignment, firstElapsedMs: 0.5, lastElapsedMs: 60000.25 });
    await saveAtlasPostgame("owner", ID, { expectedAccountId: "owner", replay: {} });
    expect(await readAtlasPostgame("owner", ID, { metadataOnly: true })).toMatchObject({
      games: [{ firstElapsedMs: 0.5, lastElapsedMs: 60000.25 }],
    });
  });
  it.each([{ platform: "tcga" }, { status: "processing" }, { canonicalArtifact: undefined }])("requires a ready Atlas original: %j", async patch => {
    Object.assign(record, patch);
    await expect(importGame()).rejects.toMatchObject({ status: 409 });
    expect(mocks.store).not.toHaveBeenCalled(); expect(writes).toEqual([]);
  });
  it("rejects invalid/restricted/incomplete source or unrelated game without storing anything", async () => {
    mocks.decode.mockImplementationOnce(() => { throw new Error("invalid source"); });
    await expect(importGame()).rejects.toMatchObject({ status: 422 });
    mocks.match.mockImplementationOnce(() => { throw new Error("wrong players/game"); });
    await expect(saveAtlasPostgame("owner", ID, { expectedAccountId: "owner", replay: {} })).rejects.toMatchObject({ status: 409 });
    expect(mocks.store).not.toHaveBeenCalled(); expect(writes).toEqual([]);
  });
  it("uses optimistic replacement, preserves sibling games, resets replacement sharing and cleans only its old attachment", async () => {
    await importGame(1); await importGame(2);
    const old = record.atlasPostgame!.games[0], sibling = record.atlasPostgame!.games[1];
    await shareGame(true);
    mocks.encode.mockReturnValue({ ...safeExport, nodes: [["o", [["changed", true]]]] });
    await expect(importGame(1, { replay: {}, expectedSha256: null })).rejects.toMatchObject({ code: "postgame_import_changed" });
    await importGame(1, { replay: {}, expectedSha256: old.sha256 });
    expect(record.atlasPostgame!.games[0].shared).toBe(false);
    expect(record.atlasPostgame!.games[1]).toEqual(sibling);
    expect(mocks.remove).toHaveBeenCalledWith(expect.anything(), old.artifact);
    expect(files.has(record.canonicalArtifact!.generation)).toBe(true);
  });
  it("keeps an identical import idempotent without resetting sharing", async () => {
    await importGame(); await shareGame(true);
    mocks.store.mockClear(); mocks.remove.mockClear(); const before = structuredClone(record);
    expect(await importGame()).toMatchObject({ shared: true });
    expect(record).toEqual(before); expect(mocks.store).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("rejects a canonical change during import and deletes the unreferenced new artifact", async () => {
    beforeTransaction = () => { record.canonicalArtifact = { ...record.canonicalArtifact!, sha256: "f".repeat(64) }; };
    await expect(importGame()).rejects.toMatchObject({ code: "postgame_original_changed" });
    expect(writes).toEqual([]); expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(record.atlasPostgame).toBeUndefined();
  });
  it("does not expose an old attachment against a different canonical generation", async () => {
    await importGame();
    record.canonicalArtifact = { ...record.canonicalArtifact!, sha256: "e".repeat(64) };
    expect(await readAtlasPostgame("owner", ID)).toMatchObject({ available: false, exports: [] });
  });
  it("enforces compact byte limits and never offers attachment pointers in metadata", async () => {
    mocks.encode.mockReturnValue({ ...safeExport, padding: "x".repeat(3_900_001) });
    await expect(importGame()).rejects.toMatchObject({ status: 413 });
    expect(mocks.store).not.toHaveBeenCalled();
    mocks.encode.mockReturnValue(safeExport); await importGame();
    const response = await readAtlasPostgame("owner", ID, { metadataOnly: true });
    expect(JSON.stringify(response)).not.toMatch(/artifactId|generation|canonicalSha256/);
    expect(atlasPostgameArtifactPointers(record.atlasPostgame)).toEqual([record.atlasPostgame!.games[0].artifact]);
  });
  it("verifies stored compact artifact bytes instead of returning corrupted content", async () => {
    await importGame();
    files.set(record.atlasPostgame!.games[0].artifact.generation, gzipSync(Buffer.from("{}")));
    await expect(readAtlasPostgame("owner", ID)).rejects.toMatchObject({ code: "postgame_artifact_invalid" });
  });
  it("rejects a changed account before importing or sharing even when the new account is a proven owner alias", async () => {
    await importGame(); mocks.aliases.mockResolvedValue(["owner"]); writes.length = 0;
    await expect(saveAtlasPostgame("linked-owner", ID, { expectedAccountId: "owner", replay: {} }))
      .rejects.toMatchObject({ code: "postgame_account_changed" });
    await expect(shareAtlasPostgame("linked-owner", ID, { expectedAccountId: "owner", shared: false }))
      .rejects.toMatchObject({ code: "postgame_account_changed" });
    expect(writes).toEqual([]);
  });
  it("requires the selected import hash for sharing and refuses stale or unscoped share requests", async () => {
    await importGame(); const previous = record.atlasPostgame!.games[0].sha256;
    mocks.encode.mockReturnValue({ ...safeExport, nodes: [["o", [["replacement", true]]]] });
    await importGame(); writes.length = 0;
    await expect(shareAtlasPostgame("owner", ID, { expectedAccountId: "owner", shared: true, gameId: "game-1", expectedSha256: previous }))
      .rejects.toMatchObject({ code: "postgame_import_changed" });
    await expect(shareAtlasPostgame("owner", ID, { expectedAccountId: "owner", shared: true }))
      .rejects.toMatchObject({ status: 400 });
    await expect(shareAtlasPostgame("owner", ID, { expectedAccountId: "owner", shared: true, gameId: "game-1" }))
      .rejects.toMatchObject({ status: 400 });
    expect(writes).toEqual([]); expect(record.atlasPostgame!.games[0].shared).toBe(false);
    await shareGame(true);
    await shareAtlasPostgame("owner", ID, { expectedAccountId: "owner", shared: false });
    expect(record.atlasPostgame!.games[0].shared).toBe(false);
  });
});

describe("Atlas post-game HTTP authentication and bounded requests", () => {
  it("requires same-origin browser mutation requests even with a valid session cookie", async () => {
    const headers = { cookie: cookie("owner") };
    expect((await PUT(request("PUT", { replay: {} }, headers), context)).status).toBe(403);
    expect((await PATCH(request("PATCH", { shared: true }, { ...headers, origin: "https://evil.invalid" }), context)).status).toBe(403);
    expect(writes).toEqual([]);
  });
  it("allows a same-origin owner cookie, returns account binding, and marks every response no-store", async () => {
    const response = await PUT(request("PUT", { expectedAccountId: "owner", replay: {} }, { cookie: cookie("owner"), origin }), context);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ accountId: "owner", available: true, shared: false });
    const viewed = await GET(request("GET", undefined, { cookie: cookie("owner") }, "?metadata=1"), context);
    expect(await viewed.json()).toMatchObject({ accountId: "owner", canManage: true });
  });
  it("supports explicit bearer mutations but rejects unauthenticated or nonowner requests", async () => {
    expect((await PUT(request("PUT", { expectedAccountId: "owner", replay: {} }, { authorization: "Bearer owner" }), context)).status).toBe(200);
    expect((await PATCH(request("PATCH", { expectedAccountId: "outsider", shared: false }, { authorization: "Bearer outsider" }), context)).status).toBe(403);
    expect((await PUT(request("PUT", { replay: {} }, { origin }), context)).status).toBe(401);
  });
  it("rejects oversized input before decoding and validates identifiers", async () => {
    const oversized = request("PUT", { replay: {} }, { authorization: "Bearer owner", "content-length": String(MAX_ATLAS_POSTGAME_REQUEST_BYTES + 1) });
    expect((await PUT(oversized, context)).status).toBe(413); expect(mocks.decode).not.toHaveBeenCalled();
    expect((await GET(request("GET"), { params: Promise.resolve({ replayId: "../invalid" }) })).status).toBe(400);
    expect((await PATCH(request("PATCH", { shared: "yes" }, { authorization: "Bearer owner" }), context)).status).toBe(400);
  });
});
