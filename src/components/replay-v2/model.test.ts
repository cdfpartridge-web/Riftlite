import { describe, expect, it } from "vitest";

import type { ReplayCardState, ReplayEvent, ReplayPlayerState, ReplayState } from "@/lib/replay-v2";

import {
  attachedToCardId,
  banishedCards,
  banishedTransitions,
  battlefieldCards,
  battlefieldZoneForPlayer,
  boardZones,
  cardCodeFromValue,
  cardCounterValue,
  cardImageUrl,
  cardsShareCanonicalIdentity,
  championCard,
  championZoneCard,
  customCardLabels,
  eventLabel,
  groupCardsWithAttachments,
  isBattlefieldCard,
  isDuplicateCard,
  isReplayActionStep,
  isTechnicalReplayActionType,
  legendCard,
  replayActionStepIndex,
  replayDisplayEvent,
  safeCardImageUrl,
} from "./model";

describe("replay action navigation", () => {
  it("skips provider bookkeeping and unknown packets in both directions", () => {
    const events: ReplayEvent[] = [
      replayAction(0, "move_card"),
      replayUnknown(1, "authoritative_patch_commit"),
      replayAction(2, "payment_batch", "BMU paid 2 energy."),
      replayUnknown(3, "rewind_confirmation_state"),
      replayAction(4, "play_card"),
    ];

    expect(replayActionStepIndex({ events }, 0, 1)).toBe(4);
    expect(replayActionStepIndex({ events }, 4, -1)).toBe(0);
    expect(replayActionStepIndex({ events }, -1, 1)).toBe(0);
  });

  it("keeps player-facing event families while excluding unknown synchronization frames", () => {
    expect(isReplayActionStep({
      id: "phase",
      index: 0,
      at: 1,
      atMs: 0,
      sourceMessageId: "message-phase",
      gameId: "game-1",
      kind: "phase",
      phase: "in_game",
      rawPhase: "in_game",
      gameNumber: 1,
    })).toBe(true);
    expect(isReplayActionStep({
      id: "snapshot",
      index: 1,
      at: 2,
      atMs: 1,
      sourceMessageId: "message-snapshot",
      gameId: "game-1",
      kind: "snapshot",
      snapshot: {
        room: { phase: "in_game", rawPhase: "in_game", gameNumber: 1, fields: {} },
        players: {},
        chain: [],
        log: [],
      },
    })).toBe(true);
    expect(isReplayActionStep(replayUnknown(1, "authoritative_patch_commit"))).toBe(false);
    expect(isTechnicalReplayActionType("Rewind Confirmation State")).toBe(true);
    expect(isTechnicalReplayActionType("move_cards_to_trash_batch")).toBe(false);
  });

  it("uses a human match-log description for technical actions", () => {
    expect(eventLabel(replayAction(0, "payment_batch", "BMU paid 2 energy.")))
      .toBe("BMU paid 2 energy.");
    expect(eventLabel(replayAction(1, "authoritative_patch_commit"))).toBe("Board updated");
  });

  it("keeps technical packet names out of playback captions", () => {
    const events: ReplayEvent[] = [
      replayAction(0, "move_card"),
      replayUnknown(1, "authoritative_patch_commit"),
      replayAction(2, "payment_batch", "BMU paid 2 energy."),
      replayUnknown(3, "rewind_confirmation_state"),
    ];

    expect(replayDisplayEvent({ events }, 1)?.index).toBe(0);
    expect(eventLabel(replayDisplayEvent({ events }, 3))).toBe("BMU paid 2 energy.");
    expect(replayDisplayEvent({ events }, -1)).toBeUndefined();
  });
});

describe("replay card image URLs", () => {
  it("accepts same-origin paths and the dedicated card-art hosts", () => {
    expect(safeCardImageUrl("/images/cards/test.webp")).toBe("/images/cards/test.webp");
    expect(safeCardImageUrl("https://cdn.piltoverarchive.com/cards/OGN-001.webp"))
      .toBe("https://cdn.piltoverarchive.com/cards/OGN-001.webp");
  });

  it("blocks uploader-controlled remote and embedded image sources", () => {
    expect(safeCardImageUrl("https://tracker.example/pixel.gif")).toBeUndefined();
    expect(safeCardImageUrl("data:image/svg+xml,<svg />")).toBeUndefined();
    expect(safeCardImageUrl("//tracker.example/pixel.gif")).toBeUndefined();
  });

  it("falls back to trusted card art when an untrusted direct URL is present", () => {
    const card: ReplayCardState = {
      id: "card-1",
      name: "Test card",
      cardCode: "OGN-001",
      fields: { imageUrl: "https://tracker.example/pixel.gif" },
    };
    expect(cardImageUrl(card)).toBe("https://cdn.piltoverarchive.com/cards/OGN-001.webp");
  });

  it("uses the base printing for signed alternate-art card codes", () => {
    expect(cardImageUrl({
      ...card("signed-jhin", "Jhin, Meticulous Killer", "UNL-089A"),
      fields: { imageUrl: "/cards/UNL-089A.webp" },
    })).toBe("https://cdn.piltoverarchive.com/cards/UNL-089.webp");
  });

  it("keeps an overnumbered card code when that printing has public art", () => {
    expect(cardImageUrl(card("overnumbered-jhin", "Jhin, Virtuoso", "UNL-226")))
      .toBe("https://cdn.piltoverarchive.com/cards/UNL-226.webp");
  });

  it.each([
    ["Mind Rune", "UNL-R03A", "OGN-089"],
    ["Fury Rune", "UNL-R01A", "OGN-007"],
    ["Unknown Rune", "SFD-R06B", "OGN-214"],
  ])("maps the signed %s printing to canonical rune artwork", (name, printCode, artCode) => {
    expect(cardCodeFromValue(`https://cards.example/${printCode}.webp`)).toBe(printCode);
    expect(cardImageUrl(card(`signed-${name}`, name, printCode)))
      .toBe(`https://cdn.piltoverarchive.com/cards/${artCode}.webp`);
  });

  it("treats signed and overnumbered alternate arts as the same card identity", () => {
    expect(cardsShareCanonicalIdentity(
      card("signed", "Jhin, Meticulous Killer", "UNL-089A"),
      card("base", "Jhin, Meticulous Killer", "UNL-089"),
    )).toBe(true);
    expect(cardsShareCanonicalIdentity(
      card("overnumbered", "Jhin, Virtuoso", "UNL-226"),
      card("standard", "Jhin, Virtuoso", "UNL-181"),
    )).toBe(true);
  });

  it("resolves name-only battlefield artwork from the public card catalog", () => {
    expect(cardImageUrl(card("battlefield", "Sunken Temple")))
      .toBe("https://cdn.piltoverarchive.com/cards/SFD-218.webp");
    expect(cardImageUrl(card("trapping", "Trapping Grounds")))
      .toBe("https://cdn.piltoverarchive.com/cards/UNL-217.webp");
    expect(cardImageUrl(card("valley", "Valley of Idols")))
      .toBe("https://cdn.piltoverarchive.com/cards/UNL-218.webp");
  });

  it.each([
    ["Dragon Roost", "VEN-157"],
    ["Heisho, Shell of the World", "VEN-158"],
    ["Kinkou Temple", "VEN-159"],
    ["Mystic Vortex", "VEN-160"],
    ["Piltovan Forge", "VEN-161"],
    ["Piltover Forge", "VEN-161"],
    ["Protective Sands", "VEN-162"],
    ["Risen Altar", "VEN-163"],
    ["Sandswept Tomb", "VEN-164"],
    ["Shadow Temple", "VEN-165"],
    ["Threshold of the Gray", "VEN-166"],
    ["Threshold of the Grey", "VEN-166"],
  ])("resolves the name-only Vendetta battlefield %s", (name, code) => {
    const battlefield = card(`battlefield-${code}`, name);
    expect(isBattlefieldCard(battlefield)).toBe(true);
    expect(cardImageUrl(battlefield))
      .toBe(`https://cdn.piltoverarchive.com/cards/${code}.webp`);
  });

  it.each([
    ["Recruit", "/tokens/Recruit.webp", "Recruit.webp"],
    ["Mech", "/tokens/Mech.webp", "Mech.webp"],
    ["Gold", "/tokens/Gold.webp", "Gold.webp"],
    ["Bird", "/tokens/Bird.webp", "Bird.webp"],
    ["Sand Soldier", "/tokens/SandSoldier.webp", "SandSoldier.webp"],
    ["Sprite", "/tokens/Sprite.webp", "Sprite.webp"],
  ])("resolves the Atlas %s token to its public artwork", (name, imageUrl, fileName) => {
    expect(cardImageUrl({
      ...card(`token-${name}`, name),
      source: "token",
      fields: { imageUrl },
    })).toBe(`https://play.riftatlas.com/tokens/${fileName}`);
  });

  it("uses the canonical token name when Atlas omits the image path", () => {
    expect(cardImageUrl({
      ...card("sand-soldier", "Sand Soldier"),
      source: "token",
      fields: {},
    })).toBe("https://play.riftatlas.com/tokens/SandSoldier.webp");
  });

  it("canonicalizes casing in known Atlas token paths", () => {
    expect(cardImageUrl({
      ...card("recruit", "Recruit"),
      source: "token",
      fields: { imageUrl: "/tokens/recruit.WEBP" },
    })).toBe("https://play.riftatlas.com/tokens/Recruit.webp");
  });

  it("resolves a future Atlas token from its strict token path", () => {
    expect(cardImageUrl({
      ...card("unknown-token", "Unknown token"),
      source: "token",
      fields: { imageUrl: "/tokens/Unknown.webp" },
    })).toBe("https://play.riftatlas.com/tokens/Unknown.webp");
  });

  it("does not rewrite unsafe token paths to the Atlas host", () => {
    expect(cardImageUrl({
      ...card("unsafe-token", "Unknown token"),
      source: "token",
      fields: { imageUrl: "/tokens/../private.webp" },
    })).toBe("/tokens/../private.webp");
  });
});

describe("replay board card interpretation", () => {
  it("maps Atlas seat ownership to its authoritative battlefield zone", () => {
    const seatZero = { ...replayPlayer("seat-zero", "Beer", {}), seat: 0 };
    const seatOne = { ...replayPlayer("seat-one", "BMU", {}), seat: 1 };
    const seatB = { ...replayPlayer("seat-b", "Player B", {}), seat: "B" };
    const unknown = replayPlayer("unknown", "Unknown", {});

    expect(battlefieldZoneForPlayer(seatZero, "battlefieldB")).toBe("battlefieldA");
    expect(battlefieldZoneForPlayer(seatOne, "battlefieldA")).toBe("battlefieldB");
    expect(battlefieldZoneForPlayer(seatB, "battlefieldA")).toBe("battlefieldB");
    expect(battlefieldZoneForPlayer(unknown, "battlefieldA")).toBe("battlefieldA");
  });

  it("ignores legacy TCGA turn-order seats when arranging selected battlefields", () => {
    const perspectiveSecond = {
      ...replayPlayer("tcga-self", "BMU", {}, { provider: "tcga", turnOrderPosition: 1 }),
      seat: 1,
    };
    const opponentFirst = {
      ...replayPlayer("tcga-opponent", "P2892", {}, { provider: "tcga", turnOrderPosition: 0 }),
      seat: 0,
    };

    expect(battlefieldZoneForPlayer(perspectiveSecond, "battlefieldA")).toBe("battlefieldA");
    expect(battlefieldZoneForPlayer(opponentFirst, "battlefieldB")).toBe("battlefieldB");
  });

  it("recognizes only explicit duplicate markers", () => {
    expect(isDuplicateCard({ ...card("boolean", "Copy"), fields: { isDuplicate: true } })).toBe(true);
    expect(isDuplicateCard({ ...card("string", "Copy"), fields: { isDuplicate: " TRUE " } })).toBe(true);
    expect(isDuplicateCard({ ...card("number", "Copy"), fields: { isDuplicate: 1 } })).toBe(true);

    expect(isDuplicateCard({ ...card("false", "Copy"), fields: { isDuplicate: false } })).toBe(false);
    expect(isDuplicateCard({ ...card("numeric-string", "Copy"), fields: { isDuplicate: "1" } })).toBe(false);
    expect(isDuplicateCard({ ...card("hint", "Duplicated unit"), source: "duplicate_card" })).toBe(false);
    expect(isDuplicateCard(undefined)).toBe(false);
  });

  it("reads added custom labels and removes them as soon as the projected field is absent", () => {
    const labelled: ReplayCardState = {
      ...card("labelled", "Akali"),
      fields: { customLabels: [" Empowered ", "", "Marked", 7] },
    };

    expect(customCardLabels(labelled)).toEqual(["Empowered", "Marked"]);
    delete labelled.fields.customLabels;
    expect(customCardLabels(labelled)).toEqual([]);
  });

  it("preserves explicit zero and negative counter values", () => {
    const counted: ReplayCardState = {
      ...card("counted", "Akali"),
      fields: { whiteCounter: 0, redCounter: -4 },
    };

    expect(cardCounterValue(counted, "whiteCounter")).toBe(0);
    expect(cardCounterValue(counted, "redCounter")).toBe(-4);
    delete counted.fields.whiteCounter;
    expect(cardCounterValue(counted, "whiteCounter")).toBeUndefined();
    expect(cardCounterValue(card("uncounted", "Akali"), "whiteCounter")).toBeUndefined();
  });

  it("groups reverse-order and non-adjacent attachments by their exact host ID", () => {
    const host = card("card_host", "Akali");
    const firstAttachment = {
      ...card("card_first", "Guardian Angel"),
      fields: { attachedToCardId: host.id },
    };
    const secondAttachment = {
      ...card("card_second", "Long Sword"),
      fields: { attachedToCardId: host.id },
    };
    const unrelated = card("card_other", "Stellacorn Herder");

    expect(attachedToCardId(firstAttachment)).toBe(host.id);
    expect(groupCardsWithAttachments([firstAttachment, host])).toEqual([
      { host, attachments: [firstAttachment] },
    ]);
    expect(groupCardsWithAttachments([host, unrelated, firstAttachment, secondAttachment])).toEqual([
      { host, attachments: [firstAttachment, secondAttachment] },
      { host: unrelated, attachments: [] },
    ]);
  });

  it("keeps an attachment with a missing host as a standalone card", () => {
    const orphan = {
      ...card("card_orphan", "Long Sword"),
      fields: { attachedToCardId: "card_missing" },
    };
    expect(groupCardsWithAttachments([orphan])).toEqual([{ host: orphan, attachments: [] }]);
  });

  it("renders self-links and malformed cycles exactly once", () => {
    const selfLinked = {
      ...card("card_self", "Self-linked card"),
      fields: { attachedToCardId: "card_self" },
    };
    const cycleA = {
      ...card("card_cycle_a", "Cycle A"),
      fields: { attachedToCardId: "card_cycle_b" },
    };
    const cycleB = {
      ...card("card_cycle_b", "Cycle B"),
      fields: { attachedToCardId: "card_cycle_a" },
    };

    const grouped = groupCardsWithAttachments([selfLinked, cycleA, cycleB]);
    const renderedIds = grouped.flatMap((group) => [
      group.host.id,
      ...group.attachments.map((attachment) => attachment.id),
    ]);
    expect(renderedIds).toHaveLength(3);
    expect(renderedIds.sort()).toEqual(["card_cycle_a", "card_cycle_b", "card_self"]);
  });

  it("recognizes canonical, typed, and catalogued battlefield cards", () => {
    expect(isBattlefieldCard({ ...card("canonical", "Unknown field"), source: "battlefield" })).toBe(true);
    expect(isBattlefieldCard({ ...card("typed", "Unknown field"), fields: { type: "Battlefield Card" } })).toBe(true);
    expect(isBattlefieldCard(card("known-name", "Sunken Temple"))).toBe(true);
    expect(isBattlefieldCard(card("known-code", "Unknown field", "SFD-218"))).toBe(true);
    expect(isBattlefieldCard(card("unit", "Soaring Scout", "OGN-216"))).toBe(false);
  });

  it("resolves legend and champion identity cards from Atlas zones", () => {
    const player = replayPlayer("self", "LeBlanc", {
      champion: [card("champion", "LeBlanc, Fragmented", "UNL-172", "champion")],
      legend: [card("legend", "LeBlanc, Deceiver", "UNL-199", "legend")],
    });

    expect(legendCard(player)?.cardCode).toBe("UNL-199");
    expect(championCard(player)?.cardCode).toBe("UNL-172");
  });

  it("does not keep a played champion in the live champion slot", () => {
    const playedChampion = card(
      "played-champion",
      "LeBlanc, Fragmented",
      "UNL-172",
      "champion",
    );
    const player = replayPlayer("self", "LeBlanc", {
      base: [playedChampion],
      champion: [],
      legend: [card("legend", "LeBlanc, Deceiver", "UNL-199", "legend")],
    });

    expect(championZoneCard(player)).toBeUndefined();
    expect(championCard(player)?.id).toBe(playedChampion.id);
    expect(boardZones(player).flatMap((zone) => zone.cards).map((entry) => entry.id))
      .toEqual([playedChampion.id]);
  });

  it("keeps the two explicit battlefield selections in player order and ignores options", () => {
    const bottom = replayPlayer("self", "LeBlanc", {}, {
      battlefieldOptions: ["Aspirant's Climb", "Windswept Hillock", "Star Spring"],
      selectedBattlefield: "Windswept Hillock",
    });
    const top = replayPlayer("opponent", "Fiora", {}, {
      battlefieldOptions: ["Monastery of Hirana", "Sunken Temple", "The Grand Plaza"],
      selectedBattlefield: "Sunken Temple",
    });

    const selected = battlefieldCards(replayState(bottom, top), { bottom, top });
    expect(selected.map((entry) => [entry?.name, entry?.cardCode])).toEqual([
      ["Windswept Hillock", "OGN-297"],
      ["Sunken Temple", "SFD-218"],
    ]);
    expect(selected.map((entry) => entry?.source)).toEqual(["battlefield", "battlefield"]);
    expect(selected.every(isBattlefieldCard)).toBe(true);
  });

  it("marks enriched battlefield cards without dropping selection fields", () => {
    const bottom = replayPlayer("self", "LeBlanc", {}, {
      selectedBattlefield: { name: "Windswept Hillock", selectionOrdinal: 2 },
    });
    const top = replayPlayer("opponent", "Fiora", {});
    const selected = battlefieldCards(replayState(bottom, top), { bottom, top })[0];

    expect(selected).toMatchObject({
      name: "Windswept Hillock",
      cardCode: "OGN-297",
      source: "battlefield",
      fields: { selectionOrdinal: 2 },
    });
  });

  it("preserves two slots when both players selected the same battlefield", () => {
    const bottom = replayPlayer("self", "LeBlanc", {}, { selectedBattlefield: "Windswept Hillock" });
    const top = replayPlayer("opponent", "Fiora", {}, { selectedBattlefield: "Windswept Hillock" });
    expect(battlefieldCards(replayState(bottom, top), { bottom, top })).toHaveLength(2);
  });

  it("keeps an opponent-only selection in the opponent slot", () => {
    const bottom = replayPlayer("self", "LeBlanc", {});
    const top = replayPlayer("opponent", "Fiora", {}, { selectedBattlefield: "Valley of Idols" });
    const selected = battlefieldCards(replayState(bottom, top), { bottom, top });

    expect(selected[0]).toBeUndefined();
    expect(selected[1]?.name).toBe("Valley of Idols");
    expect(selected[1]?.cardCode).toBe("UNL-218");
  });

  it("fills a missing local slot without moving the opponent selection", () => {
    const bottom = replayPlayer("self", "LeBlanc", {});
    const top = replayPlayer("opponent", "Fiora", {}, { selectedBattlefield: "Valley of Idols" });
    const state = replayState(bottom, top, {
      selectedBattlefields: ["Windswept Hillock", "Valley of Idols"],
    });

    expect(battlefieldCards(state, { bottom, top }).map((entry) => entry?.name)).toEqual([
      "Windswept Hillock",
      "Valley of Idols",
    ]);
  });

  it("keeps only base cards in player base lanes", () => {
    const player = replayPlayer("self", "LeBlanc", {
      base: [card("base-card", "Watchful Sentry", "OGN-096")],
      battlefieldA: [card("unit-a", "Soaring Scout", "OGN-216")],
      champion: [card("champion", "LeBlanc, Fragmented", "UNL-172", "champion")],
      legend: [card("legend", "LeBlanc, Deceiver", "UNL-199", "legend")],
      runeArea: [card("rune", "Mind Rune", "OGN-089", "rune")],
    });
    expect(boardZones(player).map((zone) => zone.key)).toEqual(["base"]);
  });

  it("tracks Atlas-style banished aliases without rendering them as board lanes", () => {
    const opponent = replayPlayer("opponent", "Fiora", {});
    const previousPlayer = replayPlayer("self", "LeBlanc", {
      banished: [],
      base: [card("base-card", "Watchful Sentry", "OGN-096")],
    });
    const currentPlayer = replayPlayer("self", "LeBlanc", {
      base: [card("base-card", "Watchful Sentry", "OGN-096")],
      exile: [card("exiled-card", "Daring Poro", "OGN-135")],
      removed: [card("removed-card", "Repulse", "UNL-106")],
    });
    const previous = replayState(previousPlayer, opponent);
    const current = replayState(currentPlayer, opponent);

    expect(banishedCards(currentPlayer).map((entry) => entry.id))
      .toEqual(["exiled-card", "removed-card"]);
    expect(banishedTransitions(previous, current)).toMatchObject([{
      playerId: "self",
      playerName: "LeBlanc",
      cards: [{ id: "exiled-card" }, { id: "removed-card" }],
    }]);
    expect(boardZones(currentPlayer).map((zone) => zone.key)).toEqual(["base"]);
  });
});

function card(
  id: string,
  name: string,
  cardCode?: string,
  source = "mainDeck",
): ReplayCardState {
  return {
    id,
    name,
    cardCode,
    source,
    fields: { name, source, ...(cardCode ? { cardCode } : {}) },
  };
}

function replayPlayer(
  id: string,
  name: string,
  zones: ReplayPlayerState["zones"],
  fields: ReplayPlayerState["fields"] = {},
): ReplayPlayerState {
  return { id, name, fields, boardFields: {}, zones };
}

function replayState(
  bottom: ReplayPlayerState,
  top: ReplayPlayerState,
  roomFields: ReplayState["room"]["fields"] = {},
): ReplayState {
  return {
    seriesId: "series-test",
    gameId: "game-test",
    gameOrdinal: 1,
    phase: "in_game",
    appliedEventIndex: 1,
    room: { phase: "in_game", rawPhase: "in_game", gameNumber: 1, fields: roomFields },
    players: { [bottom.id]: bottom, [top.id]: top },
    chain: [],
    log: [],
    chat: [],
  };
}

function replayAction(index: number, actionType: string, logText?: string): ReplayEvent {
  return {
    id: `action-${index}`,
    index,
    at: 1_000 + index,
    atMs: index,
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
    patch: {
      operations: logText ? [{
        id: `log-${index}`,
        op: "log_insert",
        index: 0,
        entries: [{ id: `entry-${index}`, text: logText, fields: {} }],
      }] : [],
    },
  };
}

function replayUnknown(index: number, packetType: string): ReplayEvent {
  return {
    id: `unknown-${index}`,
    index,
    at: 1_000 + index,
    atMs: index,
    sourceMessageId: `message-${index}`,
    gameId: "game-1",
    kind: "unknown",
    packetType,
    reason: "unsupported_packet",
    payload: {},
  };
}
