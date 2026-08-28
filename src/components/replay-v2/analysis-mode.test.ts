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
  applyReplayAnalysisOperation,
  createReplayAnalysisSession,
  redoReplayAnalysisOperation,
  replayAnalysisCanAddChainTarget,
  replayAnalysisCanAddToChain,
  replayAnalysisCanAttach,
  replayAnalysisCanMove,
  replayAnalysisChainTargetIds,
  replayAnalysisChangedCardCount,
  resetReplayAnalysisSession,
  revealFutureKnownHandCards,
  undoReplayAnalysisOperation,
} from "./analysis-mode";

describe("replay analysis mode", () => {
  it("reveals only card instances that were already in hand at the anchor", () => {
    const state = analysisState([
      hiddenCard("anchor-known"),
      hiddenCard("anchor-unknown"),
    ]);
    const replay = analysisReplay([
      markerEvent(0),
      actionEvent(1, [{
        id: "play-anchor-known",
        op: "zone_move",
        cardId: "anchor-known",
        from: { playerId: "opponent", zone: "hand" },
        to: { playerId: "opponent", zone: "base", index: 0 },
        card: publicCard("anchor-known", "Hidden Blade", "TST-101"),
      }]),
      actionEvent(2, [{
        id: "draw-later",
        op: "zone_insert",
        playerId: "opponent",
        zone: "hand",
        index: 1,
        cards: [hiddenCard("later-draw")],
      }]),
      actionEvent(3, [{
        id: "play-later",
        op: "zone_move",
        cardId: "later-draw",
        from: { playerId: "opponent", zone: "hand" },
        to: { playerId: "opponent", zone: "base", index: 1 },
        card: publicCard("later-draw", "Fresh Draw", "TST-102"),
      }]),
    ]);

    const result = revealFutureKnownHandCards(replay, 0, state);

    expect(result.inferredCardIds).toEqual(["anchor-known"]);
    expect(result.state.players.opponent.zones.hand[0]).toMatchObject({
      cardCode: "TST-101",
      id: "anchor-known",
      isPlaceholder: false,
      name: "Hidden Blade",
      fields: { analysisKnowledge: "future_reveal" },
    });
    expect(result.state.players.opponent.zones.hand[1]).toMatchObject({
      id: "anchor-unknown",
      isPlaceholder: true,
    });
  });

  it("does not use a face-down battlefield identity as public hand evidence", () => {
    const hidden = hiddenCard("face-down-later");
    const concealed = opponentPublicCard(
      hidden.id,
      "Black Rose Dignitary",
      "UNL-152",
    );
    concealed.fields.hidden = true;
    const state = analysisState([hidden]);
    const replay = analysisReplay([
      markerEvent(0),
      actionEvent(1, [{
        id: "play-face-down",
        op: "zone_move",
        cardId: hidden.id,
        from: { playerId: "opponent", zone: "hand" },
        to: { playerId: "opponent", zone: "battlefieldA", index: 0 },
        card: concealed,
      }], "move_card"),
    ]);

    const result = revealFutureKnownHandCards(replay, 0, state);

    expect(result.inferredCardIds).toEqual([]);
    expect(result.state.players.opponent.zones.hand[0]).toMatchObject({
      id: hidden.id,
      isPlaceholder: true,
    });
  });

  it("does not reveal an ID that disappears before being reused publicly", () => {
    const state = analysisState([hiddenCard("reused-id")]);
    const withoutCard = analysisState([]);
    const replay = analysisReplay([
      markerEvent(0),
      snapshotEvent(1, withoutCard),
      actionEvent(2, [{
        id: "reused-insert",
        op: "zone_insert",
        playerId: "opponent",
        zone: "base",
        index: 0,
        cards: [publicCard("reused-id", "Different Instance", "TST-999")],
      }]),
    ]);

    const result = revealFutureKnownHandCards(replay, 0, state);

    expect(result.inferredCardIds).toEqual([]);
    expect(result.state.players.opponent.zones.hand[0]).toMatchObject({
      id: "reused-id",
      isPlaceholder: true,
    });
  });

  it("follows stable TCGA card instances through temporary projection gaps", () => {
    const cardId = "tcga_card_1234567890abcdef";
    const state = analysisState([hiddenCard(cardId)]);
    const withoutCard = analysisState([]);
    const publicTcgaCard = {
      ...publicCard(cardId, "Perfect Execution", "OGN-099"),
      ownerPlayerId: "opponent",
    };
    const replay = analysisReplay([
      markerEvent(0),
      snapshotEvent(1, withoutCard),
      actionEvent(2, [{
        id: "tcga-public-insert",
        op: "zone_insert",
        playerId: "opponent",
        zone: "discard",
        index: 0,
        cards: [publicTcgaCard],
      }]),
    ]);

    const result = revealFutureKnownHandCards(replay, 0, state);

    expect(result.inferredCardIds).toEqual([cardId]);
    expect(result.state.players.opponent.zones.hand[0]).toMatchObject({
      cardCode: "OGN-099",
      isPlaceholder: false,
      name: "Perfect Execution",
    });
  });

  it("reveals a guaranteed Atlas hand departure when a played card becomes public", () => {
    const firstHidden = hiddenCard("__hidden_zone__:opponent:hand:0");
    const secondHidden = hiddenCard("__hidden_zone__:opponent:hand:1");
    const revealed = opponentPublicCard("card_atlas_1", "Irresistible Faefolk", "UNL-112");
    const state = analysisState([firstHidden, secondHidden]);
    const replay = analysisReplay([
      markerEvent(0),
      actionEvent(1, [{
        id: "remove-anonymous-card",
        op: "zone_remove",
        playerId: "opponent",
        zone: "hand",
        cardIds: [secondHidden.id],
      }, {
        id: "insert-public-card",
        op: "zone_insert",
        playerId: "opponent",
        zone: "base",
        index: 0,
        cards: [revealed],
      }], "move_card"),
    ]);

    const result = revealFutureKnownHandCards(replay, 0, state);

    expect(result.inferredCardIds).toHaveLength(1);
    expect(result.state.players.opponent.zones.hand).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cardCode: "UNL-112",
        isPlaceholder: false,
        name: "Irresistible Faefolk",
        fields: expect.objectContaining({ analysisKnowledge: "future_reveal" }),
      }),
      expect.objectContaining({ isPlaceholder: true }),
    ]));
  });

  it("reveals a guaranteed Atlas hand departure that becomes public on the chain", () => {
    const hidden = hiddenCard("__hidden_zone__:opponent:hand:0");
    const state = analysisState([hidden]);
    const replay = analysisReplay([
      markerEvent(0),
      actionEvent(1, [{
        id: "insert-chain-card",
        op: "chain_insert",
        index: 0,
        entries: [{
          id: "chain-entry",
          fields: {
            byPlayerId: "opponent",
            card: {
              id: "chain-card",
              name: "Stacked Deck",
              cardCode: "OGN-183",
              ownerPlayerId: "opponent",
              source: "mainDeck",
              isPlaceholder: false,
            },
            fromZone: "hand",
          },
        }],
      }, {
        id: "remove-chain-card-from-hand",
        op: "zone_remove",
        playerId: "opponent",
        zone: "hand",
        cardIds: [hidden.id],
      }], "chain_add"),
    ]);

    const result = revealFutureKnownHandCards(replay, 0, state);

    expect(result.inferredCardIds).toEqual([hidden.id]);
    expect(result.state.players.opponent.zones.hand[0]).toMatchObject({
      cardCode: "OGN-183",
      isPlaceholder: false,
      name: "Stacked Deck",
    });
  });

  it("keeps Atlas cards hidden when a later draw makes the departing card ambiguous", () => {
    const firstHidden = hiddenCard("__hidden_zone__:opponent:hand:0");
    const secondHidden = hiddenCard("__hidden_zone__:opponent:hand:1");
    const laterDraw = hiddenCard("__hidden_zone__:opponent:hand:2");
    const revealed = opponentPublicCard("card_atlas_2", "Fresh Draw", "TST-102");
    const state = analysisState([firstHidden, secondHidden]);
    const replay = analysisReplay([
      markerEvent(0),
      actionEvent(1, [{
        id: "draw-anonymous-card",
        op: "zone_insert",
        playerId: "opponent",
        zone: "hand",
        index: 2,
        cards: [laterDraw],
      }], "draw_card"),
      actionEvent(2, [{
        id: "remove-ambiguous-card",
        op: "zone_remove",
        playerId: "opponent",
        zone: "hand",
        cardIds: [laterDraw.id],
      }, {
        id: "insert-ambiguous-public-card",
        op: "zone_insert",
        playerId: "opponent",
        zone: "base",
        index: 0,
        cards: [revealed],
      }], "move_card"),
    ]);

    const result = revealFutureKnownHandCards(replay, 0, state);

    expect(result.inferredCardIds).toEqual([]);
    expect(result.state.players.opponent.zones.hand).toEqual([
      expect.objectContaining({ id: firstHidden.id, isPlaceholder: true }),
      expect.objectContaining({ id: secondHidden.id, isPlaceholder: true }),
    ]);
  });

  it("keeps Atlas positions aligned after a later draw is played first", () => {
    const firstHidden = hiddenCard("__hidden_zone__:opponent:hand:0");
    const secondHidden = hiddenCard("__hidden_zone__:opponent:hand:1");
    const laterDraw = hiddenCard("__hidden_zone__:opponent:hand:2");
    const drawnCard = opponentPublicCard("card_atlas_drawn", "Fresh Draw", "TST-102");
    const anchorCard = opponentPublicCard("card_atlas_anchor", "Stacked Deck", "OGN-183");
    const state = analysisState([firstHidden, secondHidden]);
    const replay = analysisReplay([
      markerEvent(0),
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
        cards: [drawnCard],
      }], "move_card"),
      actionEvent(3, [{
        id: "play-anchor-card",
        op: "zone_remove",
        playerId: "opponent",
        zone: "hand",
        cardIds: [secondHidden.id],
      }, {
        id: "show-anchor-card",
        op: "zone_insert",
        playerId: "opponent",
        zone: "base",
        index: 1,
        cards: [anchorCard],
      }], "move_card"),
    ]);

    const result = revealFutureKnownHandCards(replay, 0, state);

    expect(result.inferredCardIds).toEqual([secondHidden.id]);
    expect(result.state.players.opponent.zones.hand).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstHidden.id, isPlaceholder: true }),
      expect.objectContaining({
        cardCode: "OGN-183",
        id: secondHidden.id,
        isPlaceholder: false,
        name: "Stacked Deck",
      }),
    ]));
  });

  it("does not carry Atlas positional identities across a replacement snapshot", () => {
    const hidden = hiddenCard("__hidden_zone__:opponent:hand:0");
    const replacement = analysisState([
      hiddenCard("__hidden_zone__:opponent:hand:0"),
    ]);
    const revealed = opponentPublicCard("card_after_snapshot", "Replacement Card", "TST-777");
    const state = analysisState([hidden]);
    const replay = analysisReplay([
      markerEvent(0),
      snapshotEvent(1, replacement),
      actionEvent(2, [{
        id: "remove-replacement-card",
        op: "zone_remove",
        playerId: "opponent",
        zone: "hand",
        cardIds: [hidden.id],
      }, {
        id: "show-replacement-card",
        op: "zone_insert",
        playerId: "opponent",
        zone: "base",
        index: 0,
        cards: [revealed],
      }], "move_card"),
    ]);

    const result = revealFutureKnownHandCards(replay, 0, state);

    expect(result.inferredCardIds).toEqual([]);
    expect(result.state.players.opponent.zones.hand[0]).toMatchObject({
      id: hidden.id,
      isPlaceholder: true,
    });
  });

  it("uses combined open-hand information directly without creating inferences", () => {
    const state = analysisState([publicCard("already-known", "Open Card", "TST-001")]);
    const replay = analysisReplay([markerEvent(0)]);

    const session = createReplayAnalysisSession(replay, 0, state);

    expect(session.inferredCardIds).toEqual([]);
    expect(session.state.players.opponent.zones.hand[0]).toMatchObject({
      id: "already-known",
      name: "Open Card",
    });
  });

  it("applies temporary board changes and restores the previous branch state", () => {
    const state = analysisState([], [publicCard("unit", "Test Unit", "TST-010")]);
    const session = createReplayAnalysisSession(analysisReplay([markerEvent(0)]), 0, state);
    const moved = applyReplayAnalysisOperation(session, {
      kind: "move_card",
      cardId: "unit",
      zone: "battlefieldA",
    });
    const exhausted = applyReplayAnalysisOperation(moved, {
      kind: "toggle_exhausted",
      cardId: "unit",
    });
    const countered = applyReplayAnalysisOperation(exhausted, {
      kind: "adjust_counter",
      cardId: "unit",
      field: "whiteCounter",
      delta: 2,
    });

    expect(countered.state.players.self.zones.battlefieldA[0]).toMatchObject({
      exhausted: true,
      fields: {
        analysisStatus: "what_if",
        whiteCounter: 2,
      },
    });
    expect(replayAnalysisChangedCardCount(countered.state)).toBe(1);

    const undone = undoReplayAnalysisOperation(countered);
    expect(undone.state.players.self.zones.battlefieldA[0]).toMatchObject({
      exhausted: true,
      fields: { analysisStatus: "what_if" },
    });
    expect(undone.state.players.self.zones.battlefieldA[0].fields.whiteCounter).toBeUndefined();
    expect(state.players.self.zones.base[0]).toMatchObject({
      exhausted: false,
      id: "unit",
    });

    const redone = redoReplayAnalysisOperation(undone);
    expect(redone.state.players.self.zones.battlefieldA[0].fields.whiteCounter).toBe(2);
    expect(redone.future).toHaveLength(0);
  });

  it("attaches a card to a target in the target zone and adjusts scores locally", () => {
    const attachment = publicCard("gear", "Test Gear", "TST-020");
    const host = publicCard("host", "Test Host", "TST-021");
    const state = analysisState([], [attachment, host]);
    let session = createReplayAnalysisSession(analysisReplay([markerEvent(0)]), 0, state);
    session = applyReplayAnalysisOperation(session, {
      kind: "attach_card",
      cardId: "gear",
      targetCardId: "host",
    });
    session = applyReplayAnalysisOperation(session, {
      kind: "adjust_score",
      playerId: "self",
      delta: 1,
    });

    expect(session.state.players.self.zones.base).toHaveLength(2);
    expect(session.state.players.self.zones.base.find((card) => card.id === "gear")?.fields)
      .toMatchObject({
        analysisStatus: "what_if",
        attachedToCardId: "host",
      });
    expect(session.state.players.self.score).toBe(1);
    expect(session.state.players.self.boardFields.analysisScoreChanged).toBe(true);
  });

  it("moves a host together with its attachments and keeps the relationship intact", () => {
    const host = publicCard("host", "Test Host", "TST-030");
    const attachment = publicCard("gear", "Test Gear", "TST-031");
    attachment.fields.attachedToCardId = host.id;
    const state = analysisState([], [attachment, host]);
    const session = createReplayAnalysisSession(analysisReplay([markerEvent(0)]), 0, state);

    const moved = applyReplayAnalysisOperation(session, {
      kind: "move_card",
      cardId: host.id,
      playerId: "self",
      zone: "battlefieldB",
    });

    expect(moved.state.players.self.zones.base).toEqual([]);
    expect(moved.state.players.self.zones.battlefieldB.map((card) => card.id))
      .toEqual(["host", "gear"]);
    expect(moved.state.players.self.zones.battlefieldB[1].fields).toMatchObject({
      analysisStatus: "what_if",
      attachedToCardId: "host",
      source: "battlefieldB",
    });
  });

  it("adds a card to the temporary chain and can return it to its source zone", () => {
    const action = publicCard("action", "Test Action", "TST-035");
    const firstTarget = publicCard("target-one", "First Target", "TST-036");
    const secondTarget = publicCard("target-two", "Second Target", "TST-037");
    action.source = "hand";
    action.fields.source = "hand";
    const state = analysisState([], [firstTarget, secondTarget]);
    state.players.self.zones.hand = [action];
    let session = createReplayAnalysisSession(analysisReplay([markerEvent(0)]), 0, state);

    expect(replayAnalysisCanAddToChain(session.state, action.id)).toBe(true);
    session = applyReplayAnalysisOperation(session, {
      kind: "add_to_chain",
      cardId: action.id,
    });

    expect(session.state.players.self.zones.hand).toEqual([]);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      fields: {
        analysisPlayerId: "self",
        analysisSourceIndex: 0,
          analysisSourceZone: "hand",
          analysisStatus: "what_if",
          sourceCardId: "action",
          card: {
          id: "action",
          name: "Test Action",
          source: "chain",
          fields: { analysisStatus: "what_if", source: "chain" },
        },
      },
    });
    expect(replayAnalysisChangedCardCount(session.state)).toBe(1);

    const entryId = session.state.chain[0].id;
    expect(replayAnalysisCanAddChainTarget(session.state, entryId, action.id)).toBe(false);
    expect(replayAnalysisCanAddChainTarget(session.state, entryId, firstTarget.id)).toBe(true);
    session = applyReplayAnalysisOperation(session, {
      kind: "add_chain_target",
      entryId,
      targetCardId: firstTarget.id,
    });
    session = applyReplayAnalysisOperation(session, {
      kind: "add_chain_target",
      entryId,
      targetCardId: secondTarget.id,
    });
    expect(replayAnalysisChainTargetIds(session.state, entryId))
      .toEqual([firstTarget.id, secondTarget.id]);
    expect(session.state.chain[0].fields).toMatchObject({
      analysisTargetCardIds: [firstTarget.id, secondTarget.id],
      sourceCardId: action.id,
    });

    const duplicate = applyReplayAnalysisOperation(session, {
      kind: "add_chain_target",
      entryId,
      targetCardId: firstTarget.id,
    });
    expect(duplicate).toBe(session);

    const targetUndone = undoReplayAnalysisOperation(session);
    expect(replayAnalysisChainTargetIds(targetUndone.state, entryId)).toEqual([firstTarget.id]);
    session = redoReplayAnalysisOperation(targetUndone);
    expect(replayAnalysisChainTargetIds(session.state, entryId))
      .toEqual([firstTarget.id, secondTarget.id]);

    session = applyReplayAnalysisOperation(session, {
      kind: "clear_chain_targets",
      entryId,
    });
    expect(replayAnalysisChainTargetIds(session.state, entryId)).toEqual([]);
    session = undoReplayAnalysisOperation(session);
    expect(replayAnalysisChainTargetIds(session.state, entryId))
      .toEqual([firstTarget.id, secondTarget.id]);

    session = applyReplayAnalysisOperation(session, {
      kind: "remove_from_chain",
      entryId,
    });
    expect(session.state.chain).toEqual([]);
    expect(session.state.players.self.zones.hand[0]).toMatchObject({
      id: action.id,
      source: "hand",
      fields: { analysisStatus: "what_if", source: "hand" },
    });

    const undone = undoReplayAnalysisOperation(session);
    expect(undone.state.chain[0].id).toBe(entryId);
    const reset = resetReplayAnalysisSession(undone);
    expect(reset.state.chain).toEqual([]);
    expect(reset.state.players.self.zones.hand[0].fields.analysisStatus).toBeUndefined();
  });

  it("does not place a host on the chain while attachments depend on it", () => {
    const host = publicCard("host", "Test Host", "TST-036");
    const attachment = publicCard("gear", "Test Gear", "TST-037");
    attachment.fields.attachedToCardId = host.id;
    const state = analysisState([], [attachment, host]);
    const session = createReplayAnalysisSession(analysisReplay([markerEvent(0)]), 0, state);

    expect(replayAnalysisCanAddToChain(session.state, host.id)).toBe(false);
    expect(applyReplayAnalysisOperation(session, {
      kind: "add_to_chain",
      cardId: host.id,
    })).toBe(session);
  });

  it("rejects invalid moves and cross-player or cyclic attachments", () => {
    const source = publicCard("source", "Source", "TST-040");
    const host = publicCard("host", "Host", "TST-041");
    const opponentHost = {
      ...publicCard("opponent-host", "Opponent Host", "TST-042"),
      ownerPlayerId: "opponent",
      fields: {
        ...publicCard("opponent-host", "Opponent Host", "TST-042").fields,
        ownerPlayerId: "opponent",
      },
    };
    const state = analysisState([], [source, host]);
    state.players.opponent.zones.base.push(opponentHost);
    host.fields.attachedToCardId = source.id;
    const session = createReplayAnalysisSession(analysisReplay([markerEvent(0)]), 0, state);

    expect(replayAnalysisCanMove(session.state, source.id, "opponent", "hand")).toBe(false);
    expect(replayAnalysisCanMove(session.state, source.id, "self", "base")).toBe(false);
    expect(replayAnalysisCanMove(session.state, source.id, "self", "nowhere")).toBe(false);
    expect(replayAnalysisCanAttach(session.state, source.id, opponentHost.id)).toBe(false);
    expect(replayAnalysisCanAttach(session.state, source.id, host.id)).toBe(false);

    const invalidMove = applyReplayAnalysisOperation(session, {
      kind: "move_card",
      cardId: source.id,
      playerId: "opponent",
      zone: "hand",
    });
    expect(invalidMove).toBe(session);
  });

  it("detaches cards, restores individual cards, resets the branch, and clears redo on a new line", () => {
    const attachment = publicCard("gear", "Test Gear", "TST-050");
    const host = publicCard("host", "Test Host", "TST-051");
    attachment.fields.attachedToCardId = host.id;
    const state = analysisState([], [attachment, host]);
    let session = createReplayAnalysisSession(analysisReplay([markerEvent(0)]), 0, state);
    session = applyReplayAnalysisOperation(session, { kind: "detach_card", cardId: attachment.id });
    expect(session.state.players.self.zones.base[0].fields.attachedToCardId).toBeUndefined();

    session = applyReplayAnalysisOperation(session, {
      kind: "move_card",
      cardId: attachment.id,
      zone: "banished",
    });
    expect(session.state.players.self.zones.banished[0].id).toBe(attachment.id);

    session = applyReplayAnalysisOperation(session, {
      kind: "restore_card",
      cardId: attachment.id,
    });
    expect(session.state.players.self.zones.base[0]).toMatchObject({
      id: attachment.id,
      fields: { attachedToCardId: host.id },
    });
    expect(session.state.players.self.zones.base[0].fields.analysisStatus).toBeUndefined();

    const undone = undoReplayAnalysisOperation(session);
    expect(undone.future).toHaveLength(1);
    const alternate = applyReplayAnalysisOperation(undone, {
      kind: "adjust_score",
      playerId: "self",
      delta: 1,
    });
    expect(alternate.future).toHaveLength(0);

    const reset = resetReplayAnalysisSession(alternate);
    expect(reset.history).toEqual([]);
    expect(reset.future).toEqual([]);
    expect(reset.state.players.self.zones.base[0].fields.attachedToCardId).toBe(host.id);
    expect(reset.state.players.self.score).toBe(0);
  });
});

function analysisReplay(events: ReplayEvent[]): CanonicalReplayV2 {
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: "analysis-replay",
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: "capture",
      roomCode: "ROOM",
      startedAt: 1,
      endedAt: 2,
      messageCount: events.length,
    },
    series: {
      id: "series",
      perspectivePlayerId: "self",
      format: "bo1",
      bestOf: 1,
      roomCode: "ROOM",
      startedAt: 1,
      endedAt: 2,
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
        endedAt: 2,
        startedAtMs: 0,
        endedAtMs: 10_000,
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

function analysisState(
  opponentHand: ReplayCardState[],
  selfBase: ReplayCardState[] = [],
): ReplayState {
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
        zones: { base: selfBase, hand: [] },
      },
      opponent: {
        id: "opponent",
        name: "Opponent",
        score: 0,
        fields: {},
        boardFields: {},
        zones: { base: [], hand: opponentHand },
      },
    },
    chain: [],
    log: [],
    chat: [],
    appliedEventIndex: 0,
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

function publicCard(id: string, name: string, cardCode: string): ReplayCardState {
  return {
    id,
    name,
    cardCode,
    ownerPlayerId: id.startsWith("anchor") || id.startsWith("later") || id === "reused-id"
      ? "opponent"
      : "self",
    source: "base",
    exhausted: false,
    isPlaceholder: false,
    fields: {
      name,
      cardCode,
      source: "base",
      isPlaceholder: false,
    },
  };
}

function opponentPublicCard(id: string, name: string, cardCode: string): ReplayCardState {
  const card = publicCard(id, name, cardCode);
  card.ownerPlayerId = "opponent";
  card.fields.ownerPlayerId = "opponent";
  return card;
}

function markerEvent(index: number): ReplayEvent {
  return {
    id: `phase-${index}`,
    index,
    at: index + 1,
    atMs: index * 1_000,
    sourceMessageId: `message-${index}`,
    gameId: "game-1",
    kind: "phase",
    phase: "in_game",
    rawPhase: "in_game",
    gameNumber: 1,
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
