import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readSideboardLabPack: vi.fn() }));

vi.mock("@/lib/sideboard-lab/server", () => ({
  readSideboardLabPack: mocks.readSideboardLabPack,
}));

import { GET } from "@/app/api/app/sideboard-lab/v2/route";

describe("targeted Sideboard Lab endpoint", () => {
  beforeEach(() => mocks.readSideboardLabPack.mockReset());

  it("forwards matchup, deck, prior-result, and pack-size selectors", async () => {
    mocks.readSideboardLabPack.mockResolvedValue({ status: "unavailable", drills: [] });
    const fingerprint = "b".repeat(64);
    const response = await GET(new NextRequest(
      `https://www.riftlite.com/api/app/sideboard-lab/v2?playerLegend=UNL-191&opponentLegend=VEN-145&deckFingerprint=${fingerprint}&priorGameResult=loss&limit=6`,
    ));
    expect(response.status).toBe(200);
    expect(mocks.readSideboardLabPack).toHaveBeenCalledWith({
      playerLegendIdentityCode: "UNL-191",
      opponentLegendIdentityCode: "VEN-145",
      deckFingerprint: fingerprint,
      priorGameResult: "loss",
      targetGameNumber: 2,
      limit: 6,
    });
  });

  it("rejects malformed fingerprints", async () => {
    const response = await GET(new NextRequest(
      "https://www.riftlite.com/api/app/sideboard-lab/v2?playerLegend=UNL-191&deckFingerprint=nope",
    ));
    expect(response.status).toBe(400);
    expect(mocks.readSideboardLabPack).not.toHaveBeenCalled();
  });
});
