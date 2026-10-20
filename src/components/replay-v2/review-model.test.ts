import { describe, expect, it } from "vitest";
import type { CanonicalReplayV2, JsonObject, ReplayCardState, ReplayEvent, ReplayPatchOperation, ReplaySnapshot } from "@/lib/replay-v2/types";
import { buildReplayReview, searchReplayReview } from "./review-model";
import { normalizeRawCaptureV1 } from "@/lib/replay-v2";
import { syntheticBo3Capture } from "@/lib/replay-v2/__fixtures__/synthetic-captures";

const unit = (id: string, name = id, fields: JsonObject = {}): ReplayCardState => ({ id, name, fields: { type: "Unit", might: 3, ...fields } });
const board = (ours: Record<string, ReplayCardState[]> = {}, theirs: Record<string, ReplayCardState[]> = {}, phase: ReplaySnapshot["room"]["phase"] = "in_game", ourScore = 0, theirScore = 0): ReplaySnapshot => ({
  room: { phase, rawPhase: phase, gameNumber: 1, turnNumber: 1, activeTurnPlayerId: "us", fields: {} },
  players: {
    us: { id: "us", name: "Private player name", fields: {}, boardFields: { score: ourScore }, score: ourScore, zones: ours },
    them: { id: "them", name: "Private opponent name", fields: {}, boardFields: { score: theirScore }, score: theirScore, zones: theirs },
  }, chain: [], log: [],
});
type EventInput = Omit<Extract<ReplayEvent, { kind: "action" }>, "index" | "at" | "atMs" | "sourceMessageId" | "id" | "gameId"> |
  Omit<Extract<ReplayEvent, { kind: "snapshot" }>, "index" | "at" | "atMs" | "sourceMessageId" | "id" | "gameId"> |
  Omit<Extract<ReplayEvent, { kind: "game_boundary" }>, "index" | "at" | "atMs" | "sourceMessageId" | "id" | "gameId"> |
  Omit<Extract<ReplayEvent, { kind: "unknown" }>, "index" | "at" | "atMs" | "sourceMessageId" | "id" | "gameId"> |
  Omit<Extract<ReplayEvent, { kind: "phase" }>, "index" | "at" | "atMs" | "sourceMessageId" | "id" | "gameId"> |
  Omit<Extract<ReplayEvent, { kind: "chat" }>, "index" | "at" | "atMs" | "sourceMessageId" | "id" | "gameId">;
const snapshot = (value: ReplaySnapshot): EventInput => ({ kind: "snapshot", snapshot: value });
const action = (operations: ReplayPatchOperation[], actionType = "recorded_update", extra: JsonObject = {}): EventInput => ({ kind: "action", actionType, action: { type: actionType, ...extra }, confirmation: { status: "confirmed", authority: "authoritative_patch_commit", correlation: "intent_not_observed", commitMessageId: "commit" }, patch: { operations } });
const move = (id: string, from: string, to: string, playerId = "us"): EventInput => action([{ id: "move", op: "zone_move", cardId: id, from: { playerId, zone: from }, to: { playerId, zone: to, index: -1 } }], "move_card");
const fields = (cardId: string, patch: JsonObject, playerId = "us", zone = "battlefieldA"): EventInput => action([{ id: "fields", op: "patch_card_fields", playerId, zone, cardId, fields: patch }], "set_card_label");

function replay(inputs: EventInput[], options: { result?: boolean; tcga?: boolean; times?: number[]; secondGameAt?: number } = {}): CanonicalReplayV2 {
  const events = inputs.map((input, index) => ({ ...input, index, id: `event-${index}`, sourceMessageId: `packet-${index}`, atMs: options.times?.[index] ?? index * 1000, at: options.times?.[index] ?? index * 1000, gameId: options.secondGameAt !== undefined && index >= options.secondGameAt ? "g2" : "g1" }) as ReplayEvent);
  const ranges = options.secondGameAt === undefined ? [[0, events.length - 1]] : [[0, options.secondGameAt - 1], [options.secondGameAt, events.length - 1]];
  return {
    schema: "riftlite-canonical-replay", version: 2, id: "fixture",
    source: { schema: options.tcga ? "riftlite-tcga-raw-capture" : "riftreplay-raw-capture", version: 1, captureSessionId: "fixture", roomCode: "PRIVATE-ROOM", startedAt: 0, endedAt: events.at(-1)?.at ?? 0, messageCount: events.length },
    series: { id: "series", perspectivePlayerId: "us", format: options.secondGameAt === undefined ? "bo1" : "bo3", bestOf: options.secondGameAt === undefined ? 1 : 3, roomCode: "PRIVATE-ROOM", startedAt: 0, endedAt: events.at(-1)?.at ?? 0,
      participants: [{ id: "us", name: "Private player name", isPerspective: true, fields: {} }, { id: "them", name: "Private opponent name", isPerspective: false, fields: {} }],
      games: ranges.map(([start, end], index) => ({ id: `g${index + 1}`, ordinal: index + 1, gameNumber: index + 1, sourceIdentity: { explicitGameNumber: true, gameInstanceIds: [] }, startedAt: events[start]?.at ?? 0, endedAt: events[end]?.at ?? 0, startedAtMs: events[start]?.atMs ?? 0, endedAtMs: events[end]?.atMs ?? 0, eventStartIndex: start, eventEndIndex: end, phases: [], ...(options.result ? { result: { resultEventId: events[end]?.id ?? "", winnerPlayerId: "us" } } : {}) })),
    }, events, checkpoints: [], diagnostics: [], unknownEvents: [],
  };
}

describe("replay review model", () => {
  it("finds plays, card movements, statuses, scores and opening/mulligan moments using canonical evidence", () => {
    const source = replay([
      snapshot(board({ hand: [unit("a", "Annie, Fiery")] }, { battlefieldA: [unit("b", "Braum")] }, "mulligan")),
      action([], "submit_mulligan"), move("a", "hand", "base"), move("a", "base", "battlefieldA"),
      fields("a", { customLabels: ["Stunned", "Buff 2"] }),
      action([{ id: "score", op: "set_board_fields", playerId: "us", fields: { score: 1 } }], "battlefield_conquer_confirm"),
      move("b", "battlefieldA", "trash", "them"),
      { kind: "game_boundary", boundary: "end", gameOrdinal: 1, gameNumber: 1, reason: "explicit_result" },
    ], { result: true });
    const index = buildReplayReview(source);
    expect(searchReplayReview(index, "annie", "g1", "play")).toHaveLength(1);
    expect(searchReplayReview(index, "annie", "g1", "combat")).toHaveLength(1);
    expect(searchReplayReview(index, "buff 2").some((entry) => entry.kind === "status")).toBe(true);
    expect(searchReplayReview(index, "scored", "g1", "score")[0].summary).toBe("Our side: 0 → 1");
    expect(index.moments.map((entry) => entry.kind)).toEqual(["opening", "mulligan", "combat", "score", "end"]);
    expect(index.games).toEqual([{ id: "g1", number: 1, partial: false }]);
    expect(index.combats).toHaveLength(1);
    expect(index.combats[0]).toMatchObject({ startEventIndex: 3, endEventIndex: 6, incomplete: false });
    expect(index.combats[0].before.sides[0].cards[0].name).toBe("Annie, Fiery");
    expect(index.combats[0].after.sides[1].cards).toEqual([]);
    expect(JSON.stringify(index)).not.toMatch(/killed|misplay|mistake|won the combat/i);
  });

  it("never backfills a later revealed card name into hidden moves or earlier combat snapshots", () => {
    const hidden = { ...unit("secret", "Future secret"), isPlaceholder: true };
    const source = replay([
      snapshot(board({ battlefieldA: [unit("a")] }, { hand: [hidden], battlefieldA: [unit("b")] })),
      move("secret", "hand", "battlefieldA", "them"),
      fields("secret", { name: "Future secret", isPlaceholder: false, revealedToOpponent: true }, "them"),
    ]);
    const index = buildReplayReview(source);
    expect(searchReplayReview(index, "future secret").every((entry) => entry.eventIndex >= 2)).toBe(true);
    expect(JSON.stringify(index.combats[0].before)).not.toContain("Future secret");
    expect(index.entries.find((entry) => entry.eventIndex === 1)?.cardNames).toEqual([]);
  });

  it("does not index opponent hand/deck identities even when their names exist in canonical fields", () => {
    const source = replay([
      snapshot(board({ hand: [unit("our", "Our hand")], deck: [unit("deck", "Deck secret")] }, { hand: [unit("their", "ForbiddenIdentityOne")], deck: [unit("their-deck", "ForbiddenIdentityTwo")] }, "mulligan")),
      fields("their", { customLabels: ["Stunned"] }, "them", "hand"),
      move("deck", "deck", "hand"),
      move("their-deck", "deck", "hand", "them"),
    ]);
    const index = buildReplayReview(source);
    expect(searchReplayReview(index, "ForbiddenIdentityOne")).toEqual([]);
    expect(searchReplayReview(index, "ForbiddenIdentityTwo")).toEqual([]);
    expect(searchReplayReview(index, "deck secret").map((entry) => entry.eventIndex)).toEqual([2]);
    expect(searchReplayReview(index, "our hand")).toHaveLength(2);
  });

  it("keeps arbitrary action values, log text, unknown packets and custom labels out of search", () => {
    const source = replay([
      snapshot(board({ base: [unit("a", "Known unit")] })),
      action([{ id: "fields", op: "patch_card_fields", playerId: "us", zone: "base", cardId: "a", fields: { customLabels: ["SECRET-CUSTOM-LABEL", "Stunned"] } }, { id: "log", op: "log_insert", index: -1, entries: [{ id: "log", text: "SECRET-LOG", fields: {} }] }], "SECRET-ACTION-TYPE", { token: "SECRET-TOKEN", secret: "SECRET-ACTION" }),
      { kind: "unknown", packetType: "SECRET-PACKET", reason: "unsupported_packet", payload: { secret: "SECRET-UNKNOWN" } },
      { kind: "chat", mode: "append", entries: [{ id: "chat", author: "Someone", text: "SECRET-CHAT", fields: {} }] },
    ]);
    const text = JSON.stringify(buildReplayReview(source));
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("Private player name");
    expect(text).not.toContain("PRIVATE-ROOM");
    expect(text).toContain("Stunned");
  });

  it("projects equipment, statuses, ready/exhausted and Atlas might without calculating combat rules", () => {
    const gear = { ...unit("gear", "Sword", { type: "Gear", attachedToCardId: "a", text: "+2 Might." }), exhausted: false };
    const source = replay([
      snapshot(board({ base: [unit("a", "Unit", { might: 5 }), gear] }, { battlefieldA: [unit("b")] })),
      action([
        { id: "m1", op: "zone_move", cardId: "a", from: { playerId: "us", zone: "base" }, to: { playerId: "us", zone: "battlefieldA", index: -1 } },
        { id: "m2", op: "zone_move", cardId: "gear", from: { playerId: "us", zone: "base" }, to: { playerId: "us", zone: "battlefieldA", index: -1 } },
      ], "move_card"),
      fields("a", { whiteCounter: 9, customLabels: ["Stunned", "Temporary"], exhausted: true }),
      move("b", "battlefieldA", "base", "them"),
    ]);
    const combat = buildReplayReview(source).combats[0];
    expect(combat.before.sides[0].cards[0]).toMatchObject({ name: "Unit", equipment: ["Sword"], might: 7 });
    expect(combat.after.sides[0].cards[0]).toMatchObject({ statuses: ["Stunned", "Temporary"], might: 9, exhausted: true });
    expect(combat.after.sides[0].might).toEqual({ total: 9, unitCount: 1, unknownCount: 0 });
  });

  it("labels snapshot removals as missing from the next position, never destroyed", () => {
    const source = replay([
      snapshot(board({ battlefieldA: [unit("a")] }, { battlefieldA: [unit("b")] })),
      snapshot(board({ battlefieldA: [unit("a")] }, {})),
    ]);
    const index = buildReplayReview(source);
    expect(index.combats[0].incomplete).toBe(true);
    expect(index.combats[0].changes.some((entry) => entry.label === "b left Battlefield A")).toBe(true);
    expect(JSON.stringify(index)).not.toMatch(/destroyed|killed/);
  });

  it("does not infer a scoring swing from an initial or next-game score baseline", () => {
    const source = replay([
      snapshot(board({ base: [unit("a")] }, {}, "in_game", 7, 6)),
      action([{ id: "s1", op: "set_board_fields", playerId: "us", fields: { score: 6 } }]),
      snapshot(board({ base: [unit("a")] }, {}, "in_game", 2, 0)),
    ], { secondGameAt: 2 });
    const index = buildReplayReview(source);
    expect(index.entries.filter((entry) => entry.kind === "score").map((entry) => entry.label)).toEqual(["Score updated"]);
    expect(index.moments.some((entry) => entry.kind === "score")).toBe(false);
  });

  it("keeps BO3 games and combat bounds separate, including identical timestamps", () => {
    const source = replay([
      snapshot(board({ base: [unit("first-only")] }, { battlefieldA: [unit("b")] })),
      move("first-only", "base", "battlefieldA"),
      snapshot(board({ base: [unit("second-only")] }, { battlefieldB: [unit("c")] })),
      move("second-only", "base", "battlefieldB"),
    ], { secondGameAt: 2, times: [0, 1000, 1000, 1000] });
    const index = buildReplayReview(source);
    expect(index.combats.map((combat) => [combat.gameId, combat.startEventIndex, combat.endEventIndex])).toEqual([["g1", 1, 1], ["g2", 3, 3]]);
    expect(searchReplayReview(index, "first-only", "g2")).toEqual([]);
    expect(searchReplayReview(index, "second-only", "g2").length).toBeGreaterThan(0);
    expect(buildReplayReview(source)).toEqual(index);
  });

  it("marks capture end without a confirmed result and missing opening honestly", () => {
    const source = replay([
      snapshot(board({ base: [unit("a")] })),
      { kind: "game_boundary", boundary: "end", gameOrdinal: 1, gameNumber: 1, reason: "capture_end" },
    ]);
    const index = buildReplayReview(source);
    expect(index.games[0].partial).toBe(true);
    expect(index.moments.map((moment) => moment.label)).toEqual(["First recorded position", "Recording ends"]);
    expect(index.moments.at(-1)?.summary).toContain("No confirmed game result");
  });

  it("supports TCGA board snapshots without inventing Atlas might or precise unrecorded actions", () => {
    const source = replay([
      snapshot(board({ hand: [unit("a", "TCGA unit")] }, { battlefieldB: [unit("b")] })),
      snapshot(board({ battlefieldA: [unit("a", "TCGA unit")] }, { battlefieldB: [unit("b")] })),
      snapshot(board({ battlefieldA: [unit("a", "TCGA unit")] }, {})),
    ], { tcga: true });
    const index = buildReplayReview(source);
    expect(searchReplayReview(index, "tcga unit", undefined, "play")).toHaveLength(1);
    expect(searchReplayReview(index, "tcga unit", undefined, "play")[0].summary).toContain("between recorded boards");
    expect(index.combats).toHaveLength(1);
    expect(index.combats[0].before.sides[0].might).toBeUndefined();
    expect(index.combats[0].before.sides[0].cards[0].might).toBeUndefined();
  });

  it("does not call an unknown hidden occupant or equipment-only lane a supported combat", () => {
    const source = replay([
      snapshot(board({ battlefieldA: [unit("a")] }, { base: [{ ...unit("h", "Hidden"), isPlaceholder: true }], battlefieldA: [unit("gear", "Gear", { type: "Gear" })] })),
      move("h", "base", "battlefieldA", "them"),
    ]);
    expect(buildReplayReview(source).combats).toEqual([]);
  });

  it("treats a turn boundary with both sides still present as a bounded incomplete contest", () => {
    const source = replay([
      snapshot(board({ base: [unit("a")] }, { battlefieldA: [unit("b")] })),
      move("a", "base", "battlefieldA"),
      action([{ id: "turn", op: "set_room_fields", fields: { turnNumber: 2, activeTurnPlayerId: "them" } }], "end_turn"),
    ]);
    const index = buildReplayReview(source);
    expect(index.combats[0]).toMatchObject({ endEventIndex: 2, incomplete: true });
    expect(searchReplayReview(index, "turn 2", undefined, "turn")).toHaveLength(1);
  });

  it("returns an empty safe index for absent data and leaves source events untouched", () => {
    const empty = replay([]);
    const source = replay([snapshot(board({ hand: [unit("a")] }, {}, "mulligan")), move("a", "hand", "base")]);
    const original = JSON.stringify(source);
    buildReplayReview(source);
    expect(JSON.stringify(source)).toBe(original);
    expect(buildReplayReview(empty).entries).toEqual([]);
    expect(buildReplayReview(empty).moments).toEqual([]);
  });

  it("supports case/punctuation-insensitive token search and exact game/kind filters", () => {
    const source = replay([snapshot(board({ hand: [unit("a", "Kai’Sa, Survivor")] })), move("a", "hand", "base")]);
    const index = buildReplayReview(source);
    expect(searchReplayReview(index, "KAISA survivor", "g1", "play")).toHaveLength(1);
    expect(searchReplayReview(index, "KAISA survivor", "g2", "play")).toHaveLength(0);
    expect(searchReplayReview(index, "KAISA survivor", "g1", "score")).toHaveLength(0);
  });

  it("maps TCGA owner-relative lanes so two home battlefields are not a combat", () => {
    const source = replay([
      snapshot(board({ battlefieldA: [unit("a")] }, { battlefieldA: [unit("b")] })),
      move("b", "battlefieldA", "battlefieldB", "them"),
      move("b", "battlefieldB", "base", "them"),
    ], { tcga: true });
    const index = buildReplayReview(source);
    expect(index.combats).toHaveLength(1);
    expect(index.combats[0]).toMatchObject({ startEventIndex: 1, endEventIndex: 2 });
    expect(index.combats[0].before.sides.map((side) => side.cards.map((card) => card.name))).toEqual([["a"], ["b"]]);
    expect(index.combats[0].changes.some((entry) => entry.label === "b: Battlefield A → Base")).toBe(true);
  });

  it("includes visible chain cards and recorded resolution in search and the active combat", () => {
    const source = replay([
      snapshot(board({ base: [unit("a")] }, { battlefieldA: [unit("b")] })),
      move("a", "base", "battlefieldA"),
      action([{ id: "add", op: "chain_insert", index: 0, entries: [{ id: "spell", fields: { card: { id: "spell", name: "Visible Spell", type: "Spell", ownerPlayerId: "them", token: "PRIVATE-TOKEN" }, arbitrary: "PRIVATE-CHAIN-TEXT" } }] }], "chain_add"),
      action([{ id: "remove", op: "chain_remove", entryIds: ["spell"] }], "chain_resolve"),
      move("b", "battlefieldA", "trash", "them"),
    ]);
    const index = buildReplayReview(source);
    expect(searchReplayReview(index, "visible spell", "g1", "play")).toHaveLength(1);
    expect(index.combats[0].changes.filter((entry) => entry.cardNames.includes("Visible Spell")).map((entry) => entry.label)).toEqual(["Visible Spell added to chain", "Chain resolved: Visible Spell"]);
    expect(JSON.stringify(index)).not.toContain("PRIVATE-");
  });

  it("indexes battlefield conquest without claiming an uncontested conquest was a fight", () => {
    const position = board({ battlefieldA: [unit("a")] });
    position.players.us.boardFields.selectedBattlefield = { id: "bf", name: "Grove of the God-Willow", type: "Battlefield" };
    position.room.fields.pendingBattlefieldConquerAssist = { zone: "battlefieldA", attackerPlayerId: "us" };
    const source = replay([snapshot(position), action([{ id: "clear", op: "unset_room_fields", fields: ["pendingBattlefieldConquerAssist"] }], "battlefield_conquer_confirm")]);
    const index = buildReplayReview(source);
    expect(searchReplayReview(index, "Grove control").map((entry) => entry.label)).toEqual(["Grove of the God-Willow: conquest confirmed"]);
    expect(index.combats).toEqual([]);
  });

  it("records counter clears as well as updates", () => {
    const source = replay([
      snapshot(board({ base: [unit("a", "Unit", { whiteCounter: 5, redCounter: 2 })] })),
      action([{ id: "unset", op: "unset_card_fields", playerId: "us", zone: "base", cardId: "a", fields: ["whiteCounter", "redCounter"] }]),
    ]);
    expect(searchReplayReview(buildReplayReview(source), "counter cleared")[0].label).toBe("Unit: might counter cleared; red counter cleared");
  });

  it("prefers the real opening hand over earlier battlefield setup cards", () => {
    const source = replay([
      snapshot(board({ legend: [unit("legend")] }, {}, "battlefield_pick")),
      snapshot(board({ legend: [unit("legend")], hand: [unit("hand", "Opening plan")] }, {}, "mulligan")),
      move("hand", "hand", "base"),
    ]);
    const index = buildReplayReview(source);
    expect(index.moments.find((moment) => moment.kind === "opening")).toMatchObject({ label: "Opening hand", eventIndex: 1, cardNames: ["Opening plan"] });
    expect(index.entries.filter((entry) => entry.kind === "opening")).toHaveLength(1);
  });

  it("puts the opening hand before the recorded mulligan submission in the walkthrough", () => {
    const source = replay([
      snapshot(board({ legend: [unit("legend")] }, {}, "mulligan")),
      snapshot(board({ hand: [unit("a")] }, {}, "mulligan")),
      action([], "submit_mulligan"),
    ]);
    const index = buildReplayReview(source);
    expect(index.moments.slice(0, 2).map((entry) => [entry.label, entry.eventIndex])).toEqual([["Opening hand", 1], ["Mulligan submitted", 2]]);
  });

  it("does not use a rewind restoring a higher score as a positive scoring moment", () => {
    const source = replay([
      snapshot(board({ base: [unit("a")] }, {}, "in_game", 2, 1)),
      action([{ id: "restore", op: "set_board_fields", playerId: "us", fields: { score: 3 } }], "rewind"),
    ]);
    const index = buildReplayReview(source);
    expect(index.entries.find((entry) => entry.kind === "score")?.label).toBe("Score updated");
    expect(index.moments.some((entry) => entry.kind === "score")).toBe(false);
  });

  it("does not treat a known gameplay-hidden unit as contesting until it becomes active", () => {
    const source = replay([
      snapshot(board({ battlefieldA: [unit("a", "Known hidden unit", { hidden: true })] }, { battlefieldA: [unit("b")] })),
      fields("a", { hidden: false }),
    ]);
    const index = buildReplayReview(source);
    expect(index.combats).toHaveLength(1);
    expect(index.combats[0].startEventIndex).toBe(1);
  });

  it("uses explicitly revealed or consented hands while preserving unknown placeholders", () => {
    const source = replay([snapshot(board({ hand: [unit("a")] }, { hand: [unit("known", "Consented hand"), unit("public", "Public hand", { revealedToOpponent: true }), { ...unit("unknown", "Still secret"), isPlaceholder: true }] }, "mulligan"))]);
    const ordinary = buildReplayReview(source);
    expect(searchReplayReview(ordinary, "Consented hand")).toEqual([]);
    expect(searchReplayReview(ordinary, "Public hand").length).toBeGreaterThan(0);
    source.collaboration = { schema: "riftlite-dual-perspective", version: 1, mode: "dual-perspective", sourceReplayIds: ["a", "b"], sourceCanonicalSha256s: ["a", "b"], perspectivePlayerIds: ["us", "them"], informationPolicy: "consented_full_information", confidence: "exact", diagnostics: { primarySourceReplayId: "a", pairedSnapshotEvents: 1, pairedActionEvents: 0, unpairedPrimaryEvents: 0, unpairedSecondaryEvents: 0, enrichedCards: 1, enrichedFields: 1, coveragePercent: 100, warningCodes: [] } };
    const combined = buildReplayReview(source);
    expect(searchReplayReview(combined, "Consented hand").length).toBeGreaterThan(0);
    expect(searchReplayReview(combined, "Still secret")).toEqual([]);
  });

  it("anchors normalized BO3 results after same-time terminal phases and authoritative result patches", () => {
    const source = normalizeRawCaptureV1(syntheticBo3Capture());
    const index = buildReplayReview(source);
    for (const game of source.series.games) {
      const boundary = source.events.find((event) => event.gameId === game.id && event.kind === "game_boundary" && event.boundary === "end");
      const end = index.moments.find((moment) => moment.gameId === game.id && moment.kind === "end");
      expect(end?.eventIndex).toBe(boundary?.index);
      const terminalPhase = source.events.find((event) => event.gameId === game.id && event.kind === "phase" && event.phase === "game_end");
      if (terminalPhase) expect(end!.eventIndex).toBeGreaterThan(terminalPhase.index);
    }
  });

  it("keeps the last combat open through an early terminal phase and includes the final board patch", () => {
    const source = replay([
      snapshot(board({ base: [unit("a")] }, { battlefieldA: [unit("b")] })),
      move("a", "base", "battlefieldA"),
      { kind: "phase", phase: "game_end", rawPhase: "game_end", gameNumber: 1 },
      action([{ id: "remove", op: "zone_remove", playerId: "them", zone: "battlefieldA", cardIds: ["b"] }, { id: "score", op: "set_board_fields", playerId: "us", fields: { score: 8 } }], "game_result"),
      { kind: "game_boundary", boundary: "end", gameOrdinal: 1, gameNumber: 1, reason: "explicit_result" },
    ], { result: true, times: [0, 1000, 2000, 2000, 2000] });
    const index = buildReplayReview(source);
    expect(index.combats[0]).toMatchObject({ startEventIndex: 1, endEventIndex: 3 });
    expect(index.combats[0].after.sides[1].cards).toEqual([]);
    expect(index.combats[0].changes.some((entry) => entry.eventIndex === 3 && entry.kind === "score")).toBe(true);
    expect(index.moments.at(-1)).toMatchObject({ kind: "end", eventIndex: 4 });
  });
});
