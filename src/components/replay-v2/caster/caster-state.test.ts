import { describe, expect, it } from "vitest";

import type {
  CanonicalReplayV2,
  ReplayCardState,
  ReplayState,
} from "@/lib/replay-v2";

import {
  casterSpoilerSafeState,
  casterSpotlightCardAtState,
} from "./caster-state";

describe("caster spoiler-safe projection", () => {
  it("leaves a normal single-perspective replay unchanged", () => {
    const replay = replayFixture();
    const state = stateFixture();
    expect(casterSpoilerSafeState(replay, state)).toBe(state);
    expect(state.players.opponent.zones.hand[0]?.name).toBe("Known by the capture");
  });

  it("masks only the opponent hand in a consented full-information replay", () => {
    const replay = {
      ...replayFixture(),
      collaboration: {
        schema: "riftlite-dual-perspective",
        mode: "dual-perspective",
        informationPolicy: "consented_full_information",
      },
    } as CanonicalReplayV2;
    const state = stateFixture();
    const masked = casterSpoilerSafeState(replay, state);

    expect(masked).not.toBe(state);
    expect(masked.players.self.zones.hand[0]).toMatchObject({
      id: "self-card",
      name: "Capture hand",
      isPlaceholder: false,
    });
    expect(masked.players.opponent.zones.hand[0]).toMatchObject({
      id: "opponent-card",
      name: "",
      isPlaceholder: true,
      fields: { casterSpoilerMask: true },
    });
    expect(masked.players.opponent.zones.base[0]?.name).toBe("Public unit");
    expect(state.players.opponent.zones.hand[0]?.name).toBe("Known by the capture");
  });

  it("re-resolves a pinned card so rewinding cannot retain future identity", () => {
    const futureCard = card(
      "opponent-card",
      "Future reveal",
      "opponent",
      "battlefield",
    );
    const rewoundState = stateFixture();
    rewoundState.players.opponent.zones.hand = [{
      ...futureCard,
      name: "",
      cardCode: undefined,
      isPlaceholder: true,
      source: "hand",
      fields: { ownerPlayerId: "opponent", source: "hand", isPlaceholder: true },
    }];

    expect(casterSpotlightCardAtState(rewoundState, futureCard)).toMatchObject({
      id: "opponent-card",
      name: "",
      isPlaceholder: true,
    });

    rewoundState.players.opponent.zones.hand = [];
    expect(casterSpotlightCardAtState(rewoundState, futureCard)).toBeNull();
  });
});

function replayFixture(): CanonicalReplayV2 {
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: "caster-replay",
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: "capture",
      roomCode: "ROOM",
      startedAt: 1,
      endedAt: 2,
      messageCount: 0,
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
        { id: "self", name: "BMU", isPerspective: true, fields: {} },
        { id: "opponent", name: "Opponent", isPerspective: false, fields: {} },
      ],
      games: [],
    },
    events: [],
    unknownEvents: [],
    diagnostics: [],
    checkpoints: [],
  };
}

function stateFixture(): ReplayState {
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
      activeTurnPlayerId: "self",
      fields: {},
    },
    players: {
      self: player("self", "BMU", {
        hand: [card("self-card", "Capture hand", "self", "hand")],
        base: [],
      }),
      opponent: player("opponent", "Opponent", {
        hand: [card("opponent-card", "Known by the capture", "opponent", "hand")],
        base: [card("public-unit", "Public unit", "opponent", "base")],
      }),
    },
    chain: [],
    log: [],
    chat: [],
    appliedEventIndex: 0,
  };
}

function player(
  id: string,
  name: string,
  zones: Record<string, ReplayCardState[]>,
) {
  return { id, name, score: 0, fields: {}, boardFields: {}, zones };
}

function card(
  id: string,
  name: string,
  ownerPlayerId: string,
  source: string,
): ReplayCardState {
  return {
    id,
    name,
    cardCode: "OGN-001",
    ownerPlayerId,
    source,
    exhausted: false,
    isPlaceholder: false,
    fields: { name, cardCode: "OGN-001", ownerPlayerId, source },
  };
}
