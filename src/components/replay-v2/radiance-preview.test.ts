import { describe, expect, it } from "vitest";
import preview from "@/lib/cards/radiance-preview.json";
import { BATTLEFIELDS, LEGENDS } from "@/lib/constants";
import { getLegendCardImageUrl } from "@/lib/legends";
import type { ReplayCardState } from "@/lib/replay-v2";
import { cardCodeFromValue, cardImageUrl, isBattlefieldCard } from "./model";

const card = (name: string, code?: string, imageUrl?: string): ReplayCardState => ({
  id: "preview-card", name, cardCode: code, fields: imageUrl ? { imageUrl } : {},
});

describe("Radiance preview replay rendering", () => {
  it("renders all revealed collector prints without relying on an Atlas mirror", () => {
    expect(Object.keys(preview.cards)).toHaveLength(88);
    for (const [code, data] of Object.entries(preview.cards)) {
      expect(cardImageUrl(card(data.name, code, `/cards/${code}.webp`)), code).toBe(data.imageUrl);
      if (data.type === "Battlefield") {
        expect(isBattlefieldCard(card("Unknown field", code)), code).toBe(true);
        expect(isBattlefieldCard(card(data.name)), data.name).toBe(true);
        expect(cardImageUrl(card(data.name))).toBe(data.imageUrl);
        expect(BATTLEFIELDS).toContain(data.name);
      }
      if (data.type === "Legend") {
        expect(LEGENDS).toContain(data.champion);
        expect(getLegendCardImageUrl(data.champion!)).toMatch(/^https:\/\/cmsassets\.rgpub\.io\//);
      }
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
});
