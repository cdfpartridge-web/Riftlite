import { describe, expect, it } from "vitest";
import {
  normalizeRawCaptureV1,
  projectReplayState,
  seekReplayByEventIndex,
  type JsonObject,
  type ReplayCardState,
} from "@/lib/replay-v2";
import { syntheticBo3Capture } from "@/lib/replay-v2/__fixtures__/synthetic-captures";
import { createReplayCardsUpProjectionCache, projectReplayCardsUp } from "./cards-up";
import { totalBattlefieldMight } from "./battlefield-might";

const card = (id: string, fields: JsonObject = {}, identity: Partial<ReplayCardState> = {}): ReplayCardState => ({
  id, name: "Synthetic unit", fields: { type: "Unit", ...fields }, ...identity,
});
const gear = (id: string, host: string, text: string, fields: JsonObject = {}): ReplayCardState => card(id, {
  type: "Gear", attachedToCardId: host, text, ...fields,
}, { name: "Synthetic gear" });

describe("Atlas battlefield might", () => {
  it("totals all units before the seven-group presentation limit, including exhausted units and zero", () => {
    const cards = Array.from({ length: 10 }, (_, index) => card(`unit-${index}`, { might: index }, { exhausted: index % 2 === 0 }));
    expect(totalBattlefieldMight(cards)).toEqual({ total: 45, unitCount: 10, unknownCount: 0 });
    expect(totalBattlefieldMight([])).toEqual({ total: 0, unitCount: 0, unknownCount: 0 });
    expect(totalBattlefieldMight([card("zero", { might: 0 })])).toEqual({ total: 0, unitCount: 1, unknownCount: 0 });
  });

  it("uses the recorded might before the packaged catalog and resolves missing values by code/name", () => {
    expect(totalBattlefieldMight([
      card("captured", { might: 9 }, { cardCode: "OGN-001" }),
      card("catalog", {}, { cardCode: "OGN-001" }),
      card("named", {}, { name: " Brazen  Buccaneer! " }),
      card("signature", {}, { cardCode: "OGN-003S" }),
    ])).toEqual({ total: 21, unitCount: 4, unknownCount: 0 });
    expect(totalBattlefieldMight([card("negative", { might: -2.5 })])).toEqual({ total: -2.5, unitCount: 1, unknownCount: 0 });
  });

  it.each([0, -3.8, 12.9, 120])("lets explicit finite white counter %s replace might and equipment without display clamping", (whiteCounter) => {
    const cards = [card("host", { might: 5, whiteCounter }), gear("sword", "host", "+2 [Might]")];
    expect(totalBattlefieldMight(cards)).toEqual({ total: Math.trunc(whiteCounter), unitCount: 1, unknownCount: 0 });
  });

  it.each([null, "8", true, [], {}, NaN, Infinity, -Infinity])("ignores malformed/nonfinite white counter %j like Atlas", (whiteCounter) => {
    expect(totalBattlefieldMight([card("host", { might: 5, whiteCounter }), gear("sword", "host", "+2 Might.")]))
      .toEqual({ total: 7, unitCount: 1, unknownCount: 0 });
  });

  it.each([null, "8", true, [], {}, NaN, Infinity, -Infinity])("does not coerce malformed/nonfinite recorded might %j", (might) => {
    expect(totalBattlefieldMight([card("unknown", { might })])).toEqual({ total: 0, unitCount: 1, unknownCount: 1 });
    expect(totalBattlefieldMight([card("catalog", { might }, { cardCode: "OGN-001" })]))
      .toEqual({ total: 5, unitCount: 1, unknownCount: 0 });
  });

  it("does not add status labels, temporary buffs, red damage counters or printed combat keywords", () => {
    expect(totalBattlefieldMight([card("unit", {
      might: 5, temporaryMightBuff: 3, redCounter: -2,
      customLabels: ["Buff 4", "Assault 3", "Empowered", "Stunned", "Temporary"],
      keywords: ["Assault"], text: "+9 [Might] while attacking.",
    })])).toEqual({ total: 5, unitCount: 1, unknownCount: 0 });
  });

  it("excludes hidden cards even when known, placeholders, attached units, and non-Units", () => {
    expect(totalBattlefieldMight([
      card("visible", { might: 2 }),
      card("own-hidden", { might: 80, hidden: true, revealedToOpponent: true }),
      card("placeholder", { might: 90 }, { isPlaceholder: true }),
      card("field-placeholder", { might: 100, isPlaceholder: true }),
      card("attached-unit", { might: 20, attachedToCardId: "visible" }),
      card("loose-gear", { type: "Gear", might: 50 }),
      card("spell", { type: "Spell", might: 10 }),
      card("unknown-type", { type: "unrecognized", might: 10 }),
    ])).toEqual({ total: 2, unitCount: 1, unknownCount: 0 });
  });

  it("supports catalog types and compound card types without guessing Unit from a numeric might", () => {
    expect(totalBattlefieldMight([
      card("catalog-type", { type: null }, { cardCode: "OGN-001" }),
      card("compound", { type: "Champion Unit", might: 3 }),
      card("unknown", { type: null, might: 12 }),
      card("unit-name-only", { type: "unitish", might: 20 }),
      card("spell-catalog", { type: null }, { cardCode: "OGN-004" }),
    ])).toEqual({ total: 8, unitCount: 2, unknownCount: 0 });
  });

  it("counts only directly attached visible Gear with a terminal printed might bonus", () => {
    const cards = [
      gear("before-host", "host", "[Equip]\n+3 [Might]\n\nFlavor Text\nSecret legend."),
      card("host", { might: 5 }),
      gear("penalty", "host", "Do something. -1 Might!"),
      gear("hidden-gear", "host", "+50 Might", { hidden: true }),
      { ...gear("placeholder-gear", "host", "+50 Might"), isPlaceholder: true },
      gear("other-host-gear", "not-here", "+50 Might"),
      gear("nested", "before-host", "+50 Might"),
      gear("conditional", "host", "+50 Might while attacking."),
      gear("flavor-only", "host", "Equip a unit.\nFlavour Text\n+50 Might"),
      gear("non-terminal", "host", "+50 Might.\nOther effect."),
    ];
    expect(totalBattlefieldMight(cards)).toEqual({ total: 7, unitCount: 1, unknownCount: 0 });
  });

  it("uses captured gear rules before catalog rules, and never treats unknown unit might as zero", () => {
    const sword = card("sword", { type: "Gear", attachedToCardId: "host" }, { name: "Long Sword" });
    expect(totalBattlefieldMight([card("host", { might: 3 }), sword])).toEqual({ total: 5, unitCount: 1, unknownCount: 0 });
    expect(totalBattlefieldMight([card("host", { might: 3 }), { ...sword, fields: { ...sword.fields, text: "+4 [Might]" } }]))
      .toEqual({ total: 7, unitCount: 1, unknownCount: 0 });
    expect(totalBattlefieldMight([card("known", { might: 2 }), card("host"), sword]))
      .toEqual({ total: 2, unitCount: 2, unknownCount: 1 });
  });

  it("matches Atlas token type/might fallbacks including zero and unknown token units", () => {
    const token = (id: string, name: string, fields: JsonObject = {}) => card(id, { type: null, ...fields }, { name, source: "token" });
    expect(totalBattlefieldMight([
      token("sand", "Sand Soldier Token"), token("clone", "Shadow Clone"),
      token("reflection", "Reflection"), token("recruit", "Recruit v3"),
      token("sprite", "Sprite"), token("tentacle", "Tentacle"), token("bird", "Birb"),
      token("mech", "Mech", { might: 9 }), token("gold", "Gold Gear Token"),
      token("bomb", "Bomb Token"), token("unknown", "Brush"),
    ])).toEqual({ total: 17, unitCount: 9, unknownCount: 1 });
    expect(totalBattlefieldMight([token("typed-gear", "Recruit", { type: "Gear", might: 9 })]))
      .toEqual({ total: 0, unitCount: 0, unknownCount: 0 });
  });

  it("round-trips counters, removals and lane movement through checkpoint seeking without leaking cards-up hand knowledge", () => {
    const capture = syntheticBo3Capture();
    capture.messages = capture.messages.slice(0, 3);
    const snapshot = JSON.parse(capture.messages[2].raw!);
    snapshot.snapshot.players[0].board.battlefieldA = [
      { id: "unit", name: "Synthetic fighter", source: "mainDeck", type: "Unit", might: 4 },
      { id: "gear", name: "Synthetic gear", source: "mainDeck", type: "Gear", attachedToCardId: "unit", text: "+2 [Might]" },
    ];
    Object.assign(snapshot.snapshot.players[1].board.hand[0], { type: "Unit", might: 8 });
    snapshot.snapshot.players[1].board.battlefieldA = [
      { id: "hidden", name: "Known hidden unit", type: "Unit", might: 40, hidden: true },
    ];
    capture.messages[2].raw = JSON.stringify(snapshot);
    const operations = [
      { op: "patch_card_fields", playerId: "player-local", zone: "battlefieldA", cardId: "unit", fields: { whiteCounter: 9 } },
      { op: "unset_card_fields", playerId: "player-local", zone: "battlefieldA", cardId: "unit", fields: ["whiteCounter"] },
      { op: "zone_move", cardId: "unit", from: { playerId: "player-local", zone: "battlefieldA" }, to: { playerId: "player-local", zone: "base", index: 0 } },
      {
        op: "zone_move", cardId: "opponent-hand-1", from: { playerId: "player-opponent", zone: "hand" },
        to: { playerId: "player-opponent", zone: "battlefieldA", index: 0 },
        card: { id: "opponent-hand-1", name: "Opponent revealed unit", type: "Unit", might: 8, source: "mainDeck" },
      },
    ];
    operations.forEach((operation, index) => capture.messages.push({
      seq: index + 3, ts: 1_033_000 + index * 1_000, dir: "in", raw: JSON.stringify({
        type: "authoritative_patch_commit", gameInstanceId: "ROOM42", baseSequence: index + 1,
        sequence: index + 2, patch: { operations: [operation] },
      }),
    }));
    const replay = normalizeRawCaptureV1(capture, { checkpoints: { everyEvents: 1 } });
    const initial = replay.events.findIndex(event => event.kind === "snapshot");
    const actionIndices = replay.events.flatMap((event, index) => event.kind === "action" ? [index] : []);
    expect(actionIndices).toHaveLength(4);
    const totalsAt = (index: number, player = "player-local") => totalBattlefieldMight(seekReplayByEventIndex(replay, index).state.players[player].zones.battlefieldA ?? []);
    expect(totalsAt(initial)).toEqual({ total: 6, unitCount: 1, unknownCount: 0 });
    expect(totalsAt(actionIndices[0])).toEqual({ total: 9, unitCount: 1, unknownCount: 0 });
    expect(totalsAt(actionIndices[1])).toEqual({ total: 6, unitCount: 1, unknownCount: 0 });
    expect(totalsAt(actionIndices[2])).toEqual({ total: 0, unitCount: 0, unknownCount: 0 });
    expect(totalsAt(actionIndices[3], "player-opponent")).toEqual({ total: 8, unitCount: 1, unknownCount: 0 });
    expect(totalsAt(initial)).toEqual({ total: 6, unitCount: 1, unknownCount: 0 });
    expect(seekReplayByEventIndex(replay, actionIndices[0]).state).toEqual(projectReplayState(replay, actionIndices[0]));
    const cache = createReplayCardsUpProjectionCache(replay);
    const cardsUp = projectReplayCardsUp(cache, initial).state;
    expect(cardsUp.players["player-opponent"].zones.hand[0].fields.analysisKnowledge).toBe("future_reveal");
    expect(totalBattlefieldMight(cardsUp.players["player-opponent"].zones.battlefieldA))
      .toEqual({ total: 0, unitCount: 0, unknownCount: 0 });
    expect(totalBattlefieldMight(projectReplayCardsUp(cache, actionIndices[3]).state.players["player-opponent"].zones.battlefieldA))
      .toEqual({ total: 8, unitCount: 1, unknownCount: 0 });
    expect(totalBattlefieldMight(projectReplayCardsUp(cache, initial).state.players["player-opponent"].zones.battlefieldA))
      .toEqual({ total: 0, unitCount: 0, unknownCount: 0 });
  });
});
