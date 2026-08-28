import { describe, expect, it } from "vitest";

import type {
  CanonicalReplayV2,
  ReplayActionEvent,
  ReplayCardState,
  ReplayEvent,
  ReplaySnapshotEvent,
  ReplayState,
} from "@/lib/replay-v2";

import {
  createReplayCardsUpProjectionCache,
  projectReplayCardsUp,
} from "./cards-up";

describe("replay Cards up projection", () => {
  it("keeps a publicly revealed card known when it returns to hand", () => {
    const returned = publicCard("returned-card", "Hidden Blade", "OGN-101");
    const replay = replayFromEvents([
      snapshotEvent(0, replayState({ base: [returned], hand: [] })),
      actionEvent(1, [{
        id: "return-to-hand",
        op: "zone_move",
        cardId: returned.id,
        from: { playerId: "opponent", zone: "base" },
        to: { playerId: "opponent", zone: "hand", index: 0 },
      }], "return_card"),
    ]);

    const projected = projectReplayCardsUp(createReplayCardsUpProjectionCache(replay), 1);

    expect(projected.knownCardIds).toEqual([returned.id]);
    expect(projected.state.players.opponent.zones.hand[0]).toMatchObject({
      id: returned.id,
      cardCode: "OGN-101",
      isPlaceholder: false,
      name: "Hidden Blade",
      fields: { analysisKnowledge: "previous_reveal" },
    });
  });

  it("does not expose exact private hand data without public evidence", () => {
    const secret = publicCard("server-secret", "Private Knowledge", "SEC-001", "hand");
    const replay = replayFromEvents([
      snapshotEvent(0, replayState({ base: [], hand: [secret] })),
    ]);

    const projected = projectReplayCardsUp(createReplayCardsUpProjectionCache(replay), 0);

    expect(projected.knownCardIds).toEqual([]);
    expect(projected.state.players.opponent.zones.hand[0]).toMatchObject({
      id: secret.id,
      cardCode: "SEC-001",
      name: "Private Knowledge",
    });
    expect(projected.state.players.opponent.zones.hand[0].fields.analysisKnowledge).toBeUndefined();
  });

  it("forgets a revealed identity after it enters a randomized deck", () => {
    const shuffled = publicCard("shuffled-card", "Hidden Blade", "OGN-101");
    const replay = replayFromEvents([
      snapshotEvent(0, replayState({ base: [shuffled], hand: [] })),
      actionEvent(1, [
        {
          id: "shuffle-into-deck",
          op: "zone_move",
          cardId: shuffled.id,
          from: { playerId: "opponent", zone: "base" },
          to: { playerId: "opponent", zone: "deck", index: 0 },
        },
        {
          id: "draw-after-shuffle",
          op: "zone_move",
          cardId: shuffled.id,
          from: { playerId: "opponent", zone: "deck" },
          to: { playerId: "opponent", zone: "hand", index: 0 },
        },
      ], "shuffle_and_draw"),
    ]);

    const projected = projectReplayCardsUp(createReplayCardsUpProjectionCache(replay), 1);

    expect(projected.knownCardIds).toEqual([]);
    expect(projected.state.players.opponent.zones.hand[0].fields.analysisKnowledge).toBeUndefined();
  });

  it("does not treat a later face-down battlefield card as public evidence", () => {
    const concealed = publicCard("concealed-card", "Black Rose Dignitary", "UNL-152");
    concealed.fields.hidden = true;
    const replay = replayFromEvents([
      snapshotEvent(0, replayState({ base: [], hand: [hiddenCard(concealed.id)] })),
      actionEvent(1, [{
        id: "play-concealed-card",
        op: "zone_move",
        cardId: concealed.id,
        from: { playerId: "opponent", zone: "hand" },
        to: { playerId: "opponent", zone: "battlefieldA", index: 0 },
        card: concealed,
      }], "move_card"),
    ]);

    const projected = projectReplayCardsUp(createReplayCardsUpProjectionCache(replay), 0);

    expect(projected.knownCardIds).toEqual([]);
    expect(projected.state.players.opponent.zones.hand[0]).toMatchObject({
      id: concealed.id,
      isPlaceholder: true,
    });
  });

  it("reveals card identity without back-propagating later board state", () => {
    const hidden = hiddenCard("known-later");
    hidden.fields.anchorOnly = "kept";
    const revealed = publicCard(hidden.id, "Stupefy", "OGN-212");
    revealed.exhausted = true;
    revealed.fields = {
      ...revealed.fields,
      customLabels: ["Silenced"],
      exhausted: true,
      redCounter: 3,
    };
    const replay = replayFromEvents([
      snapshotEvent(0, replayState({ base: [], hand: [hidden] })),
      actionEvent(1, [{
        id: "play-known-card",
        op: "zone_move",
        cardId: hidden.id,
        from: { playerId: "opponent", zone: "hand" },
        to: { playerId: "opponent", zone: "base", index: 0 },
        card: revealed,
      }], "move_card"),
    ]);

    const projected = projectReplayCardsUp(createReplayCardsUpProjectionCache(replay), 0);
    const card = projected.state.players.opponent.zones.hand[0];

    expect(card).toMatchObject({
      cardCode: "OGN-212",
      exhausted: false,
      name: "Stupefy",
      fields: expect.objectContaining({
        analysisKnowledge: "future_reveal",
        anchorOnly: "kept",
        exhausted: false,
      }),
    });
    expect(card.fields.customLabels).toBeUndefined();
    expect(card.fields.redCounter).toBeUndefined();
  });

  it("tracks anonymous Atlas cards safely across draws and positional shifts", () => {
    const first = hiddenCard("__hidden_zone__:opponent:hand:0");
    const second = hiddenCard("__hidden_zone__:opponent:hand:1");
    const laterDraw = hiddenCard("__hidden_zone__:opponent:hand:2");
    const replay = replayFromEvents([
      snapshotEvent(0, replayState({ base: [], hand: [first, second] })),
      actionEvent(1, [{
        id: "draw-at-end",
        op: "zone_insert",
        playerId: "opponent",
        zone: "hand",
        index: 2,
        cards: [laterDraw],
      }], "draw_card"),
      actionEvent(2, [{
        id: "play-later-draw",
        op: "zone_remove",
        playerId: "opponent",
        zone: "hand",
        cardIds: [laterDraw.id],
      }, {
        id: "show-later-draw",
        op: "zone_insert",
        playerId: "opponent",
        zone: "base",
        index: 0,
        cards: [publicCard("atlas-draw", "Fresh Draw", "TST-102")],
      }], "move_card"),
      actionEvent(3, [{
        id: "play-anchor-card",
        op: "zone_remove",
        playerId: "opponent",
        zone: "hand",
        cardIds: [second.id],
      }, {
        id: "show-anchor-card",
        op: "zone_insert",
        playerId: "opponent",
        zone: "base",
        index: 1,
        cards: [publicCard("atlas-anchor", "Stacked Deck", "OGN-183")],
      }], "move_card"),
    ]);
    const cache = createReplayCardsUpProjectionCache(replay);

    const opening = projectReplayCardsUp(cache, 0);
    expect(opening.knownCardIds).toEqual([second.id]);
    expect(opening.state.players.opponent.zones.hand).toEqual([
      expect.objectContaining({ id: first.id, isPlaceholder: true }),
      expect.objectContaining({
        id: second.id,
        name: "Stacked Deck",
        fields: expect.objectContaining({ analysisKnowledge: "future_reveal" }),
      }),
    ]);

    const afterDraw = projectReplayCardsUp(cache, 1);
    expect(afterDraw.state.players.opponent.zones.hand).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: second.id, name: "Stacked Deck" }),
      expect.objectContaining({ id: laterDraw.id, name: "Fresh Draw" }),
    ]));
  });

  it("keeps sequential anonymous Atlas departures paired with public evidence order", () => {
    const first = hiddenCard("__hidden_zone__:opponent:hand:0");
    const second = hiddenCard("__hidden_zone__:opponent:hand:1");
    const firstPublic = publicCard("atlas-first", "First Reveal", "TST-201");
    const secondPublic = publicCard("atlas-second", "Second Reveal", "TST-202");
    const replay = replayFromEvents([
      snapshotEvent(0, replayState({ base: [], hand: [first, second] })),
      actionEvent(1, [
        {
          id: "play-first",
          op: "zone_move",
          cardId: first.id,
          from: { playerId: "opponent", zone: "hand" },
          to: { playerId: "opponent", zone: "base", index: 0 },
          card: firstPublic,
        },
        {
          id: "play-next-position-zero",
          op: "zone_move",
          cardId: first.id,
          from: { playerId: "opponent", zone: "hand" },
          to: { playerId: "opponent", zone: "base", index: 1 },
          card: secondPublic,
        },
      ], "move_card"),
    ]);

    const opening = projectReplayCardsUp(createReplayCardsUpProjectionCache(replay), 0);

    expect(opening.state.players.opponent.zones.hand).toEqual([
      expect.objectContaining({ id: first.id, name: "First Reveal" }),
      expect.objectContaining({ id: second.id, name: "Second Reveal" }),
    ]);
  });

  it("builds future evidence once and reuses it throughout playback", () => {
    const knownLater = hiddenCard("known-later");
    const replay = replayFromEvents([
      snapshotEvent(0, replayState({ base: [], hand: [knownLater, hiddenCard("still-hidden")] })),
      actionEvent(1, [{ id: "turn", op: "set_room_fields", fields: { turnNumber: 4 } }]),
      actionEvent(2, [{
        id: "score",
        op: "set_board_fields",
        playerId: "self",
        fields: { score: 1 },
      }]),
      actionEvent(3, [{ id: "phase-detail", op: "set_room_fields", fields: { priority: "opponent" } }]),
      actionEvent(4, [{
        id: "play-known-card",
        op: "zone_move",
        cardId: knownLater.id,
        from: { playerId: "opponent", zone: "hand" },
        to: { playerId: "opponent", zone: "base", index: 0 },
        card: publicCard(knownLater.id, "Stupefy", "OGN-212"),
      }], "move_card"),
    ]);
    const cache = createReplayCardsUpProjectionCache(replay);
    const futureHistory = cache.futureHistory;

    expect(projectReplayCardsUp(cache, 0).knownCardIds).toEqual([knownLater.id]);
    projectReplayCardsUp(cache, 1);
    projectReplayCardsUp(cache, 2);
    projectReplayCardsUp(cache, 3);
    expect(cache.futureHistory).toBe(futureHistory);

    projectReplayCardsUp(cache, 4);
    expect(cache.futureHistory).toBe(futureHistory);
  });

  it("keeps display-only reveals out of the incremental canonical state", () => {
    const knownLater = hiddenCard("known-later");
    const replay = replayFromEvents([
      snapshotEvent(0, replayState({ base: [], hand: [knownLater] })),
      actionEvent(1, [{ id: "wait", op: "set_room_fields", fields: { turnNumber: 2 } }]),
      actionEvent(2, [{
        id: "play-known-card",
        op: "zone_move",
        cardId: knownLater.id,
        from: { playerId: "opponent", zone: "hand" },
        to: { playerId: "opponent", zone: "base", index: 0 },
        card: publicCard(knownLater.id, "Stupefy", "OGN-212"),
      }], "move_card"),
    ]);
    const cache = createReplayCardsUpProjectionCache(replay);

    const displayed = projectReplayCardsUp(cache, 0);
    expect(displayed.state.players.opponent.zones.hand[0]).toMatchObject({
      isPlaceholder: false,
      name: "Stupefy",
      fields: expect.objectContaining({ analysisKnowledge: "future_reveal" }),
    });
    expect(cache.lastState?.players.opponent.zones.hand[0]).toMatchObject({
      id: knownLater.id,
      isPlaceholder: true,
      name: "",
    });
    expect(
      cache.lastState?.players.opponent.zones.hand[0].fields.analysisKnowledge,
    ).toBeUndefined();

    projectReplayCardsUp(cache, 1);
    expect(cache.lastState?.players.opponent.zones.hand[0]).toMatchObject({
      isPlaceholder: true,
      name: "",
    });
  });
});

function replayFromEvents(events: ReplayEvent[]): CanonicalReplayV2 {
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: "cards-up-replay",
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: "capture",
      roomCode: "ROOM",
      startedAt: 1,
      endedAt: events.length,
      messageCount: events.length,
    },
    series: {
      id: "series",
      perspectivePlayerId: "self",
      format: "bo1",
      bestOf: 1,
      roomCode: "ROOM",
      startedAt: 1,
      endedAt: events.length,
      participants: [
        { id: "self", name: "Self", isPerspective: true, fields: {} },
        { id: "opponent", name: "Opponent", isPerspective: false, fields: {} },
      ],
      games: [{
        id: "game-1",
        ordinal: 1,
        gameNumber: 1,
        sourceIdentity: { explicitGameNumber: true, gameInstanceIds: ["game-1"] },
        startedAt: 1,
        endedAt: events.length,
        startedAtMs: 0,
        endedAtMs: Math.max(0, events.length - 1) * 1_000,
        eventStartIndex: 0,
        eventEndIndex: Math.max(0, events.length - 1),
        phases: [],
      }],
    },
    events,
    unknownEvents: [],
    diagnostics: [],
    checkpoints: [],
  };
}

function replayState(opponentZones: { base: ReplayCardState[]; hand: ReplayCardState[] }): ReplayState {
  return {
    seriesId: "series",
    gameId: "game-1",
    gameOrdinal: 1,
    phase: "in_game",
    room: {
      phase: "in_game",
      rawPhase: "in_game",
      gameNumber: 1,
      turnNumber: 3,
      fields: {},
    },
    players: {
      self: {
        id: "self",
        name: "Self",
        score: 0,
        fields: {},
        boardFields: {},
        zones: { base: [], hand: [] },
      },
      opponent: {
        id: "opponent",
        name: "Opponent",
        score: 0,
        fields: {},
        boardFields: {},
        zones: opponentZones,
      },
    },
    chain: [],
    log: [],
    chat: [],
    appliedEventIndex: 0,
  };
}

function publicCard(
  id: string,
  name: string,
  cardCode: string,
  source = "base",
): ReplayCardState {
  return {
    id,
    name,
    cardCode,
    ownerPlayerId: "opponent",
    source,
    isPlaceholder: false,
    fields: {
      name,
      cardCode,
      ownerPlayerId: "opponent",
      source,
      isPlaceholder: false,
    },
  };
}

function hiddenCard(id: string): ReplayCardState {
  return {
    id,
    name: "",
    ownerPlayerId: "opponent",
    source: "hand",
    isPlaceholder: true,
    fields: {
      ownerPlayerId: "opponent",
      source: "hand",
      isPlaceholder: true,
    },
  };
}

function actionEvent(
  index: number,
  operations: ReplayActionEvent["patch"]["operations"],
  actionType = "test",
): ReplayActionEvent {
  return {
    id: `action-${index}`,
    index,
    at: index + 1,
    atMs: index * 1_000,
    sourceMessageId: `message-${index}`,
    gameId: "game-1",
    kind: "action",
    actionType,
    action: { type: actionType },
    confirmation: {
      status: "confirmed",
      authority: "authoritative_patch_commit",
      correlation: "intent_not_observed",
      commitMessageId: `message-${index}`,
    },
    patch: { operations },
  };
}

function snapshotEvent(index: number, state: ReplayState): ReplaySnapshotEvent {
  return {
    id: `snapshot-${index}`,
    index,
    at: index + 1,
    atMs: index * 1_000,
    sourceMessageId: `message-${index}`,
    gameId: "game-1",
    kind: "snapshot",
    snapshot: {
      room: state.room,
      players: state.players,
      chain: state.chain,
      log: state.log,
    },
  };
}
