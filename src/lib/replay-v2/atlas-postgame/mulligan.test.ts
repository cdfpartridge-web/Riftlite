import { describe, expect, it } from "vitest";
import { normalizeReplayProviderCapture } from "../provider-normalization";
import { sanitizeCanonicalReplay } from "../../replay-v2-server/projection";
import type { JsonObject } from "../types";
import { buildAtlasMulliganSummary, decodeAtlasPostgameReplay, encodeAtlasPostgameReplay, matchAtlasPostgameReplay } from "./index";

const START = 1_790_000_000_000;
function fixture(gameNumber = 1, opening = true) {
  const card = (id: string, ownerPlayerId: string) => ({ id, name: id, cardCode: "OGN-135", ownerPlayerId, exhausted: false });
  const players = ["a", "b"].map(id => ({ id, name: id, board: { score: 0, floatingEnergy: 0, floatingPower: 0,
    hand: Array.from({ length: id === "a" && opening ? 5 : 4 }, (_, i) => card(`${id}-${i}`, id)),
    deck: [card(`${id}-deck`, id)], base: [], trash: [], battlefieldA: [], battlefieldB: [],
    champion: [], legend: [card(`${id}-legend`, id)], runeDeck: [], runeArea: [], handRevealToOpponent: false,
  } }));
  const playback: JsonObject = {
    a: { redrawCount: 0, draws: opening ? [{ id: "draw-a", cardId: "a-4", kind: "opening", handCountBeforeDraw: 3 }] : [] },
    b: { redrawCount: 2, draws: [
      { id: "draw-b-2", cardId: "b-2", kind: "refill", handCountBeforeDraw: 2 },
      { id: "draw-b-3", cardId: "b-3", kind: "refill", handCountBeforeDraw: 3 },
    ] },
  };
  const state: JsonObject = { roomCode: "ROOMFIX", createdAt: START - 20_000, gameHistoryStartedAt: START,
    phase: "in_game", gameVariant: "duel", roomMode: "multiplayer", matchFormat: gameNumber === 1 ? "bo1" : "bo3", gameNumber,
    rewindProtocolVersion: 5, testMode: false, activeTurnPlayerId: "a", firstPlayerId: "a", turnNumber: 1,
    players, chainEntries: [], log: [], targetArrowsByPlayer: {}, mulliganPlaybackByPlayerId: playback };
  const input = { format: "riftatlas-replay", version: 1, replay: { replayId: "synthetic-mulligan", viewerPlayerId: "a",
    players: players.map(({ id, name }) => ({ id, name })), canFork: true, canSwitchPerspective: true,
    createdAt: START, completedAt: START + 30_000, frames: [
      { index: 0, sequence: 10, elapsedMs: 0, actionType: "game_start", state },
      { index: 1, sequence: 11, elapsedMs: 30_000, actionType: "concede", state: { ...state, turnNumber: 2,
        gameHistoryEndedAt: START + 30_000, gameOutcome: { winnerPlayerIds: ["a"], reason: "concession" } } as JsonObject },
    ] } };
  const before = structuredClone(state);
  before.phase = "mulligan";
  delete before.mulliganPlaybackByPlayerId;
  const beforePlayers = before.players as JsonObject[];
  (beforePlayers[0].board as JsonObject).hand = players[0].board.hand.slice(0, 4);
  (beforePlayers[1].board as JsonObject).hand = [card("b-0", "b"), card("b-1", "b"), card("unknown-returned-1", "b"), card("unknown-returned-2", "b")];
  const raw = { schema: "riftreplay-raw-capture", version: 1,
    capture: { captureSessionId: "synthetic-mulligan-capture", identity: { firstSeenAt: START - 10_000, lastSeenAt: START + 30_000 } },
    messages: [before, ...input.replay.frames.map(frame => frame.state)].map((state, seq) => {
      const snapshot = structuredClone(state);
      for (const player of snapshot.players as JsonObject[]) for (const zone of ["deck", ...(player.id === "b" ? ["hand"] : [])]) {
        const board = player.board as JsonObject;
        board[zone] = (board[zone] as JsonObject[]).map((_card, index) => ({
          id: `__hidden_zone__:${player.id}:${zone}:${index}`, name: "", isPlaceholder: true, exhausted: false,
        }));
      }
      return { seq, ts: seq === 0 ? START - 10_000 : START + (seq === 1 ? 0 : 30_000), dir: "in", raw: JSON.stringify({
        type: "authoritative_snapshot", gameInstanceId: "ROOMFIX", viewerPlayerId: "a", sequence: 9 + seq, snapshot,
      }) };
    }),
  };
  const canonical = sanitizeCanonicalReplay(normalizeReplayProviderCapture(raw, "atlas", "synthetic-mulligan").replay);
  const source = decodeAtlasPostgameReplay(input), alignment = matchAtlasPostgameReplay(canonical, source);
  return { input, source, canonical, alignment, playback };
}
const entry = (f: ReturnType<typeof fixture>, player = "b") => f.playback[player] as JsonObject;
const draws = (f: ReturnType<typeof fixture>, player = "b") => entry(f, player).draws as JsonObject[];
const summary = (f: ReturnType<typeof fixture>) => buildAtlasMulliganSummary(decodeAtlasPostgameReplay(f.input), f.alignment, f.canonical);

describe("Atlas partial mulligan summary", () => {
  it("shows exact kept and replacement cards, excludes the first-turn draw and never reconstructs returned identities", () => {
    const f = fixture(), before = JSON.stringify(f.canonical), sourceBefore = JSON.stringify(encodeAtlasPostgameReplay(f.source));
    const result = buildAtlasMulliganSummary(f.source, f.alignment, f.canonical)!;
    expect(result.gameId).toBe(f.alignment.gameId);
    expect(result.players.a.kept.map(card => card.id)).toEqual(["a-0", "a-1", "a-2", "a-3"]);
    expect(result.players.a.replacements).toEqual([]);
    expect(result.players.a.returnedCount).toBe(0);
    expect(result.players.b.kept.map(card => card.id)).toEqual(["b-0", "b-1"]);
    expect(result.players.b.replacements.map(card => card.id)).toEqual(["b-2", "b-3"]);
    expect(result.players.b.returnedCount).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/unknown-returned|a-4|deck/);
    result.players.b.kept[0].fields.name = "changed copy";
    expect(JSON.stringify(f.canonical)).toBe(before);
    expect(JSON.stringify(encodeAtlasPostgameReplay(f.source))).toBe(sourceBefore);
  });
  it("allows no opening draw and an entire zero-redraw hand", () => {
    const f = fixture(1, false), result = summary(f)!;
    expect(result.players.a.kept).toHaveLength(4);
    expect(result.players.a.replacements).toHaveLength(0);
  });
  it("does not use metadata or hand cards from a later frame to fill a missing first-frame summary", () => {
    const f = fixture();
    delete f.input.replay.frames[0].state.mulliganPlaybackByPlayerId;
    expect(f.input.replay.frames[1].state.mulliganPlaybackByPlayerId).toBeDefined();
    expect(summary(f)).toBeNull();
  });
  it("roundtrips only the bounded metadata and excludes unknown fields and private extras", () => {
    const f = fixture();
    Object.assign(entry(f), { hiddenRefillCardIds: ["DO-NOT-STORE"], hiddenRuneCardIds: ["DO-NOT-STORE"], privateNotes: "DO-NOT-STORE" });
    Object.assign(draws(f)[0], { secret: "DO-NOT-STORE", returnedCard: { name: "DO-NOT-STORE" } });
    const source = decodeAtlasPostgameReplay(f.input), encoded = encodeAtlasPostgameReplay(source), decoded = decodeAtlasPostgameReplay(encoded);
    expect(JSON.stringify(encoded)).not.toContain("DO-NOT-STORE");
    expect(decoded.view.frames[0].state.mulliganPlaybackByPlayerId).toEqual(source.view.frames[0].state.mulliganPlaybackByPlayerId);
    expect(decoded.view.frames[0].state.mulliganPlaybackByPlayerId).toBe(decoded.view.frames[1].state.mulliganPlaybackByPlayerId);
    expect(buildAtlasMulliganSummary(decoded, f.alignment, f.canonical)?.players.b.returnedCount).toBe(2);
  });
  it.each(["absent", "null", "partial map", "unknown player", "bad count", "fractional count", "oversized draws", "missing draw id", "bad kind", "bad before", "nested id"])("ignores malformed or legacy optional metadata: %s", kind => {
    const f = fixture();
    if (kind === "absent") for (const frame of f.input.replay.frames) delete frame.state.mulliganPlaybackByPlayerId;
    if (kind === "null") for (const frame of f.input.replay.frames) frame.state.mulliganPlaybackByPlayerId = null;
    if (kind === "partial map") delete f.playback.a;
    if (kind === "unknown player") { f.playback.other = f.playback.a; delete f.playback.a; }
    if (kind === "bad count") entry(f).redrawCount = 5;
    if (kind === "fractional count") entry(f).redrawCount = 1.5;
    if (kind === "oversized draws") entry(f).draws = Array(6).fill(draws(f)[0]);
    if (kind === "missing draw id") delete draws(f)[0].id;
    if (kind === "bad kind") draws(f)[0].kind = "initial";
    if (kind === "bad before") draws(f)[0].handCountBeforeDraw = 99;
    if (kind === "nested id") draws(f)[0].id = { secret: "DO-NOT-STORE" };
    const source = decodeAtlasPostgameReplay(f.input);
    expect(source.view.frames[0].state.mulliganPlaybackByPlayerId).toBeUndefined();
    expect(matchAtlasPostgameReplay(f.canonical, source).matchedEventCount).toBeGreaterThanOrEqual(2);
    expect(buildAtlasMulliganSummary(source, f.alignment, f.canonical)).toBeNull();
  });
  it.each(["duplicate card", "duplicate draw", "unknown card", "wrong count", "wrong before", "wrong order", "extra opening", "wrong opening card", "wrong opening before", "wrong opening owner"])("rejects ambiguous semantic evidence: %s", kind => {
    const f = fixture();
    if (kind === "duplicate card") draws(f)[1].cardId = draws(f)[0].cardId;
    if (kind === "duplicate draw") draws(f)[1].id = draws(f)[0].id;
    if (kind === "unknown card") draws(f)[0].cardId = "not-in-first-hand";
    if (kind === "wrong count") entry(f).redrawCount = 1;
    if (kind === "wrong before") draws(f)[0].handCountBeforeDraw = 1;
    if (kind === "wrong order") draws(f).reverse();
    if (kind === "extra opening") draws(f, "a").push({ id: "extra", cardId: "a-3", kind: "opening", handCountBeforeDraw: 3 });
    if (kind === "wrong opening card") draws(f, "a")[0].cardId = "a-0";
    if (kind === "wrong opening before") draws(f, "a")[0].handCountBeforeDraw = 2;
    if (kind === "wrong opening owner") for (const frame of f.input.replay.frames) frame.state.firstPlayerId = "b";
    expect(summary(f)).toBeNull();
  });
  it.each(["wrong game", "wrong number", "not game start", "late first frame", "not in game", "missing opening", "no frame zero anchor", "forged frame zero anchor", "mismatched public board"])("requires the matching game's captured opening and exact first frame: %s", kind => {
    const f = fixture();
    if (kind === "wrong game") f.alignment.gameId = "another-game";
    if (kind === "wrong number") f.alignment.gameNumber = 2;
    if (kind === "not game start") f.source.view.frames[0].actionType = "move_card";
    if (kind === "late first frame") f.source.view.frames[0].elapsedMs = 1;
    if (kind === "not in game") f.source.view.frames[0].state.phase = "mulligan";
    if (kind === "missing opening") for (const event of f.canonical.events) {
      if (event.kind === "phase" && event.phase === "mulligan") event.phase = "unknown";
      if (event.kind === "snapshot" && event.snapshot.room.rawPhase === "mulligan") event.snapshot.room.rawPhase = "unknown";
    }
    if (kind === "no frame zero anchor") for (const key of Object.keys(f.alignment.frameByEventIndex)) if (f.alignment.frameByEventIndex[Number(key)] === 0) delete f.alignment.frameByEventIndex[Number(key)];
    if (kind === "forged frame zero anchor") for (const key of Object.keys(f.alignment.frameByEventIndex)) {
      const index = Number(key);
      if (f.alignment.frameByEventIndex[index] === 0) delete f.alignment.frameByEventIndex[index];
      else f.alignment.frameByEventIndex[index] = 0;
    }
    if (kind === "mismatched public board") ((f.source.view.frames[0].state.players[0].board.legend as JsonObject[])[0]).id = "wrong-public-anchor";
    expect(buildAtlasMulliganSummary(f.source, f.alignment, f.canonical)).toBeNull();
  });
  it("binds a BO3 game's summary to its own opening, never a preceding game's mulligan", () => {
    const f = fixture(2), result = summary(f)!;
    expect(result.gameId).toBe(f.alignment.gameId);
    expect(f.alignment.gameNumber).toBe(2);
    for (const event of f.canonical.events) if ((event.kind === "phase" && event.phase === "mulligan")
      || (event.kind === "snapshot" && event.snapshot.room.rawPhase === "mulligan")) event.gameId = "previous-bo3-game";
    expect(summary(f)).toBeNull();
  });
});
