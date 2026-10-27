import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Entirely synthetic. Only persistence/access lookup is mocked: normalization,
// privacy projection, export decode/encode, alignment and attachment saving are real.
const mocks = vi.hoisted(() => ({ db: vi.fn(), aliases: vi.fn(), readable: vi.fn(), store: vi.fn(), read: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/firebase/admin", () => ({ getFirestoreAdmin: mocks.db }));
vi.mock("@/lib/social/server", () => ({ identityUidsFor: mocks.aliases }));
vi.mock("@/lib/replay-v2-server/service", () => ({ readReadableReplayMetadata: mocks.readable }));
vi.mock("@/lib/replay-v2-server/artifacts", () => ({ storeImmutableArtifact: mocks.store, readImmutableArtifact: mocks.read, deleteImmutableArtifact: mocks.remove }));

import { normalizeReplayProviderCapture } from "@/lib/replay-v2/provider-normalization";
import { sanitizeCanonicalReplay } from "@/lib/replay-v2-server/projection";
import { decodeAtlasPostgameReplay, encodeAtlasPostgameReplay, matchAtlasPostgameReplay } from "@/lib/replay-v2/atlas-postgame";
import { readAtlasPostgame, saveAtlasPostgame } from "@/lib/replay-v2-server/atlas-postgame";
import { sha256Hex } from "@/lib/replay-v2-server/ids";
import { ReplayV2Error } from "@/lib/replay-v2-server/errors";
import { MAX_RAW_GZIP_BYTES, MAX_RAW_JSON_BYTES } from "@/lib/replay-v2-server/constants";
import type { JsonObject } from "@/lib/replay-v2/types";
import type { ReplayArtifactPointer, ReplayRecord } from "@/lib/replay-v2-server/model";

const ID = "rl2_" + "a".repeat(32);
const START = 1_790_000_000_000;
const ROOM_CODES = ["SYNTHROOM1", "SYNTHROOM2", "SYNTHROOM3"];

function fixture(inferredBoundaries = false, archivedEarlierGames = false) {
  const messages: unknown[] = [];
  const sources = ROOM_CODES.map((roomCode, gameIndex) => {
    const gameNumber = gameIndex + 1, start = START + gameIndex * 120_000;
    const players = ["a", "b"].map(id => {
      const card = (zone: string) => ({ id: `${gameNumber}-${id}-${zone}`, name: `${id} ${zone}`, cardCode: `SET-${id}-${zone}`, ownerPlayerId: id });
      return { id, name: `Synthetic player ${id}`, board: { score: 0, floatingEnergy: 0, floatingPower: 0,
        hand: [card("hand")], deck: [card("deck")], runeDeck: [], legend: [card("legend")],
        base: [], trash: [], battlefieldA: [], battlefieldB: [], champion: [], runeArea: [], handRevealToOpponent: false } };
    });
    const state: JsonObject = { roomCode, createdAt: start - 10_000, gameHistoryStartedAt: start,
      seriesStartedAt: START, phase: "in_game", gameVariant: "duel", roomMode: "multiplayer", matchFormat: "bo3", gameNumber,
      rewindProtocolVersion: 5, testMode: false, activeTurnPlayerId: "a", turnNumber: 1,
      players, chainEntries: [], log: [], targetArrowsByPlayer: {} };
    const frames = [
      { index: 0, sequence: 10, elapsedMs: 0, actionType: "start", state },
      { index: 1, sequence: 11, elapsedMs: 30_000, actionType: "concede", state: { ...state, turnNumber: 2,
        winsByPlayerId: [{ a: 1, b: 0 }, { a: 1, b: 1 }, { a: 2, b: 1 }][gameIndex],
        gameHistoryEndedAt: start + 30_000, gameOutcome: { winnerPlayerIds: [gameIndex === 1 ? "b" : "a"], reason: "concession" } } },
    ];
    if (archivedEarlierGames && gameNumber < 3) {
      delete (frames[1].state as JsonObject).gameHistoryEndedAt;
      delete (frames[1].state as JsonObject).gameOutcome;
    }
    for (const frame of [{ sequence: 9, elapsedMs: -1000, state: { ...state, phase: "mulligan" } }, ...frames]) {
      const snapshot = structuredClone(frame.state) as JsonObject;
      // Reproduce the desktop fallback case: captured endings are absent while
      // the independently retrieved completed provider export has authoritative endings.
      delete snapshot.gameHistoryEndedAt;
      delete snapshot.gameOutcome;
      if (inferredBoundaries && gameNumber > 1 && frame.sequence === 9) {
        snapshot.phase = "sideboarding"; delete snapshot.gameNumber;
      }
      for (const player of snapshot.players as JsonObject[]) {
        const board = player.board as JsonObject;
        for (const zone of ["deck", "runeDeck", ...(player.id === "b" ? ["hand"] : [])]) {
          board[zone] = (board[zone] as JsonObject[]).map((_card, index) => ({
            id: `__hidden_zone__:${player.id}:${zone}:${index}`, name: "", isPlaceholder: true,
            source: "mainDeck", exhausted: false, createdAt: 0,
          }));
        }
      }
      messages.push({ seq: messages.length, ts: start + frame.elapsedMs, dir: "in", raw: JSON.stringify({
        type: "authoritative_snapshot", gameInstanceId: roomCode, viewerPlayerId: "a", sequence: frame.sequence, snapshot,
      }) });
    }
    return decodeAtlasPostgameReplay({ format: "riftatlas-replay", version: 1, replay: {
      replayId: `synthetic-game-${gameNumber}`, viewerPlayerId: "a", players: players.map(({ id, name }) => ({ id, name })),
      canFork: true, canSwitchPerspective: true, createdAt: start, completedAt: start + (archivedEarlierGames && gameNumber < 3 ? 36_000 : 30_000), frames,
    } });
  });
  const raw = { schema: "riftreplay-raw-capture", version: 1,
    capture: { captureSessionId: "synthetic-bo3-capture", identity: { roomCode: ROOM_CODES[0], roomCodes: ROOM_CODES,
      firstSeenAt: START - 1000, lastSeenAt: START + 270_000 } }, messages };
  const normalized = normalizeReplayProviderCapture(raw, "atlas", ID).replay;
  const canonical = sanitizeCanonicalReplay(normalized);
  return { raw, normalized, canonical, sources };
}

let record: ReplayRecord;
let files: Map<string, Buffer>;
let writes: Array<Record<string, unknown>>;
let beforeTransaction: (() => void) | undefined;
function pointer(kind: "canonical" | "raw", bytes: Buffer, generation = kind + "_" + "b".repeat(32)): ReplayArtifactPointer {
  return { provider: "firestore-chunks", kind, generation, artifactId: ID + "_" + generation,
    chunkCount: 1, sha256: sha256Hex(bytes), bytes: bytes.length, contentType: "application/gzip" };
}
beforeEach(() => {
  vi.clearAllMocks(); files = new Map(); writes = []; beforeTransaction = undefined;
  const { raw, canonical } = fixture();
  const canonicalBytes = gzipSync(Buffer.from(JSON.stringify(canonical)));
  const canonicalArtifact = pointer("canonical", canonicalBytes); files.set(canonicalArtifact.generation, canonicalBytes);
  const rawBytes = gzipSync(Buffer.from(JSON.stringify(raw)));
  const rawArtifact = pointer("raw", rawBytes); files.set(rawArtifact.generation, rawBytes);
  record = { schema: "riftlite-replay-record", version: 2, replayId: ID, ownerUid: "owner", captureId: "synthetic-bo3-capture",
    platform: "atlas", visibility: "private", status: "ready", title: "Synthetic BO3",
    localReplayId: "synthetic-local", matchId: "synthetic-match", seriesId: "synthetic-series", roomCode: ROOM_CODES[0],
    messageCount: 9, expectedRaw: { sha256: sha256Hex(rawBytes), bytes: rawBytes.length }, rawArtifact, canonicalArtifact,
    createdAt: new Date(START), updatedAt: new Date(START) };
  const ref = {};
  const database = { collection: () => ({ doc: () => ref }), runTransaction: async (run: (tx: unknown) => unknown) => {
    beforeTransaction?.(); beforeTransaction = undefined;
    return run({
      get: async () => ({ exists: true, data: () => structuredClone(record) }),
      update: (_ref: unknown, fields: Record<string, unknown>) => { writes.push(fields); record = { ...record, ...fields }; },
    });
  } };
  mocks.db.mockReturnValue(database); mocks.aliases.mockResolvedValue([]);
  mocks.readable.mockImplementation(async (_id: string, accountId: string) => {
    if (record.visibility === "private" && accountId !== record.ownerUid) throw new ReplayV2Error(403, "replay_private", "Replay is private.");
    return structuredClone(record);
  });
  mocks.read.mockImplementation(async (_db: unknown, artifact: ReplayArtifactPointer) => files.get(artifact.generation));
  mocks.store.mockImplementation(async (_db: unknown, input: { kind: "raw"; generation: string; bytes: Buffer }) => {
    const artifact = pointer(input.kind, input.bytes, input.generation); files.set(artifact.generation, Buffer.from(input.bytes)); return artifact;
  });
  mocks.remove.mockImplementation(async (_db: unknown, artifact: ReplayArtifactPointer) => files.delete(artifact.generation));
});

async function attach(gameNumber = 2) {
  return saveAtlasPostgame("owner", ID, { expectedAccountId: "owner", expectedSha256: null,
    replay: encodeAtlasPostgameReplay(fixture().sources[gameNumber - 1]) });
}
function replaceRaw(payload: unknown) {
  const bytes = gzipSync(Buffer.from(JSON.stringify(payload)));
  record.rawArtifact = pointer("raw", bytes);
  record.expectedRaw = { bytes: bytes.length, sha256: sha256Hex(bytes) };
  files.set(record.rawArtifact.generation, bytes);
}
function replaceCanonical(canonical: unknown) {
  const bytes = gzipSync(Buffer.from(JSON.stringify(canonical)));
  record.canonicalArtifact = pointer("canonical", bytes);
  files.set(record.canonicalArtifact.generation, bytes);
}

describe("per-game private BO3 room binding from retained original captures", () => {
  it("all three different-room games align through the actual normalization, sanitizer and matching pipeline despite missing captured endings", () => {
    const { normalized, canonical, sources } = fixture();
    expect(normalized.source.roomCode).toBe(ROOM_CODES[0]);
    expect(normalized.series.roomCode).toBe(ROOM_CODES[0]);
    expect(canonical.source.roomCode).toBe(""); expect(canonical.series.roomCode).toBe(""); expect(canonical.source.captureSessionId).toBe("");
    expect(canonical.series.games.map(game => game.gameNumber)).toEqual([1, 2, 3]);
    for (const source of sources) {
      const alignment = matchAtlasPostgameReplay(canonical, source);
      expect(alignment).toMatchObject({ gameNumber: source.metadata.gameNumber, frameCount: 2 });
      expect(alignment.matchedEventCount).toBeGreaterThanOrEqual(2);
    }
    for (const room of ROOM_CODES) expect(JSON.stringify(canonical)).not.toContain(room);
  });

  it("attaches all three rooms to an existing replay without changing canonical bytes, original privacy or room sanitization", async () => {
    const { sources } = fixture(), before = Buffer.from(files.get(record.canonicalArtifact!.generation)!);
    for (const source of sources) await saveAtlasPostgame("owner", ID, {
      expectedAccountId: "owner", expectedSha256: null, replay: encodeAtlasPostgameReplay(source) });
    expect(writes).toHaveLength(3);
    expect(files.get(record.canonicalArtifact!.generation)).toEqual(before);
    expect(record.visibility).toBe("private");
    for (const write of writes) expect(Object.keys(write)).toEqual(["atlasPostgame"]);
    const owner = await readAtlasPostgame("owner", ID, { metadataOnly: true });
    expect(owner.games.map(game => game.gameNumber)).toEqual([1, 2, 3]);
    for (const room of ROOM_CODES) expect(JSON.stringify(owner)).not.toContain(room);
    await expect(readAtlasPostgame("", ID)).rejects.toMatchObject({ status: 403 });
    record.visibility = "public";
    const publicView = await readAtlasPostgame("", ID, { metadataOnly: true });
    expect(publicView).toMatchObject({ accountId: "public", canManage: false, available: true });
    expect(publicView.games.map(game => game.gameNumber)).toEqual([1, 2, 3]);
    for (const room of ROOM_CODES) expect(JSON.stringify(publicView)).not.toContain(room);
  });

  it("does not require raw recovery for the existing scalar room path", async () => {
    record.rawArtifact = undefined;
    expect(await attach(1)).toMatchObject({ available: true, games: [{ gameNumber: 1 }] });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("keeps owner and missing-private-binding fences in the real attachment service", async () => {
    record.visibility = "public";
    const replay = encodeAtlasPostgameReplay(fixture().sources[0]);
    await expect(saveAtlasPostgame("other", ID, { expectedAccountId: "other", replay })).rejects.toMatchObject({ status: 403, code: "postgame_owner_required" });
    record.roomCode = "";
    await expect(saveAtlasPostgame("owner", ID, { expectedAccountId: "owner", replay })).rejects.toMatchObject({ status: 409, code: "postgame_match_mismatch" });
    expect(writes).toEqual([]);
  });

  it.each(["missing", "declaration", "checksum", "capture", "root-room", "compressed-size", "decompression"])("rejects invalid original raw binding: %s", async kind => {
    if (kind === "missing") record.rawArtifact = undefined;
    if (kind === "declaration") record.expectedRaw.sha256 = "c".repeat(64);
    if (kind === "checksum") files.set(record.rawArtifact!.generation, Buffer.from("corrupt"));
    if (kind === "capture") { const { raw } = fixture(); raw.capture.captureSessionId = "other-capture"; replaceRaw(raw); }
    if (kind === "root-room") record.roomCode = "UNRELATED";
    if (kind === "compressed-size") record.rawArtifact!.bytes = MAX_RAW_GZIP_BYTES + 1;
    if (kind === "decompression") replaceRaw({ padding: "x".repeat(MAX_RAW_JSON_BYTES + 1) });
    await expect(attach()).rejects.toMatchObject({ status: 409, code: "postgame_match_mismatch" });
    expect(writes).toEqual([]); expect(mocks.store).not.toHaveBeenCalled();
  });

  it("binds rooms when a native setup packet starts a game before its explicit numbered snapshot", async () => {
    const { raw, canonical, normalized } = fixture(true);
    expect(normalized.series.games.map(game => game.sourceIdentity.explicitGameNumber)).toEqual([true, false, false]);
    replaceRaw(raw); replaceCanonical(canonical);
    expect(await attach(2)).toMatchObject({ games: [{ gameNumber: 2 }] });
    expect(await attach(3)).toMatchObject({ games: [{ gameNumber: 2 }, { gameNumber: 3 }] });
  });

  it("attaches native-shaped archived earlier games and the terminal game without inventing captured outcomes", async () => {
    const { raw, canonical, sources } = fixture(true, true);
    replaceRaw(raw); replaceCanonical(canonical);
    for (const source of sources) await saveAtlasPostgame("owner", ID, {
      expectedAccountId: "owner", expectedSha256: null, replay: encodeAtlasPostgameReplay(source) });
    expect((await readAtlasPostgame("owner", ID, { metadataOnly: true })).games.map(game => game.gameNumber)).toEqual([1, 2, 3]);
    for (const source of sources.slice(0, 2)) for (const frame of source.view.frames) {
      expect(frame.state.gameOutcome).toBeUndefined(); expect(frame.state.gameHistoryEndedAt).toBeUndefined();
    }
  });

  it.each(["unknown", "bo1"] as const)("rejects an archived first game against canonical format %s despite a matching scalar room", async format => {
    const { canonical, sources } = fixture(false, true);
    canonical.series.format = format; replaceCanonical(canonical);
    await expect(saveAtlasPostgame("owner", ID, { expectedAccountId: "owner", replay: encodeAtlasPostgameReplay(sources[0]) }))
      .rejects.toMatchObject({ status: 409, code: "postgame_match_mismatch" });
    expect(writes).toEqual([]);
  });

  it.each([0, 2])("rejects a room borrowed from game index %i even when the sanitized board still matches", async roomIndex => {
    const { sources } = fixture(), source = sources[1];
    source.metadata.roomCode = ROOM_CODES[roomIndex];
    for (const frame of source.view.frames) frame.state.roomCode = ROOM_CODES[roomIndex];
    expect(matchAtlasPostgameReplay(fixture().canonical, source).gameNumber).toBe(2);
    await expect(saveAtlasPostgame("owner", ID, { expectedAccountId: "owner", replay: encodeAtlasPostgameReplay(source) }))
      .rejects.toMatchObject({ status: 409, code: "postgame_match_mismatch" });
    expect(writes).toEqual([]);
  });

  it("rejects a different canonical even if the selected game itself still aligns", async () => {
    const { canonical, sources } = fixture(); canonical.source.messageCount++;
    expect(matchAtlasPostgameReplay(canonical, sources[1]).gameNumber).toBe(2);
    replaceCanonical(canonical);
    await expect(attach()).rejects.toMatchObject({ status: 409, code: "postgame_match_mismatch" });
    expect(writes).toEqual([]);
  });

  it("accepts publication-only diagnostic additions without weakening the original timeline binding", async () => {
    const { canonical } = fixture();
    canonical.diagnostics.push({ id: "publication-test", severity: "warning", code: "publication_test", message: "Synthetic quality warning" });
    replaceCanonical(canonical);
    expect(await attach()).toMatchObject({ available: true, games: [{ gameNumber: 2 }] });
  });

  it.each(["raw", "canonical", "capture", "owner"])("rejects a concurrent %s identity change after preparation", async kind => {
    beforeTransaction = () => {
      if (kind === "raw") record.rawArtifact = { ...record.rawArtifact!, generation: "raw_" + "d".repeat(32) };
      if (kind === "canonical") record.canonicalArtifact = { ...record.canonicalArtifact!, generation: "canonical_" + "d".repeat(32) };
      if (kind === "capture") record.captureId = "changed-capture";
      if (kind === "owner") record.ownerUid = "other";
    };
    await expect(attach()).rejects.toMatchObject({ status: kind === "owner" ? 403 : 409 });
    expect(writes).toEqual([]); expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
});
