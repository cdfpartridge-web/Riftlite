import { describe, expect, it } from "vitest";

import type { ReplayCardState, ReplayPlayerState, ReplayState } from "@/lib/replay-v2";

import {
  battlefieldCards,
  boardZones,
  cardImageUrl,
  championCard,
  isBattlefieldCard,
  isDuplicateCard,
  legendCard,
  safeCardImageUrl,
} from "./model";

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

  it("resolves name-only battlefield artwork from the public card catalog", () => {
    expect(cardImageUrl(card("battlefield", "Sunken Temple")))
      .toBe("https://cdn.piltoverarchive.com/cards/SFD-218.webp");
    expect(cardImageUrl(card("trapping", "Trapping Grounds")))
      .toBe("https://cdn.piltoverarchive.com/cards/UNL-217.webp");
    expect(cardImageUrl(card("valley", "Valley of Idols")))
      .toBe("https://cdn.piltoverarchive.com/cards/UNL-218.webp");
  });
});

describe("replay board card interpretation", () => {
  it("recognizes only explicit duplicate markers", () => {
    expect(isDuplicateCard({ ...card("boolean", "Copy"), fields: { isDuplicate: true } })).toBe(true);
    expect(isDuplicateCard({ ...card("string", "Copy"), fields: { isDuplicate: " TRUE " } })).toBe(true);
    expect(isDuplicateCard({ ...card("number", "Copy"), fields: { isDuplicate: 1 } })).toBe(true);

    expect(isDuplicateCard({ ...card("false", "Copy"), fields: { isDuplicate: false } })).toBe(false);
    expect(isDuplicateCard({ ...card("numeric-string", "Copy"), fields: { isDuplicate: "1" } })).toBe(false);
    expect(isDuplicateCard({ ...card("hint", "Duplicated unit"), source: "duplicate_card" })).toBe(false);
    expect(isDuplicateCard(undefined)).toBe(false);
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
