import { describe, expect, it } from "vitest";
import { normalizeSnapshot } from "../normalization";
import { projectReplayState } from "../project-state";
import type { CanonicalReplayV2, JsonObject, ReplayEvent } from "../types";
import { decodeAtlasPostgameReplay, encodeAtlasPostgameReplay, matchAtlasPostgameReplay, projectAtlasPostgameState } from "./index";

const START = 1_790_000_000_000;
function card(id: string, name = id) { return { id, name, cardCode: `SET-${id}`, ownerPlayerId: id.startsWith("b") ? "b" : "a", source: "mainDeck", exhausted: false, createdAt: START }; }
function board(id: string) {
  return { score: 0, floatingEnergy: 0, floatingPower: 0, deck: [card(`${id}-deck`)], hand: [card(`${id}-hand`)], base: [], trash: [], battlefieldA: [], battlefieldB: [], battlefieldToken: [], champion: [], legend: [card(`${id}-legend`)], runeDeck: [], runeArea: [], handRevealToOpponent: false, deckPeek: { cardIds: [] } };
}
function fixture() {
  const players = [{ id: "a", name: "Player A", seat: 0, board: board("a") }, { id: "b", name: "Player B", seat: 1, board: board("b") }];
  const state: JsonObject = { roomCode: "ROOM", createdAt: START - 10_000, gameHistoryStartedAt: START, phase: "in_game", gameVariant: "duel", roomMode: "multiplayer", matchFormat: "bo1", rewindProtocolVersion: 5, testMode: false, activeTurnPlayerId: "a", turnNumber: 1, players, chainEntries: [], log: [], targetArrowsByPlayer: {} };
  const final: JsonObject = { ...state, turnNumber: 2, gameOutcome: { winnerPlayerIds: ["a"], reason: "concession", decidedAtTurnNumber: 2 } };
  return { format: "riftatlas-replay", version: 1, replay: { replayId: "test-export", viewerPlayerId: "a", players: players.map(({ id, name, seat }) => ({ id, name, seat })), canFork: true, canSwitchPerspective: true, createdAt: START, completedAt: START + 1000, frames: [{ index: 0, sequence: 10, elapsedMs: 0, actionType: "start", state }, { index: 1, sequence: 11, elapsedMs: 1000, actionType: "concede", state: final }] } };
}
function canonicalFor(input = fixture()): CanonicalReplayV2 {
  const source = decodeAtlasPostgameReplay(input);
  const events: ReplayEvent[] = [{ kind: "game_boundary", boundary: "start", id: "opening", index: 0, at: START - 5000, atMs: 0, sourceMessageId: "0", gameId: "game-1", gameOrdinal: 1, gameNumber: 1, reason: "series_start" }];
  const opening = normalizeSnapshot({ ...source.view.frames[0].state, phase: "mulligan" }, "opening", 1, "a");
  events.push({ kind: "snapshot", id: "opening-state", index: 1, at: START - 4000, atMs: 1000, sourceMessageId: "1", gameId: "game-1", sequence: 9, snapshot: opening });
  for (const frame of source.view.frames) {
    events.push({ kind: "snapshot", id: `snapshot-${frame.index}`, index: events.length, at: START + frame.elapsedMs, atMs: 5000 + frame.elapsedMs, sourceMessageId: String(frame.sequence), gameId: "game-1", sequence: frame.sequence, snapshot: normalizeSnapshot(frame.state, `source-${frame.index}`, 1, "a") });
  }
  return {
    schema: "riftlite-canonical-replay", version: 2, id: "capture", source: { schema: "riftreplay-raw-capture", version: 1, captureSessionId: "capture", roomCode: "ROOM", startedAt: START - 5000, endedAt: START + 1000, messageCount: 3 },
    series: { id: "series", perspectivePlayerId: "a", format: "bo1", bestOf: 1, roomCode: "ROOM", startedAt: START - 5000, endedAt: START + 1000, participants: [{ id: "a", name: "Player A", isPerspective: true, fields: {} }, { id: "b", name: "Player B", isPerspective: false, fields: {} }], games: [{ id: "game-1", ordinal: 1, gameNumber: 1, sourceIdentity: { explicitGameNumber: false, gameInstanceIds: [] }, startedAt: START - 5000, endedAt: START + 1000, startedAtMs: 0, endedAtMs: 6000, eventStartIndex: 0, eventEndIndex: 3, phases: [] }] },
    events, unknownEvents: [], diagnostics: [], checkpoints: [],
  };
}

function maskedCanonicalFor(input = fixture()): CanonicalReplayV2 {
  const canonical = canonicalFor(input);
  for (const event of canonical.events) if (event.kind === "snapshot") {
    for (const [playerId, player] of Object.entries(event.snapshot.players)) {
      for (const [zone, cards] of Object.entries(player.zones)) {
        if (!["deck", "runeDeck", "sideboard"].includes(zone) && !(playerId === "b" && zone === "hand")) continue;
        // Atlas's actual player capture masks private zones with owner/zone/slot IDs.
        // These IDs intentionally differ from the post-game export's real card IDs.
        player.zones[zone] = cards.map((_card, index) => {
          const id = `__hidden_zone__:${playerId}:${zone}:${index}`;
          return { id, name: "", ownerPlayerId: playerId, source: zone, isPlaceholder: true,
            fields: { id, ownerPlayerId: playerId, source: zone, isPlaceholder: true } };
        });
      }
    }
  }
  return canonical;
}

describe("Atlas post-game files", () => {
  it("accepts completed duel v1/v2 and retains shared board references without expansion", () => {
    const first = decodeAtlasPostgameReplay(fixture());
    expect(first.view.frames[0].state.players).toBe(first.view.frames[1].state.players);
    const encoded = encodeAtlasPostgameReplay(first);
    const roundtrip = decodeAtlasPostgameReplay(JSON.stringify(encoded));
    expect(roundtrip.metadata).toEqual(first.metadata);
    expect(roundtrip.view.frames[0].state.players).toBe(roundtrip.view.frames[1].state.players);
  });
  it("drops arbitrary fields and nested credentials before compact encoding", () => {
    const input = fixture();
    Object.assign(input.replay, { privateNotes: "DO NOT STORE", accessToken: "DO NOT STORE" });
    Object.assign(input.replay.frames[0].state, { unknownMetadata: { secret: "DO NOT STORE" } });
    const source = decodeAtlasPostgameReplay(input);
    expect(JSON.stringify(encodeAtlasPostgameReplay(source))).not.toContain("DO NOT STORE");
  });
  it.each([
    ["perspective restriction", (f: ReturnType<typeof fixture>) => { f.replay.canSwitchPerspective = false; }],
    ["private deck", (f: ReturnType<typeof fixture>) => { Object.assign(f.replay, { privateDeckPlayerIds: ["b"] }); }],
    ["blocked fork", (f: ReturnType<typeof fixture>) => { Object.assign(f.replay, { forkBlockedReason: "series_in_progress" }); }],
    ["unfinished game", (f: ReturnType<typeof fixture>) => { delete (f.replay.frames[1].state as JsonObject).gameOutcome; }],
    ["placeholder", (f: ReturnType<typeof fixture>) => { const players = f.replay.frames[0].state.players as JsonObject[]; ((players[1].board as JsonObject).hand as JsonObject[])[0].isPlaceholder = true; }],
    ["hidden zone ID", (f: ReturnType<typeof fixture>) => { const players = f.replay.frames[0].state.players as JsonObject[]; ((players[1].board as JsonObject).hand as JsonObject[])[0].id = "__hidden_zone__:hand:0"; }],
    ["multiplayer variant", (f: ReturnType<typeof fixture>) => { f.replay.frames[0].state.gameVariant = "free_for_all"; }],
    ["sequence reversal", (f: ReturnType<typeof fixture>) => { f.replay.frames[1].sequence = 1; }],
    ["elapsed reversal", (f: ReturnType<typeof fixture>) => { f.replay.frames[1].elapsedMs = -1; }],
    ["future ending", (f: ReturnType<typeof fixture>) => { f.replay.completedAt += 100_000; }],
    ["BO3 without an explicit game number", (f: ReturnType<typeof fixture>) => { f.replay.frames.forEach(frame => { frame.state.matchFormat = "bo3"; }); }],
  ])("rejects %s", (_name, mutate) => { const input = fixture(); mutate(input); expect(() => decodeAtlasPostgameReplay(input)).toThrow(); });
  it("rejects reference cycles, forward references, dangerous keys and expansion bombs", () => {
    expect(() => decodeAtlasPostgameReplay({ format: "riftatlas-replay", version: 2, nodes: [["a", [{ r: 0 }]]], root: { r: 0 } })).toThrow();
    expect(() => decodeAtlasPostgameReplay({ format: "riftatlas-replay", version: 2, nodes: [["o", [["__proto__", null]]]], root: { r: 0 } })).toThrow();
    const nodes: unknown[] = [["a", ["large"]]];
    for (let index = 1; index < 32; index++) nodes.push(["a", [{ r: index - 1 }, { r: index - 1 }]]);
    expect(() => decodeAtlasPostgameReplay({ format: "riftatlas-replay", version: 2, nodes, root: { r: nodes.length - 1 } })).toThrow(/limits/);
    const cyclic = fixture(); Object.assign(cyclic.replay, { frames: [cyclic.replay] });
    expect(() => decodeAtlasPostgameReplay(cyclic)).toThrow();
  });
});

describe("Atlas attachment alignment", () => {
  it("reports only bounded categorical mismatch counts while retaining the rejection", () => {
    const source = decodeAtlasPostgameReplay(fixture()), canonical = canonicalFor();
    for (const event of canonical.events) if (event.kind === "snapshot") event.snapshot.players.a.zones.legend[0].fields.exhausted = true;
    let diagnostic: unknown;
    try { matchAtlasPostgameReplay(canonical, source); } catch (error) { diagnostic = (error as { matchDiagnostics?: unknown }).matchDiagnostics; }
    expect(diagnostic).toEqual({ sequence_overlap: 1, status: 2, insufficient_matching_positions: 1 });
    expect(JSON.stringify(diagnostic)).not.toMatch(/ROOM|Player|legend|1790/);
  });
  it("matches genuine masked capture slots using exact public cards and sequences without changing original IDs or opening", () => {
    const input = fixture();
    const players = input.replay.frames[0].state.players as JsonObject[];
    ((players[1].board as JsonObject).hand as JsonObject[]).push(card("b-hand-2"));
    const source = decodeAtlasPostgameReplay(input), canonical = maskedCanonicalFor(input);
    const before = JSON.stringify(canonical), alignment = matchAtlasPostgameReplay(canonical, source);
    expect(alignment.matchedEventCount).toBe(2);
    const state = projectReplayState(canonical, 2), projected = projectAtlasPostgameState(state, source, alignment);
    expect(projected.available).toBe(true);
    expect(projected.state.players.b.zones.hand.map(card => card.name)).toEqual(["b-hand", "b-hand-2"]);
    expect(projected.state.players.b.zones.hand.map(card => card.id)).toEqual(["__hidden_zone__:b:hand:0", "__hidden_zone__:b:hand:1"]);
    expect(projected.state.players.a.zones.deck[0].name).toBe("a-deck");
    expect(projected.state.players.b.boardFields.handRevealToOpponent).toBe(false);
    expect(state.players.b.zones.hand.every(card => card.name === "" && card.isPlaceholder === true)).toBe(true);
    const opening = projectReplayState(canonical, 1);
    expect(projectAtlasPostgameState(opening, source, alignment)).toMatchObject({ state: opening, available: false });
    expect(JSON.stringify(canonical)).toBe(before);
  });
  it.each(["owner", "zone", "slot", "count", "visible card", "sequence", "history", "missing history", "identity", "placeholder flag", "owner field"])("rejects masked-slot %s mismatches", changed => {
    const source = decodeAtlasPostgameReplay(fixture()), canonical = maskedCanonicalFor();
    for (const event of canonical.events) if (event.kind === "snapshot") {
      const hand = event.snapshot.players.b.zones.hand, hidden = hand[0];
      if (changed === "owner") hidden.id = "__hidden_zone__:a:hand:0";
      if (changed === "zone") hidden.id = "__hidden_zone__:b:deck:0";
      if (changed === "slot") hidden.id = "__hidden_zone__:b:hand:1";
      if (changed === "count") hand.pop();
      if (changed === "visible card") event.snapshot.players.b.zones.legend[0].id = "different-legend";
      if (changed === "sequence") event.sequence = 99;
      if (changed === "history") event.snapshot.room.fields.gameHistoryStartedAt = START - 1;
      if (changed === "missing history") delete event.snapshot.room.fields.gameHistoryStartedAt;
      if (changed === "identity") hidden.name = "Already identified card";
      if (changed === "placeholder flag") hidden.isPlaceholder = false;
      if (changed === "owner field") hidden.fields.ownerPlayerId = "a";
    }
    expect(() => matchAtlasPostgameReplay(canonical, source)).toThrow();
  });
  it("never counts masked slots or known private cards as the two public card anchors", () => {
    const input = fixture();
    const players = input.replay.frames[0].state.players as JsonObject[];
    (players[1].board as JsonObject).legend = [];
    const source = decodeAtlasPostgameReplay(input), canonical = maskedCanonicalFor(input);
    expect(() => matchAtlasPostgameReplay(canonical, source)).toThrow("enough matching");
  });
  it("projects a masked slot only from its exact frame and never carries a prior slot identity forward", () => {
    const input = fixture();
    input.replay.frames[1].state = structuredClone(input.replay.frames[1].state);
    const players = input.replay.frames[1].state.players as JsonObject[];
    ((players[1].board as JsonObject).hand as JsonObject[])[0] = card("b-new-hand");
    const source = decodeAtlasPostgameReplay(input), canonical = maskedCanonicalFor(input);
    const alignment = matchAtlasPostgameReplay(canonical, source);
    const first = projectAtlasPostgameState(projectReplayState(canonical, 2), source, alignment);
    const last = projectAtlasPostgameState(projectReplayState(canonical, 3), source, alignment);
    expect(first.state.players.b.zones.hand[0]).toMatchObject({ id: "__hidden_zone__:b:hand:0", name: "b-hand" });
    expect(last.state.players.b.zones.hand[0]).toMatchObject({ id: "__hidden_zone__:b:hand:0", name: "b-new-hand" });
    const stale = projectReplayState(canonical, 3);
    stale.players.b.zones.hand.push({ ...stale.players.b.zones.hand[0], id: "__hidden_zone__:b:hand:1" });
    expect(projectAtlasPostgameState(stale, source, alignment).available).toBe(false);
  });
  it("enriches only matched captured positions and preserves the opening, timeline, review identity and visibility flags", () => {
    const source = decodeAtlasPostgameReplay(fixture()), canonical = canonicalFor();
    const before = JSON.stringify(canonical), alignment = matchAtlasPostgameReplay(canonical, source);
    expect(alignment.matchedEventCount).toBe(2);
    const opening = projectReplayState(canonical, 1);
    expect(projectAtlasPostgameState(opening, source, alignment)).toMatchObject({ state: opening, available: false });
    expect(projectAtlasPostgameState(opening, source, alignment).state).toBe(opening);
    const state = projectReplayState(canonical, 2);
    expect(state.players.b.zones.hand[0].name).toBe("");
    const projected = projectAtlasPostgameState(state, source, alignment);
    expect(projected.available).toBe(true);
    expect(projected.state.players.b.zones.hand[0].name).toBe("b-hand");
    expect(projected.state.players.b.boardFields.handRevealToOpponent).toBe(false);
    expect(projected.state.appliedEventIndex).toBe(2);
    expect(projected.state.gameId).toBe(state.gameId);
    expect(projected.state.room).toBe(state.room);
    expect(projected.state.log).toBe(state.log);
    expect(projected.state.chat).toBe(state.chat);
    expect(state.players.b.zones.hand[0].name).toBe("");
    expect(JSON.stringify(canonical)).toBe(before);
  });
  it.each(["room", "participant", "time", "sequence", "card", "turn", "history"])("rejects unrelated %s even with matching times", (changed) => {
    const source = decodeAtlasPostgameReplay(fixture()), canonical = canonicalFor();
    if (changed === "room") canonical.series.roomCode = "OTHER";
    if (changed === "participant") canonical.series.participants[1].id = "other";
    if (changed === "time") canonical.series.games[0].endedAt = START - 100_000;
    for (const event of canonical.events) if (event.kind === "snapshot") {
      if (changed === "sequence") event.sequence = 99;
      if (changed === "card") event.snapshot.players.b.zones.hand[0].id = "other";
      if (changed === "turn") event.snapshot.room.turnNumber = 99;
      if (changed === "history") event.snapshot.room.fields.gameHistoryStartedAt = START - 1;
    }
    expect(() => matchAtlasPostgameReplay(canonical, source)).toThrow();
  });
  it("rechecks the live projected state and never carries a future identity into another position", () => {
    const source = decodeAtlasPostgameReplay(fixture()), canonical = canonicalFor();
    const alignment = matchAtlasPostgameReplay(canonical, source), state = projectReplayState(canonical, 2);
    state.players.b.zones.hand[0].id = "different-card";
    expect(projectAtlasPostgameState(state, source, alignment).available).toBe(false);
  });
  it("binds an explicit BO3 game separately from other games", () => {
    const input = fixture();
    input.replay.frames.forEach(frame => { frame.state.matchFormat = "bo3"; frame.state.gameNumber = 2; });
    const source = decodeAtlasPostgameReplay(input), canonical = canonicalFor(input);
    canonical.series.format = "bo3"; canonical.series.bestOf = 3;
    canonical.series.games[0].gameNumber = 2;
    canonical.series.games.push({ ...canonical.series.games[0], id: "other-game", gameNumber: 1, ordinal: 2 });
    const alignment = matchAtlasPostgameReplay(canonical, source);
    expect(alignment.gameNumber).toBe(2);
    const state = projectReplayState(canonical, 2);
    expect(projectAtlasPostgameState(state, source, alignment).available).toBe(true);
    expect(projectAtlasPostgameState({ ...state, gameId: "other-game" }, source, alignment).available).toBe(false);
  });
});
