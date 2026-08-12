import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readMulliganLabResponse: vi.fn() }));

vi.mock("@/lib/mulligan-lab/server", () => ({
  readMulliganLabResponse: mocks.readMulliganLabResponse,
}));

import { GET } from "@/app/api/app/mulligan-lab/route";

describe("Mulligan Lab desktop endpoint", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a truthful unavailable contract when no aggregate exists", async () => {
    mocks.readMulliganLabResponse.mockResolvedValue({
      schema: "riftlite-mulligan-lab",
      version: 1,
      status: "unavailable",
      generatedAt: null,
      expiresAt: null,
      source: {
        kind: "precomputed-observed-replays",
        corpus: "anonymized-canonical-web-replays",
        minimumHands: 25,
        minimumPlayers: 10,
      },
      drills: [],
      reason: "snapshot_not_configured",
    });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "unavailable", drills: [] });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
  });
});
