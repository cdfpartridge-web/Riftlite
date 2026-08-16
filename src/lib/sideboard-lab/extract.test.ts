import { describe, expect, it } from "vitest";

import {
  auditObservedSideboardDecisions,
  extractObservedSideboardDecisions,
  type SideboardLabDeckCard,
} from "@/lib/sideboard-lab/extract";
import type { CanonicalReplayV2, JsonObject, ReplayActionEvent } from "@/lib/replay-v2";

describe("Sideboard Lab strict Atlas extraction", () => {
  it("extracts a confirmed perspective Game 2 swap from exact before/post decks", () => {
    const candidate = extractObservedSideboardDecisions(observedSideboardReplay(), "private-owner")[0];

    expect(candidate).toMatchObject({
      contributorKey: "private-owner",
      observation: {
        provider: "atlas",
        targetGameNumber: 2,
        priorGameWon: true,
        observedOn: "2026-08-12",
      },
      matchup: {
        playerLegend: { cardCode: "UNL-191", name: "Master Yi, Wuju Master" },
        opponentLegend: { cardCode: "VEN-145", name: "Nasus, Curator of the Sands" },
      },
      cardsIn: [{ cardCode: "OGN-014", name: "Sky Splitter", count: 1 }],
      cardsOut: [{ cardCode: "OGN-001", name: "Blazing Scorcher", count: 1 }],
      wonGame: false,
    });
    expect(candidate.deck.mainDeck.reduce((sum, card) => sum + card.count, 0)).toBe(40);
    expect(candidate.submittedDeck.mainDeck.reduce((sum, card) => sum + card.count, 0)).toBe(40);
  });

  it("uses immutable registeredDeck instead of future merged participant deck fields", () => {
    const replay = observedSideboardReplay();
    const self = replay.series.participants.find(({ id }) => id === "self")!;
    self.fields.deck = deckObject(postMain(), postSideboard());
    self.fields.submittedDeck = deckObject(postMain(), postSideboard());

    const candidate = extractObservedSideboardDecisions(replay, "owner")[0];
    expect(candidate.cardsIn.map(({ cardCode }) => cardCode)).toEqual(["OGN-014"]);
    expect(candidate.cardsOut.map(({ cardCode }) => cardCode)).toEqual(["OGN-001"]);
  });

  it("keeps a provider-designated non-Champion in the deck without claiming Chosen Champion provenance", () => {
    const replay = observedSideboardReplay();
    for (const source of [
      replay.series.participants[0]!.fields.registeredDeck,
      sideboardPatchFields(replay).deck,
    ]) {
      const sections = (source as JsonObject).sections as JsonObject;
      const mainDeck = sections.mainDeck as unknown as SideboardLabDeckCard[];
      const designated = mainDeck.find(({ cardCode }) => cardCode === "OGN-016")!;
      sections.mainDeck = mainDeck.filter(({ cardCode }) => cardCode !== "OGN-016");
      sections.champion = [{ ...designated }];
    }

    const candidate = extractObservedSideboardDecisions(replay, "owner")[0];
    expect(candidate).toBeDefined();
    expect(candidate.deck.mainDeck.reduce((sum, card) => sum + card.count, 0)).toBe(40);
    expect(candidate.deck.chosenChampionCode).toBeUndefined();
    expect(candidate.submittedDeck.chosenChampionCode).toBeUndefined();
  });

  it("captures proven Game 2 initiative and otherwise leaves it unknown", () => {
    const unknown = extractObservedSideboardDecisions(observedSideboardReplay(), "owner")[0];
    expect(unknown.observation.nextInitiative).toBe("unknown");

    const replay = observedSideboardReplay();
    sideboardAction(replay).patch.operations.push({
      id: "game-2-first-player",
      op: "set_room_fields",
      fields: { firstPlayerId: "self" },
    });
    expect(extractObservedSideboardDecisions(replay, "owner")[0].observation.nextInitiative)
      .toBe("first");
  });

  it("extracts Game 3 separately from the submitted Game 2 configuration", () => {
    const replay = observedSideboardReplay();
    replay.series.games.push(game("game-3", 3, 3, 6, 8, "self", "opponent"));
    const submitted = deckObject(preMain(), preSideboard());
    replay.events.push(
      boundary("game-3", 6, 3, 3),
      phase("game-3", 7, 3, "sideboarding"),
      {
        ...sideboardAction(replay),
        id: "self-sideboard-game-3",
        index: 8,
        at: Date.UTC(2026, 7, 12, 10, 50),
        atMs: 3_000_000,
        sourceMessageId: "message-sideboard-game-3",
        gameId: "game-3",
        patch: {
          operations: [{
            id: "sideboard-deck-game-3",
            op: "set_player_fields",
            playerId: "self",
            fields: { deck: submitted },
          }],
        },
      },
    );

    const candidates = extractObservedSideboardDecisions(replay, "owner");
    expect(candidates).toHaveLength(2);
    expect(candidates[1]).toMatchObject({
      observation: { targetGameNumber: 3, priorGameWon: false },
      deck: { fingerprint: candidates[0]!.submittedDeck.fingerprint },
      cardsIn: [{ cardCode: "OGN-001", count: 1 }],
      cardsOut: [{ cardCode: "OGN-014", count: 1 }],
      wonGame: true,
    });
  });

  it("deduplicates identical complete patch deck aliases but rejects conflicts", () => {
    const aliases = observedSideboardReplay();
    const action = sideboardAction(aliases);
    const operation = action.patch.operations.find((candidate) => candidate.op === "set_player_fields");
    if (!operation || operation.op !== "set_player_fields") throw new Error("missing deck patch");
    operation.fields.submittedDeck = operation.fields.deck;
    expect(extractObservedSideboardDecisions(aliases, "owner")).toHaveLength(1);

    operation.fields.submittedDeck = deckObject(preMain(), preSideboard());
    expect(extractObservedSideboardDecisions(aliases, "owner")).toEqual([]);
    expect(auditObservedSideboardDecisions(aliases, "owner").rejection).toEqual({
      code: "conflicting_submitted_decks",
      details: { uniqueDeckCount: 2 },
    });
  });

  it("reports stable, non-identifying rejection reasons", () => {
    const duplicate = observedSideboardReplay();
    duplicate.events.push({ ...sideboardAction(duplicate), id: "duplicate", index: 6 });
    duplicate.series.games[1].eventEndIndex = 6;
    expect(auditObservedSideboardDecisions(duplicate, "owner").rejection).toEqual({
      code: "ambiguous_confirmed_sideboard_action",
      details: { actionCount: 2 },
    });

    const partial = observedSideboardReplay();
    sideboardPatchFields(partial).deck = { sections: { sideboard: postSideboard() } };
    expect(auditObservedSideboardDecisions(partial, "owner").rejection).toEqual({
      code: "invalid_submitted_deck",
      details: { sourceCount: 1 },
    });
  });

  it("safely collapses an unlisted Atlas face suffix to its packaged base print", () => {
    const replay = observedSideboardReplay();
    for (const deck of [
      replay.series.participants[0].fields.registeredDeck,
      sideboardPatchFields(replay).deck,
    ]) {
      const sections = (deck as JsonObject).sections as JsonObject;
      const mainDeck = sections.mainDeck as unknown as SideboardLabDeckCard[];
      const card = mainDeck.find(({ cardCode }) => cardCode === "OGN-001")!;
      card.cardCode = "OGN-001B";
      card.name = "Blazing Scorcher";
    }

    const audit = auditObservedSideboardDecisions(replay, "owner");
    expect(audit.rejection).toBeNull();
    expect(audit.candidates[0].deck.mainDeck[0]).toMatchObject({
      cardCode: "OGN-001",
      name: "Blazing Scorcher",
    });

    const registered = replay.series.participants[0].fields.registeredDeck as JsonObject;
    const sections = registered.sections as JsonObject;
    const card = (sections.mainDeck as unknown as SideboardLabDeckCard[])
      .find(({ cardCode }) => cardCode === "OGN-001B")!;
    card.name = "Different card";
    expect(auditObservedSideboardDecisions(replay, "owner").rejection).toEqual({
      code: "invalid_baseline_deck",
      details: { unregisteredCardCode: "OGN-001B" },
    });
  });

  it("accepts exact packaged special codes outside the numbered print format", () => {
    const replay = observedSideboardReplay();
    for (const deck of [
      replay.series.participants[0].fields.registeredDeck,
      sideboardPatchFields(replay).deck,
    ]) {
      const sections = (deck as JsonObject).sections as JsonObject;
      const mainDeck = sections.mainDeck as unknown as SideboardLabDeckCard[];
      const card = mainDeck.find(({ cardCode }) => cardCode === "OGN-016")!;
      card.cardCode = "VEN-SP5";
      card.name = "Ezreal, Prodigy";
    }

    const audit = auditObservedSideboardDecisions(replay, "owner");
    expect(audit.rejection).toBeNull();
    expect(audit.candidates[0].deck.mainDeck).toContainEqual({
      cardCode: "VEN-SP5",
      name: "Ezreal, Prodigy",
      count: 1,
    });
  });

  it("enforces the copy limit by base print across alternate print codes", () => {
    const replay = observedSideboardReplay();
    for (const deck of [
      replay.series.participants[0].fields.registeredDeck,
      sideboardPatchFields(replay).deck,
    ]) {
      const sections = (deck as JsonObject).sections as JsonObject;
      const mainDeck = sections.mainDeck as unknown as SideboardLabDeckCard[];
      mainDeck.find(({ cardCode }) => cardCode === "OGN-001")!.cardCode = "OGN-027A";
      mainDeck.find(({ cardCode }) => cardCode === "OGN-002")!.cardCode = "OGN-027";
    }

    expect(auditObservedSideboardDecisions(replay, "owner").rejection?.code)
      .toBe("invalid_baseline_deck");
  });

  it("rejects TCGA, opponent-only, unconfirmed, partial, and pool-changing captures", () => {
    const tcga = observedSideboardReplay();
    tcga.source.schema = "riftlite-tcga-raw-capture";
    expect(extractObservedSideboardDecisions(tcga, "owner")).toEqual([]);

    const opponentOnly = observedSideboardReplay();
    sideboardAction(opponentOnly).actorPlayerId = "opponent";
    expect(extractObservedSideboardDecisions(opponentOnly, "owner")).toEqual([]);

    const duplicate = observedSideboardReplay();
    duplicate.events.push({ ...sideboardAction(duplicate), id: "duplicate", index: 6 });
    duplicate.series.games[1].eventEndIndex = 6;
    expect(extractObservedSideboardDecisions(duplicate, "owner")).toEqual([]);

    const partial = observedSideboardReplay();
    sideboardPatchFields(partial).deck = { sections: { sideboard: postSideboard() } };
    expect(extractObservedSideboardDecisions(partial, "owner")).toEqual([]);

    const changedPool = observedSideboardReplay();
    const invalidPost = postMain().map((card) => card.cardCode === "OGN-014"
      ? { ...card, cardCode: "OGN-015", name: "Captain Farron" }
      : card);
    sideboardPatchFields(changedPool).deck = deckObject(invalidPost, postSideboard());
    expect(extractObservedSideboardDecisions(changedPool, "owner")).toEqual([]);
  });
});

export function observedSideboardReplay(): CanonicalReplayV2 {
  const baseline = deckObject(preMain(), preSideboard(), true);
  const submitted = deckObject(postMain(), postSideboard());
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: "sideboard-replay",
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: "capture-sideboard",
      roomCode: "SIDEBOARD",
      startedAt: Date.UTC(2026, 7, 12, 10),
      endedAt: Date.UTC(2026, 7, 12, 11),
      messageCount: 6,
    },
    series: {
      id: "series-sideboard",
      perspectivePlayerId: "self",
      format: "bo3",
      bestOf: 3,
      roomCode: "SIDEBOARD",
      startedAt: Date.UTC(2026, 7, 12, 10),
      endedAt: Date.UTC(2026, 7, 12, 11),
      participants: [
        {
          id: "self",
          name: "Player",
          isPerspective: true,
          fields: { registeredDeck: baseline },
        },
        {
          id: "opponent",
          name: "Opponent",
          isPerspective: false,
          fields: {
            registeredDeck: {
              sections: {
                legend: [{ cardCode: "VEN-145", name: "Nasus, Curator of the Sands", count: 1 }],
              },
            },
          },
        },
      ],
      games: [
        game("game-1", 1, 1, 0, 2, "self", "opponent"),
        game("game-2", 2, 2, 3, 5, "opponent", "self"),
      ],
    },
    events: [
      boundary("game-1", 0, 1, 1),
      phase("game-1", 1, 1, "in_game"),
      boundary("game-1", 2, 1, 1, "end"),
      boundary("game-2", 3, 2, 2),
      phase("game-2", 4, 2, "sideboarding"),
      {
        id: "self-sideboard",
        index: 5,
        at: Date.UTC(2026, 7, 12, 10, 30),
        atMs: 1_800_000,
        sourceMessageId: "message-sideboard",
        gameId: "game-2",
        kind: "action",
        actionType: "submit_sideboard",
        actorPlayerId: "self",
        action: { type: "submit_sideboard" },
        confirmation: {
          status: "confirmed",
          authority: "authoritative_patch_commit",
          correlation: "matched_intent",
          commitMessageId: "message-sideboard",
        },
        patch: {
          operations: [{
            id: "sideboard-deck",
            op: "set_player_fields",
            playerId: "self",
            fields: { deck: submitted },
          }],
        },
      },
    ],
    unknownEvents: [],
    diagnostics: [],
    checkpoints: [],
  };
}

function preMain(): SideboardLabDeckCard[] {
  return mainCards().map((card) => ({ ...card }));
}

function postMain(): SideboardLabDeckCard[] {
  return mainCards().map((card) => card.cardCode === "OGN-001" ? { ...card, count: 2 } : card)
    .concat({ cardCode: "OGN-014", name: "Sky Splitter", count: 1 });
}

function preSideboard(): SideboardLabDeckCard[] {
  return [{ cardCode: "OGN-014", name: "Sky Splitter", count: 2 }];
}

function postSideboard(): SideboardLabDeckCard[] {
  return [
    { cardCode: "OGN-001", name: "Blazing Scorcher", count: 1 },
    { cardCode: "OGN-014", name: "Sky Splitter", count: 1 },
  ];
}

function mainCards(): SideboardLabDeckCard[] {
  const codes = [
    "OGN-001", "OGN-002", "OGN-003", "OGN-004", "OGN-005", "OGN-006",
    "OGN-008", "OGN-009", "OGN-010", "OGN-011", "OGN-012", "OGN-013", "OGN-015",
  ];
  return codes.map((cardCode, index) => ({
    cardCode,
    name: `Ignored provider name ${index}`,
    count: 3,
  })).concat({ cardCode: "OGN-016", name: "Dangerous Duo", count: 1 });
}

function deckObject(
  mainDeck: SideboardLabDeckCard[],
  sideboard: SideboardLabDeckCard[],
  includeLegend = false,
): JsonObject {
  return {
    sections: {
      ...(includeLegend ? {
        legend: [{ cardCode: "UNL-191", name: "Master Yi, Wuju Master", count: 1 }],
      } : {}),
      mainDeck,
      champion: [],
      sideboard,
    },
  };
}

function game(
  id: string,
  ordinal: number,
  gameNumber: number,
  eventStartIndex: number,
  eventEndIndex: number,
  winnerPlayerId: string,
  loserPlayerId: string,
) {
  return {
    id,
    ordinal,
    gameNumber,
    sourceIdentity: { explicitGameNumber: true, gameInstanceIds: [id], resultEventId: `${id}-result` },
    startedAt: 1_000 * ordinal,
    endedAt: 1_000 * ordinal + 900,
    startedAtMs: 1_000 * (ordinal - 1),
    endedAtMs: 1_000 * ordinal,
    eventStartIndex,
    eventEndIndex,
    phases: [],
    result: { resultEventId: `${id}-result`, winnerPlayerId, loserPlayerId },
  };
}

function boundary(
  gameId: string,
  index: number,
  gameOrdinal: number,
  gameNumber: number,
  boundaryType: "start" | "end" = "start",
) {
  return {
    id: `${gameId}-${boundaryType}`,
    index,
    at: 1_000 + index,
    atMs: index,
    sourceMessageId: `${gameId}-${boundaryType}-message`,
    gameId,
    kind: "game_boundary" as const,
    boundary: boundaryType,
    gameOrdinal,
    gameNumber,
    reason: boundaryType === "start"
      ? "explicit_game_number" as const
      : "explicit_result" as const,
  };
}

function phase(gameId: string, index: number, gameNumber: number, value: "in_game" | "sideboarding") {
  return {
    id: `${gameId}-${value}`,
    index,
    at: 1_000 + index,
    atMs: index,
    sourceMessageId: `${gameId}-${value}-message`,
    gameId,
    kind: "phase" as const,
    phase: value,
    rawPhase: value,
    gameNumber,
  };
}

function sideboardAction(replay: CanonicalReplayV2): ReplayActionEvent {
  const action = replay.events.find((event): event is ReplayActionEvent => event.kind === "action");
  if (!action) throw new Error("missing sideboard action");
  return action;
}

function sideboardPatchFields(replay: CanonicalReplayV2): JsonObject {
  const operation = sideboardAction(replay).patch.operations.find((candidate) => candidate.op === "set_player_fields");
  if (!operation || operation.op !== "set_player_fields") throw new Error("missing sideboard deck patch");
  return operation.fields;
}
