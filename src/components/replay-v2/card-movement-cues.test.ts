import { describe, expect, it } from "vitest";
import type { ReplayActionEvent, ReplayEvent, ReplayPatchOperation } from "@/lib/replay-v2";
import { normalizeRawCaptureV1 } from "@/lib/replay-v2/normalize-replay";
import { syntheticBo3Capture } from "@/lib/replay-v2/__fixtures__/synthetic-captures";
import { explicitReplayCardMovements, replayCardMovementCues } from "./card-movement-cues";

const card = (id: string) => ({ id, name: "Visible card", fields: {} });
const move = (cardId = "card-1", from = "base", to = "trash", playerId = "self"): ReplayPatchOperation => ({
  id: `move-${cardId}`, op: "zone_move", cardId,
  from: { playerId, zone: from }, to: { playerId, zone: to, index: 0 },
});
function action(index: number, operations: ReplayPatchOperation[], gameId = "game-1"): ReplayActionEvent {
  return { id: `action-${index}`, index, at: index * 100, atMs: index * 100, sourceMessageId: `packet-${index}`,
    gameId, kind: "action", actionType: "authoritative_patch_commit", action: {},
    confirmation: { status: "confirmed", authority: "authoritative_patch_commit", correlation: "intent_not_observed", commitMessageId: `commit-${index}` },
    patch: { operations } };
}
const range = { fromExclusiveIndex: 0, toInclusiveIndex: 1, gameId: "game-1", suppressMotion: false };
const replay = (events: ReplayEvent[]) => ({ events, series: { perspectivePlayerId: "self" } });

describe("explicit replay exit cues", () => {
  it("accepts production-normalized authoritative commits and ignores unconfirmed intents", () => {
    const raw = syntheticBo3Capture();
    const commit = JSON.parse(raw.messages[4].raw!);
    commit.action.toZone = "trash";
    commit.patch.operations[0].to.zone = "trash";
    raw.messages[4].raw = JSON.stringify(commit);
    const normalized = normalizeRawCaptureV1(raw);
    const event = normalized.events.find((event) => event.kind === "action" && event.actionType === "move_card")!;
    expect(explicitReplayCardMovements(event, { perspectivePlayerId: normalized.series.perspectivePlayerId })).toMatchObject([{ cardId: "local-card", kind: "trash" }]);
    const unconfirmed = normalized.unknownEvents.filter((event) => event.reason === "unconfirmed_intent");
    expect(unconfirmed.length).toBeGreaterThan(0);
    expect(unconfirmed.flatMap((event) => explicitReplayCardMovements(event))).toEqual([]);
  });
  it.each(["trash", "discard", "graveyard", "recycle-pile"])("recognizes an explicit move into %s without exporting identity", (zone) => {
    const operation = move("card-1", "Battlefield A", zone);
    const event = action(1, [operation]);
    const before = JSON.stringify(event);
    expect(explicitReplayCardMovements(event)).toEqual([{
      id: "action-1:card-1:trash", eventIndex: 1, gameId: "game-1", cardId: "card-1",
      from: { playerId: "self", zone: "Battlefield A" }, to: { playerId: "self", zone },
      kind: "trash", destinationZone: "discard", forceCardBack: false,
    }]);
    expect(JSON.stringify(event)).toBe(before);
  });

  it("pairs remove and insert by exact card identity even when insertion is listed first", () => {
    const event = action(1, [
      { id: "insert", op: "zone_insert", playerId: "opponent", zone: "discard", index: 0, cards: [card("b"), card("a")] },
      { id: "remove", op: "zone_remove", playerId: "opponent", zone: "hand", cardIds: ["a", "b"] },
    ]);
    expect(explicitReplayCardMovements(event, { perspectivePlayerId: "self" }).map((cue) => [cue.cardId, cue.forceCardBack])).toEqual([["a", true], ["b", true]]);
  });

  it("does not guess from unmatched, differently identified or ambiguous remove/insert operations", () => {
    expect(explicitReplayCardMovements(action(1, [
      { id: "remove", op: "zone_remove", playerId: "self", zone: "base", cardIds: ["a"] },
      { id: "insert", op: "zone_insert", playerId: "self", zone: "trash", index: 0, cards: [card("b")] },
    ]))).toEqual([]);
    expect(explicitReplayCardMovements(action(1, [
      { id: "remove", op: "zone_remove", playerId: "self", zone: "base", cardIds: ["a"] },
      { id: "also-remove", op: "zone_remove", playerId: "opponent", zone: "base", cardIds: ["a"] },
      { id: "insert", op: "zone_insert", playerId: "self", zone: "trash", index: 0, cards: [card("a")] },
    ]))).toEqual([]);
  });

  it("recognizes same-player rune recycling, not channeling or unrelated deck movement", () => {
    expect(explicitReplayCardMovements(action(1, [move("rune", "runeArea", "runeDeck")]))[0]).toMatchObject({ kind: "rune-recycle", destinationZone: "runeDeck" });
    for (const [from, to] of [["runeDeck", "runeArea"], ["hand", "runeDeck"], ["base", "deck"], ["unknown", "runeDeck"]]) {
      expect(explicitReplayCardMovements(action(1, [move("rune", from, to)]))).toEqual([]);
    }
    const transfer = move("rune", "runeArea", "runeDeck");
    if (transfer.op === "zone_move") transfer.to.playerId = "opponent";
    expect(explicitReplayCardMovements(action(1, [transfer]))).toEqual([]);
  });

  it("keeps private or placeholder movements face down and never copies private card payloads", () => {
    const hidden = { ...move("secret", "base", "trash"), card: { ...card("secret"), name: "Do not export", cardCode: "SECRET", isPlaceholder: true } } as ReplayPatchOperation;
    const cue = explicitReplayCardMovements(action(1, [hidden]))[0];
    expect(cue.forceCardBack).toBe(true);
    expect(JSON.stringify(cue)).not.toContain("Do not export");
    expect(JSON.stringify(cue)).not.toContain("SECRET");
    expect(explicitReplayCardMovements(action(1, [move("a", "library", "trash")]))[0].forceCardBack).toBe(true);
    expect(explicitReplayCardMovements(action(1, [move("a", "hand", "trash")]), { perspectivePlayerId: "self" })[0].forceCardBack).toBe(false);
  });

  it("deduplicates echo operations and ignores an intermediate trash visit undone in the same commit", () => {
    expect(explicitReplayCardMovements(action(1, [move(), move()]))).toHaveLength(1);
    expect(explicitReplayCardMovements(action(1, [move(), move("card-1", "trash", "base")]))).toEqual([]);
    expect(explicitReplayCardMovements(action(1, [move("card-1", "discard", "trash")]))).toEqual([]);
  });
});

describe("movement playback window", () => {
  it("establishes a silent baseline after a snapshot resync and rejects opening setup", () => {
    const snapshot: ReplayEvent = { ...action(2, []), kind: "snapshot", snapshot: {
      room: { phase: "in_game", rawPhase: "in_game", gameNumber: 1, fields: {} }, players: {}, chain: [], log: [],
    } };
    expect(replayCardMovementCues(replay([action(0, []), action(1, [move()]), snapshot]), { ...range, toInclusiveIndex: 2 })).toEqual([]);
    snapshot.index = 0;
    snapshot.snapshot.room.phase = "mulligan";
    expect(replayCardMovementCues(replay([snapshot, action(1, [move()])]), range)).toEqual([]);
  });
  it("uses explicit committed operations, never an unconfirmed intent or snapshot difference", () => {
    const intent = { ...action(1, []), action: { type: "trash", cardId: "card-1" } };
    expect(replayCardMovementCues(replay([action(0, []), intent]), range)).toEqual([]);
    expect(replayCardMovementCues(replay([action(0, []), action(1, [move()])]), range)).toHaveLength(1);
  });

  it.each([
    { suppressMotion: true }, { fromExclusiveIndex: -1 }, { fromExclusiveIndex: 1 },
    { fromExclusiveIndex: 2 }, { toInclusiveIndex: Number.NaN }, { toInclusiveIndex: 5 }, { gameId: "game-2" },
  ])("suppresses initial, invalid, backwards, seek and wrong-game windows: %j", (patch) => {
    expect(replayCardMovementCues(replay([action(0, []), action(1, [move()])]), { ...range, ...patch })).toEqual([]);
  });

  it("does not animate across a BO3 boundary or prelude phase", () => {
    const boundary: ReplayEvent = { ...action(1, []), kind: "game_boundary", boundary: "start", gameOrdinal: 2, gameNumber: 2, reason: "phase_rollover" };
    const setup: ReplayEvent = { ...action(1, []), kind: "phase", phase: "mulligan", rawPhase: "mulligan", gameNumber: 1 };
    for (const event of [boundary, setup]) {
      expect(replayCardMovementCues(replay([action(0, []), event, action(2, [move()])]), { ...range, toInclusiveIndex: 2 })).toEqual([]);
    }
  });

  it("caps fast playback and removes exits undone by later movement in the same rendered frame", () => {
    const events = [action(0, []), ...Array.from({ length: 20 }, (_, index) => action(index + 1, [move(`card-${index}`)]))];
    expect(replayCardMovementCues(replay(events), { ...range, toInclusiveIndex: 20 }).map((cue) => cue.cardId)).toEqual(Array.from({ length: 8 }, (_, index) => `card-${index + 12}`));
    expect(replayCardMovementCues(replay([action(0, []), action(1, [move()]), action(2, [move("card-1", "trash", "deck")])]), { ...range, toInclusiveIndex: 2 })).toEqual([]);
  });
});
