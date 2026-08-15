import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refreshSideboardLabAggregate: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/sideboard-lab/server", () => ({
  refreshSideboardLabAggregate: mocks.refreshSideboardLabAggregate,
}));

import { POST } from "@/app/api/app/sideboard-lab/refresh/route";

describe("Sideboard Lab refresh endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_AGGREGATE_SECRET", "test-secret");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("runs only with the shared protected refresh secret", async () => {
    mocks.refreshSideboardLabAggregate.mockResolvedValue({ published: true });
    const response = await POST(request("test-secret"));
    expect(response.status).toBe(200);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/api/app/sideboard-lab");
  });

  it("rejects unauthorized refreshes without running the job", async () => {
    const response = await POST(request("wrong"));
    expect(response.status).toBe(401);
    expect(mocks.refreshSideboardLabAggregate).not.toHaveBeenCalled();
  });

  it("forwards a lane-specific backfill limit and explicit force override", async () => {
    mocks.refreshSideboardLabAggregate.mockResolvedValue({ published: false });

    await POST(request("test-secret", "?limit=250&force=1"));

    expect(mocks.refreshSideboardLabAggregate).toHaveBeenCalledWith(250, { force: true });
  });
});

function request(secret: string, query = "") {
  return new NextRequest(`https://www.riftlite.com/api/app/sideboard-lab/refresh${query}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}
