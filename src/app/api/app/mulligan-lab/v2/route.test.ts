import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readMulliganLabPack: vi.fn() }));

vi.mock("@/lib/mulligan-lab/server", () => ({
  readMulliganLabPack: mocks.readMulliganLabPack,
}));

import { GET } from "@/app/api/app/mulligan-lab/v2/route";

describe("targeted Mulligan Lab endpoint", () => {
  beforeEach(() => mocks.readMulliganLabPack.mockReset());

  it("canonicalizes registry codes and forwards bounded selectors", async () => {
    mocks.readMulliganLabPack.mockResolvedValue({ status: "unavailable", drills: [] });
    const fingerprint = "a".repeat(64);
    const response = await GET(new NextRequest(
      `https://www.riftlite.com/api/app/mulligan-lab/v2?playerLegend=UNL-191&opponentLegend=VEN-145&deckFingerprint=${fingerprint}&initiative=second&limit=8`,
    ));
    expect(response.status).toBe(200);
    expect(mocks.readMulliganLabPack).toHaveBeenCalledWith({
      playerLegendIdentityCode: "UNL-191",
      opponentLegendIdentityCode: "VEN-145",
      deckFingerprint: fingerprint,
      initiative: "second",
      limit: 8,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects unknown cards and malformed selectors without reading Firestore", async () => {
    const response = await GET(new NextRequest(
      "https://www.riftlite.com/api/app/mulligan-lab/v2?playerLegend=BAD-999&limit=999",
    ));
    expect(response.status).toBe(400);
    expect(mocks.readMulliganLabPack).not.toHaveBeenCalled();
  });
});
