import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readSideboardLabResponse: vi.fn() }));

vi.mock("@/lib/sideboard-lab/server", () => ({
  readSideboardLabResponse: mocks.readSideboardLabResponse,
}));

import { GET } from "@/app/api/app/sideboard-lab/route";

describe("Sideboard Lab desktop endpoint", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the aggregate with cross-origin no-store headers", async () => {
    mocks.readSideboardLabResponse.mockResolvedValue({ status: "unavailable", drills: [] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "unavailable", drills: [] });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
