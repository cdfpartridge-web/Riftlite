import { describe, expect, it } from "vitest";

import type { ReplayCardState } from "@/lib/replay-v2";

import { cardImageUrl, safeCardImageUrl } from "./model";

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
});
