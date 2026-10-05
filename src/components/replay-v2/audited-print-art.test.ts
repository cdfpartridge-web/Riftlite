import { describe, expect, it } from "vitest";
import art from "@/lib/cards/audited-print-art.json";
import preview from "@/lib/cards/radiance-preview.json";
import { auditedCapturedImageUrl } from "@/lib/cards/audited-print-art";
import { mulliganCardMetadata } from "@/lib/mulligan-lab/registry";
import type { ReplayCardState, ReplayPlayerState } from "@/lib/replay-v2";
import { parseRiftReplayPayload } from "@/lib/riftreplay/parse";
import { cardImageUrl, legendCard } from "./model";

const card = (code: string, imageUrl?: string): ReplayCardState => ({
  id: "exact-print", name: "Captured card", cardCode: code, fields: imageUrl ? { imageUrl } : {},
});

describe("audited alternate print artwork", () => {
  it("renders all newly catalogued historical prints in both replay renderers", () => {
    expect(Object.keys(art.cards)).toHaveLength(26);
    for (const [code, print] of Object.entries(art.cards)) {
      expect(mulliganCardMetadata(code.replace(/S$/, "*")), code).not.toBeNull();
      expect(cardImageUrl(card(code, `/cards/${code}.webp`)), code).toBe(print.imageUrl);
      const replay = parseRiftReplayPayload({ messages: [{ parsed: {
        type: "authoritative_snapshot",
        snapshot: { players: [{ id: "self", board: { hand: [{
          id: "exact-print", name: "Captured card", cardCode: code,
        }] } }] },
      } }] });
      expect(replay.players[0].zones[0].cards[0].imageUrl, code).toBe(print.imageUrl);
    }
  });

  it("preserves audited captured art when image resizing adds query parameters", () => {
    for (const [code, aliases] of Object.entries(art.imageUrlAliasesByPrintId)) {
      for (const alias of aliases) {
        const resized = new URL(alias);
        resized.searchParams.set("width", "400");
        resized.searchParams.set("quality", "85");
        expect(cardImageUrl(card(code, resized.href)), code).toBe(alias);
      }
    }
  });

  it("does not accept an alias for a different card or from a lookalike origin", () => {
    const alias = art.imageUrlAliasesByPrintId["RAD-038"][0];
    expect(auditedCapturedImageUrl("RAD-153", alias)).toBeUndefined();
    const lookalike = new URL(alias);
    lookalike.hostname = "cdn.piltoverarchive.com.example.org";
    expect(auditedCapturedImageUrl("RAD-038", lookalike.href)).toBeUndefined();
    expect(auditedCapturedImageUrl("RAD-038", alias.replace("https:", "http:"))).toBeUndefined();
    expect(cardImageUrl({ ...card("RAD-038", alias), isPlaceholder: true })).toBeUndefined();
  });

  it.each(["RAD-153", "RAD-175", "RAD-170*"])("keeps the selected legend printing %s on the board", (code) => {
    const player = {
      id: "self", fields: {}, boardFields: {}, zones: { legend: [card(code)] },
    } as unknown as ReplayPlayerState;
    const selected = legendCard(player);
    expect(selected?.cardCode).toBe(code);
    expect(cardImageUrl(selected)).toBe(
      (preview.cards as Record<string, { imageUrl: string }>)[code.replace(/\*$/, "S")].imageUrl,
    );
  });
});
