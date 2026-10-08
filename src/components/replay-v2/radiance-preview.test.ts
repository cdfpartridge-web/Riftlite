import { describe, expect, it } from "vitest";
import preview from "@/lib/cards/radiance-preview.json";
import { mulliganCardMetadata } from "@/lib/mulligan-lab/registry";
import { BATTLEFIELDS, LEGENDS } from "@/lib/constants";
import { getLegendCardImageUrl } from "@/lib/legends";
import { parseRiftReplayPayload } from "@/lib/riftreplay/parse";
import type { ReplayCardState } from "@/lib/replay-v2";
import { cardCodeFromValue, cardImageUrl, isBattlefieldCard } from "./model";

const card = (name: string, code?: string, imageUrl?: string): ReplayCardState => ({
  id: "preview-card", name, cardCode: code, fields: imageUrl ? { imageUrl } : {},
});

describe("Radiance preview replay rendering", () => {
  it.each(["Hunter's Circle", "Hunters' Circle"])("keeps the historical spelling %s readable", (name) => {
    expect(cardImageUrl(card(name))).toBe(preview.cards["RAD-163"].imageUrl);
    expect(isBattlefieldCard(card(name))).toBe(true);
  });

  it("preserves the alternate Packed Amphitheater art while name-only captures use the ordinary print", () => {
    expect(preview.cards["RAD-184"].imageUrl).not.toBe(preview.cards["RAD-164"].imageUrl);
    expect(cardImageUrl(card("Packed Amphitheater", "RAD-184"))).toBe(preview.cards["RAD-184"].imageUrl);
    expect(cardImageUrl(card("Packed Amphitheater"))).toBe(preview.cards["RAD-164"].imageUrl);
  });

  it.each(["Lost to the Sand", "Lost to the Sands"])("renders name-only %s captures without classifying the spell as a battlefield", (name) => {
    expect(cardImageUrl(card(name))).toBe(preview.cards["RAD-013"].imageUrl);
    expect(isBattlefieldCard(card(name))).toBe(false);
    expect(cardImageUrl({ ...card(name), isPlaceholder: true })).toBeUndefined();

    const replay = parseRiftReplayPayload({ messages: [{ parsed: {
      type: "authoritative_snapshot",
      snapshot: { players: [{ id: "self", board: { hand: [name] } }] },
    } }] });
    expect(replay.players[0].zones[0].cards[0]).toMatchObject({
      name, code: "RAD-013", imageUrl: preview.cards["RAD-013"].imageUrl,
    });
  });

  it("keeps captured preview art and exact collector codes ahead of the historical name alias", () => {
    const captured = "https://cdn.piltoverarchive.com/temporary/captured-preview.png";
    expect(cardImageUrl(card("Lost to the Sand", undefined, captured))).toBe(captured);
    expect(cardImageUrl(card("Lost to the Sand", "RAD-004"))).toBe(preview.cards["RAD-004"].imageUrl);
  });

  it("renders all revealed collector prints from their audited artwork", () => {
    expect(Object.keys(preview.cards)).toHaveLength(200);
    for (const [code, data] of Object.entries(preview.cards)) {
      expect(cardImageUrl(card(data.name, code, `/cards/${code}.webp`)), code).toBe(data.imageUrl);
      if (data.type === "Battlefield") {
        const defaultArt = Object.values(preview.cards)
          .find((print) => print.type === "Battlefield" && print.name === data.name)!.imageUrl;
        expect(isBattlefieldCard(card("Unknown field", code)), code).toBe(true);
        expect(isBattlefieldCard(card(data.name)), data.name).toBe(true);
        expect(cardImageUrl(card(data.name))).toBe(defaultArt);
        expect(BATTLEFIELDS).toContain(data.name);
        const legacy = parseRiftReplayPayload({ messages: [{ parsed: {
          type: "authoritative_snapshot",
          snapshot: { players: [{ id: "self", board: { battlefield: [data.name] } }] },
        } }] });
        expect(legacy.players[0].zones[0].cards[0].imageUrl, `${code} legacy name`).toBe(defaultArt);
      }
      if (data.type === "Legend") {
        expect(LEGENDS).toContain(data.champion);
        expect(Object.values(preview.cards).some((print) => (
          print.type === "Legend" && print.champion === data.champion &&
          print.imageUrl === getLegendCardImageUrl(data.champion!)
        )), data.champion!).toBe(true);
      }
    }
  });

  it("recognises every preview print in the training registry with the same audited identity", () => {
    for (const [code, data] of Object.entries(preview.cards)) {
      expect(mulliganCardMetadata(code.replace(/S$/, "*")), code).toMatchObject({
        name: data.name,
        type: data.type,
        supertype: data.supertype,
      });
    }
  });

  it("preserves captured promotional art and recognises encoded signature spellings", () => {
    const promo = "https://cdn.piltoverarchive.com/temporary/1790379856360-1cbp857fr3y.jpg";
    expect(cardImageUrl(card("Ahri, Confident", "RAD-038", promo))).toBe(promo);
    for (const code of ["RAD-169*/167", "/cards/RAD-169%2A.webp", "/cards/RAD-169-star-167.webp"]) {
      expect(cardCodeFromValue(code)).toBe("RAD-169S");
      expect(cardImageUrl(card("Ziggs", code))).toBe(preview.cards["RAD-169S"].imageUrl);
    }
    expect(cardImageUrl(card("Ziggs", "RAD-169S", "https://untrusted.example/card.png")))
      .toBe(preview.cards["RAD-169S"].imageUrl);
  });

  it("renders an Atlas Bomb token that only supplies its token name and relative image path", () => {
    expect(cardImageUrl({ ...card("Bomb", undefined, "/tokens/Bomb.webp"), source: "token" }))
      .toBe(preview.cards["RAD-T02"].imageUrl);
  });

  it.each([
    ["RAD-168*/167", "RAD-168S"],
    ["/cards/RAD-168%2A.webp", "RAD-168S"],
    ["/cards/RAD-168-star-167.webp", "RAD-168S"],
    ["rad-168s", "RAD-168S"],
    ["RAD-SP3/006", "RAD-SP3"],
    ["RAD-R02A", "RAD-R02A"],
    ["RAD-T02", "RAD-T02"],
  ])("preserves exact legacy collector artwork for %s", (capturedCode, expectedCode) => {
    const data = (preview.cards as Record<string, { name: string; imageUrl: string }>)[expectedCode];
    expect(data).toBeDefined();
    const replay = parseRiftReplayPayload({ messages: [{ parsed: {
      type: "authoritative_snapshot",
      snapshot: { players: [{ id: "self", board: { hand: [{
        id: "exact-print", name: data.name, cardCode: capturedCode,
      }] } }] },
    } }] });
    expect(replay.players[0].zones[0].cards[0]).toMatchObject({
      code: expectedCode, imageUrl: data.imageUrl,
    });
  });
});
