import { describe, expect, it } from "vitest";

import {
  projectReplayState,
  type CanonicalReplayV2,
  type ReplayActionEvent,
  type ReplayCardState,
  type ReplayPatchOperation,
} from "@/lib/replay-v2";

import { buildDeckPeekPresentation } from "./deck-peek";

describe("deck peek replay presentation", () => {
  it("stages cumulative candidates and preserves them after a card is chosen", () => {
    const replay = deckPeekReplay();
    const inspecting = buildDeckPeekPresentation(replay, projectReplayState(replay, 2), 2);

    expect(inspecting?.phase).toBe("inspect");
    expect(inspecting?.cards.map(({ card }) => card.name)).toEqual(["Fizz", "Seal", "Hidden Blade"]);
    expect(inspecting?.cards.map(({ appearedAtEventIndex }) => appearedAtEventIndex)).toEqual([0, 1, 2]);

    const chosen = buildDeckPeekPresentation(replay, projectReplayState(replay, 3), 3);
    expect(chosen?.phase).toBe("choose");
    expect(chosen?.currentCardId).toBe("seal");
    expect(chosen?.currentDestination).toBe("Hand");
    expect(chosen?.key).toBe(inspecting?.key);
    expect(chosen?.cards).toHaveLength(3);
    expect(chosen?.cards.find(({ card }) => card.id === "seal")).toMatchObject({
      destination: "Hand",
      movedAtEventIndex: 3,
    });
  });

  it("marks explicit reveals and the remaining cards returning to the deck", () => {
    const replay = deckPeekReplay();
    const revealed = buildDeckPeekPresentation(replay, projectReplayState(replay, 4), 4);

    expect(revealed?.phase).toBe("reveal");
    expect(revealed?.cards.find(({ card }) => card.id === "fizz")?.revealed).toBe(true);

    const cleared = buildDeckPeekPresentation(replay, projectReplayState(replay, 5), 5);
    expect(cleared?.phase).toBe("return");
    expect(cleared?.cards.find(({ card }) => card.id === "seal")?.returnedAtEventIndex).toBeUndefined();
    expect(cleared?.cards.filter(({ returnedAtEventIndex }) => returnedAtEventIndex === 5).map(({ card }) => card.id)).toEqual([
      "fizz",
      "blade",
    ]);
  });

  it("never turns a privacy-normalized opponent candidate into a visible card", () => {
    const replay = deckPeekReplay();
    const presentation = buildDeckPeekPresentation(replay, projectReplayState(replay, 6), 6);

    expect(presentation?.playerId).toBe("opponent");
    expect(presentation?.cards).toHaveLength(1);
    expect(presentation?.cards[0].card).toMatchObject({
      id: "opponent-hidden",
      isPlaceholder: true,
      name: "",
    });
  });
});

function deckPeekReplay(): CanonicalReplayV2 {
  const events: ReplayActionEvent[] = [
    actionEvent(0, "peek_deck_top", "self", [
      deckPeekFields("self", ["fizz"]),
      insertCard("self", card("fizz", "Fizz", "OGN-028")),
    ]),
    actionEvent(1, "peek_deck_top", "self", [
      deckPeekFields("self", ["fizz", "seal"]),
      insertCard("self", card("seal", "Seal", "OGN-153")),
    ]),
    actionEvent(2, "peek_deck_top", "self", [
      deckPeekFields("self", ["fizz", "seal", "blade"]),
      insertCard("self", card("blade", "Hidden Blade", "OGN-194")),
    ]),
    actionEvent(3, "take_card_from_deck", "self", [
      deckPeekFields("self", ["fizz", "blade"]),
      {
        id: "op-move-seal",
        op: "zone_move",
        cardId: "seal",
        from: { playerId: "self", zone: "deck" },
        to: { playerId: "self", zone: "hand", index: 0 },
        card: card("seal", "Seal", "OGN-153"),
      },
    ], { cardId: "seal", to: "hand" }),
    actionEvent(4, "set_deck_peek_card_reveal", "self", [
      {
        ...deckPeekFields("self", ["fizz", "blade"]),
        fields: { deckPeek: { revision: 7, cardIds: ["fizz", "blade"], revealedCardIds: ["fizz"] } },
      },
    ], { cardId: "fizz" }),
    actionEvent(5, "clear_deck_peek", "self", [
      {
        ...deckPeekFields("self", []),
        fields: { deckPeek: { revision: 7, cardIds: [], revealedCardIds: [] } },
      },
    ]),
    actionEvent(6, "peek_deck_top", "opponent", [
      {
        id: "op-opponent-peek-fields",
        op: "set_board_fields",
        playerId: "opponent",
        fields: { deckPeek: { revision: 2, cardIds: ["opponent-hidden"], revealedCardIds: [] } },
      },
      insertCard("opponent", {
        id: "opponent-hidden",
        name: "",
        ownerPlayerId: "opponent",
        isPlaceholder: true,
        fields: {},
      }),
    ]),
  ];

  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: "deck-peek-test",
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: "capture-test",
      roomCode: "room-test",
      startedAt: 1,
      endedAt: 8,
      messageCount: events.length,
    },
    series: {
      id: "series-test",
      perspectivePlayerId: "self",
      format: "bo1",
      bestOf: 1,
      roomCode: "room-test",
      startedAt: 1,
      endedAt: 8,
      participants: [
        { id: "self", name: "Kennen", isPerspective: true, fields: {} },
        { id: "opponent", name: "Nasus", isPerspective: false, fields: {} },
      ],
      games: [],
    },
    events,
    unknownEvents: [],
    diagnostics: [],
    checkpoints: [],
  };
}

function actionEvent(
  index: number,
  actionType: string,
  actorPlayerId: string,
  operations: ReplayActionEvent["patch"]["operations"],
  action: ReplayActionEvent["action"] = {},
): ReplayActionEvent {
  return {
    id: `event-${index}`,
    index,
    at: index + 1,
    atMs: index * 1_000,
    sourceMessageId: `message-${index}`,
    gameId: "game-1",
    kind: "action",
    actionType,
    actorPlayerId,
    action,
    confirmation: {
      status: "confirmed",
      authority: "authoritative_patch_commit",
      correlation: "matched_intent",
      commitMessageId: `commit-${index}`,
    },
    patch: { operations },
  };
}

function deckPeekFields(
  playerId: string,
  cardIds: string[],
): Extract<ReplayPatchOperation, { op: "set_board_fields" }> {
  return {
    id: `op-fields-${playerId}-${cardIds.length}`,
    op: "set_board_fields",
    playerId,
    fields: { deckPeek: { revision: 7, cardIds, revealedCardIds: [] } },
  };
}

function insertCard(
  playerId: string,
  replayCard: ReplayCardState,
): Extract<ReplayPatchOperation, { op: "zone_insert" }> {
  return {
    id: `op-insert-${replayCard.id}`,
    op: "zone_insert",
    playerId,
    zone: "deck",
    index: 0,
    cards: [replayCard],
  };
}

function card(id: string, name: string, cardCode: string): ReplayCardState {
  return { id, name, cardCode, ownerPlayerId: "self", source: "deck_peek", fields: {} };
}
