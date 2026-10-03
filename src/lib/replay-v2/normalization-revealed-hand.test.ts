import { describe, expect, it } from "vitest";

import { normalizePatchOperations } from "@/lib/replay-v2/normalization";
import { normalizeRawCaptureV1 } from "@/lib/replay-v2/normalize-replay";
import { parseRawCaptureV1 } from "@/lib/replay-v2/parse-raw-capture";
import { projectReplayState } from "@/lib/replay-v2/project-state";
import { seekReplayByEventIndex } from "@/lib/replay-v2/seek";
import type { CanonicalReplayV2, RawCaptureV1 } from "@/lib/replay-v2/types";

const LOCAL = "player-local";
const OPPONENT = "player-opponent";

describe("explicit Atlas opponent hand reveals", () => {
  it("keeps the seven revealed cards from the reveal event onward, while a later draw stays hidden", () => {
    const hidden = Array.from({ length: 7 }, (_, index) => hiddenCard(`hidden-${index}`));
    const shown = hidden.map((_, index) => revealedCard(`revealed-${index}`, `Revealed card ${index}`));
    const replay = normalizeRawCaptureV1(capture({ hand: hidden }, [
      commit([
        { op: "zone_remove", playerId: OPPONENT, zone: "hand", cardIds: hidden.map((card) => card.id) },
        ...shown.map((card, index) => insert("hand", card, index)),
      ]),
      commit([insert("hand", fullCard("new-draw", "Unrevealed draw"), 7)], "draw_cards"),
    ]), { checkpoints: { everyEvents: 1 } });
    const [reveal, draw] = actions(replay);

    expect(handAt(replay, reveal.index - 1).every((card) => card.isPlaceholder && !card.name)).toBe(true);
    expect(handAt(replay, reveal.index).map((card) => card.name)).toEqual(shown.map((card) => card.name));
    expect(handAt(replay, draw.index)).toHaveLength(8);
    expect(handAt(replay, draw.index)[7]).toMatchObject({ name: "", isPlaceholder: true });
    expect(JSON.stringify(replay)).not.toContain("Unrevealed draw");
    for (const index of [draw.index, reveal.index - 1, reveal.index]) {
      expect(seekReplayByEventIndex(replay, index).state).toEqual(projectReplayState(replay, index));
    }
  });

  it("preserves explicitly revealed snapshot hand cards without opening any other hidden zone", () => {
    const replay = normalizeRawCaptureV1(capture({
      hand: [revealedCard("shown", "Shown hand"), fullCard("hidden", "Hidden hand")],
      deck: [revealedCard("deck", "Hidden deck")],
      runeDeck: [revealedCard("runes", "Hidden rune deck")],
      sideboard: [revealedCard("sideboard", "Hidden sideboard")],
    }));
    expect(handAt(replay)[0]).toMatchObject({ name: "Shown hand", cardCode: "TST-001", isPlaceholder: false });
    for (const secret of ["Hidden hand", "Hidden deck", "Hidden rune deck", "Hidden sideboard"]) {
      expect(JSON.stringify(replay)).not.toContain(secret);
    }
  });

  it.each([false, "true", 1, null, undefined])("does not accept a non-boolean reveal flag (%s)", (flag) => {
    const replay = normalizeRawCaptureV1(capture({ hand: [{ ...fullCard("card", "Still hidden"), revealedToOpponent: flag }] }));
    expect(handAt(replay)[0]).toMatchObject({ name: "", isPlaceholder: true });
    expect(JSON.stringify(replay)).not.toContain("Still hidden");
  });

  it("does not turn a flagged placeholder into a revealed card", () => {
    const replay = normalizeRawCaptureV1(capture({ hand: [{ ...revealedCard("card", "Placeholder secret"), isPlaceholder: true }] }));
    expect(JSON.stringify(replay)).not.toContain("Placeholder secret");
    expect(handAt(replay)[0].isPlaceholder).toBe(true);
  });

  it("accepts a revealed hand move but still conceals moves into a deck or an unrevealed hand", () => {
    const replay = normalizeRawCaptureV1(capture({ base: [fullCard("card", "Public card")] }, [
      commit([move("card", "base", "hand", revealedCard("card", "Public card"))]),
      commit([move("card", "hand", "deck", revealedCard("card", "Private deck identity"))]),
      commit([move("card", "deck", "hand", fullCard("card", "Private hand identity"))]),
    ]));
    const [reveal, deck, hidden] = actions(replay);
    expect(handAt(replay, reveal.index)[0]).toMatchObject({ name: "Public card", isPlaceholder: false });
    expect(projectReplayState(replay, deck.index).players[OPPONENT].zones.deck[0]).toMatchObject({ name: "", isPlaceholder: true });
    expect(handAt(replay, hidden.index)[0]).toMatchObject({ name: "", isPlaceholder: true });
    expect(JSON.stringify(replay)).not.toContain("Private deck identity");
    expect(JSON.stringify(replay)).not.toContain("Private hand identity");
  });

  it("updates canonical card identity when a field patch reveals a placeholder", () => {
    const replay = normalizeRawCaptureV1(capture({ hand: [hiddenCard("card")] }, [
      commit([cardPatch({ revealedToOpponent: true, cardName: "Alias card", code: "TST-002", imageUrl: "/shown.png" })]),
      commit([cardPatch({ exhausted: true, name: "Unflagged replacement secret" })], "toggle_exhausted"),
    ]));
    const [reveal, unrelated] = actions(replay);
    expect(handAt(replay, reveal.index)[0]).toMatchObject({ name: "Alias card", cardCode: "TST-002", isPlaceholder: false });
    expect(handAt(replay, unrelated.index)[0]).toMatchObject({ name: "Alias card", cardCode: "TST-002", isPlaceholder: false, exhausted: true });
    expect(JSON.stringify(replay)).not.toContain("Unflagged replacement secret");
  });

  it("does not carry a revealed identity into a hidden zone when a move omits its card payload", () => {
    const replay = normalizeRawCaptureV1(capture({ hand: [revealedCard("card", "Known hand card")] }, [
      commit([{ op: "zone_move", cardId: "card", from: { playerId: OPPONENT, zone: "hand" }, to: { playerId: OPPONENT, zone: "hand", index: 0 } }]),
      commit([{ op: "zone_move", cardId: "card", from: { playerId: OPPONENT, zone: "hand" }, to: { playerId: OPPONENT, zone: "deck", index: 0 } }]),
    ]));
    expect(handAt(replay, actions(replay)[0].index)[0].name).toBe("Known hand card");
    const deckCard = projectReplayState(replay).players[OPPONENT].zones.deck[0];
    expect(deckCard).toMatchObject({ id: "card", name: "", isPlaceholder: true });
    expect(deckCard.cardCode).toBeUndefined();
    expect(deckCard.fields).not.toHaveProperty("revealedToOpponent");
  });

  it("does not invent a name when a reveal patch supplies only the flag", () => {
    const replay = normalizeRawCaptureV1(capture({ hand: [hiddenCard("card")] }, [commit([cardPatch({ revealedToOpponent: true })])]));
    expect(handAt(replay)[0]).toMatchObject({ name: "", isPlaceholder: true });
  });

  it.each([
    { op: "patch_card_fields", playerId: OPPONENT, zone: "hand", cardId: "card", fields: { revealedToOpponent: false } },
    { op: "patch_card_fields", playerId: OPPONENT, zone: "hand", cardId: "card", fields: { isPlaceholder: true } },
    { op: "unset_card_fields", playerId: OPPONENT, zone: "hand", cardId: "card", fields: ["revealedToOpponent", "exhausted"] },
  ])("clears all previous identity fields when a revealed card is concealed: $op $fields", (conceal) => {
    const replay = normalizeRawCaptureV1(capture({ hand: [{ ...revealedCard("card", "Previously shown"), imageUrl: "/previous-art.png", cardName: "Previous alias" }] }, [commit([conceal])]), {
      checkpoints: { everyEvents: 1 },
    });
    const before = actions(replay)[0].index - 1;
    expect(handAt(replay, before)[0].name).toBe("Previously shown");
    const after = handAt(replay)[0];
    expect(after).toMatchObject({ name: "", isPlaceholder: true });
    expect(after.cardCode).toBeUndefined();
    expect(after.fields).not.toHaveProperty("imageUrl");
    expect(after.fields).not.toHaveProperty("cardName");
    expect(after.fields).not.toHaveProperty("revealedToOpponent");
    expect(JSON.stringify(after)).not.toContain("Previously shown");
    expect(seekReplayByEventIndex(replay, replay.events.length - 1).state).toEqual(projectReplayState(replay));
  });

  it("does not conceal the capture player's own hand when their reveal flag is cleared", () => {
    const raw = capture({}, [commit([{ op: "patch_card_fields", playerId: LOCAL, zone: "hand", cardId: "own-card", fields: { revealedToOpponent: false } }])]);
    const snapshot = raw.messages[1].parsed as { snapshot: { players: Array<{ id: string; board: Record<string, unknown> }> } };
    snapshot.snapshot.players[0].board.hand = [{ ...revealedCard("own-card", "Own hand"), ownerPlayerId: LOCAL }];
    const replay = normalizeRawCaptureV1(raw);
    expect(projectReplayState(replay).players[LOCAL].zones.hand[0]).toMatchObject({ name: "Own hand", isPlaceholder: false });
  });

  it("fails closed when the capture perspective is unknown, including explicitly marked reveals", () => {
    const raw = capture({ hand: [revealedCard("snapshot", "Unknown viewer snapshot")] }, [commit([insert("hand", revealedCard("insert", "Unknown viewer insert"))])]);
    raw.messages[0].parsed = { type: "room_shell_sync", sessionDoc: { phase: "in_game", gameNumber: 1 } };
    const replay = normalizeRawCaptureV1(raw);
    expect(replay.series.perspectivePlayerId).toBeFalsy();
    expect(JSON.stringify(replay)).not.toContain("Unknown viewer snapshot");
    expect(JSON.stringify(replay)).not.toContain("Unknown viewer insert");
  });

  it.each(["out", "unknown"])("does not trust revealed identities from %s snapshots or commits", (direction) => {
    const raw = capture({ hand: [revealedCard("snapshot", "Non-authoritative snapshot")] }, [commit([insert("hand", revealedCard("insert", "Non-authoritative insert"))])]);
    raw.messages[1].dir = direction;
    raw.messages[2].dir = direction;
    const replay = normalizeRawCaptureV1(raw);
    expect(JSON.stringify(replay)).not.toContain("Non-authoritative snapshot");
    expect(JSON.stringify(replay)).not.toContain("Non-authoritative insert");
  });

  it("does not accept reveal identities from non-authoritative packet normalization", () => {
    const raw = capture({}, [commit([insert("hand", revealedCard("insert", "Unconfirmed reveal"))])]);
    const packet = parseRawCaptureV1(raw).packets.at(-1)!;
    packet.packetType = "action_intent";
    const normalized = normalizePatchOperations(packet, LOCAL);
    expect(JSON.stringify(normalized)).not.toContain("Unconfirmed reveal");
  });
});

function fullCard(id: string, name: string) {
  return { id, name, cardCode: "TST-001", ownerPlayerId: OPPONENT, source: "mainDeck", isPlaceholder: false };
}

function revealedCard(id: string, name: string) {
  return { ...fullCard(id, name), revealedToOpponent: true };
}

function hiddenCard(id: string) {
  return { id, name: "", ownerPlayerId: OPPONENT, isPlaceholder: true };
}

function insert(zone: string, card: Record<string, unknown>, index = 0) {
  return { op: "zone_insert", playerId: OPPONENT, zone, index, cards: [card] };
}

function move(cardId: string, from: string, to: string, card: Record<string, unknown>) {
  return { op: "zone_move", cardId, from: { playerId: OPPONENT, zone: from }, to: { playerId: OPPONENT, zone: to, index: 0 }, card };
}

function cardPatch(fields: Record<string, unknown>) {
  return { op: "patch_card_fields", playerId: OPPONENT, zone: "hand", cardId: "card", fields };
}

function commit(operations: Record<string, unknown>[], actionType = "set_hand_reveal") {
  return { type: "authoritative_patch_commit", gameNumber: 1, action: { type: actionType }, patch: { operations } };
}

function capture(opponentBoard: Record<string, unknown>, packets: Record<string, unknown>[] = []): RawCaptureV1 {
  return {
    schema: "riftreplay-raw-capture",
    version: 1,
    capture: { captureSessionId: "synthetic-hand-reveal" },
    messages: [
      { type: "room_shell_sync", sessionDoc: { phase: "in_game", gameNumber: 1, matchFormat: "bo1", viewer: { playerId: LOCAL } } },
      { type: "authoritative_snapshot", snapshot: { phase: "in_game", gameNumber: 1, players: [
        { id: LOCAL, name: "Local", board: { hand: [] } },
        { id: OPPONENT, name: "Opponent", board: opponentBoard },
      ] } },
      ...packets,
    ].map((parsed, index) => ({ seq: index, ts: 1_000_000 + index * 1_000, dir: "in", parsed })),
  };
}

function actions(replay: CanonicalReplayV2) {
  return replay.events.filter((event) => event.kind === "action");
}

function handAt(replay: CanonicalReplayV2, eventIndex = replay.events.length - 1) {
  return projectReplayState(replay, eventIndex).players[OPPONENT].zones.hand;
}
