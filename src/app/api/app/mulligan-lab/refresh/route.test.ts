import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshMulliganLabAggregate: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/mulligan-lab/server", () => ({
  refreshMulliganLabAggregate: mocks.refreshMulliganLabAggregate,
}));

import { POST } from "@/app/api/app/mulligan-lab/refresh/route";

const SECRET = "mulligan-refresh-test-secret";

describe("Mulligan Lab refresh endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_AGGREGATE_SECRET", SECRET);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("invalidates the public endpoint after persisting a published snapshot", async () => {
    mocks.refreshMulliganLabAggregate.mockResolvedValue(refreshResult(true));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.revalidatePath).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/api/app/mulligan-lab");
  });

  it("does not evict the prior snapshot when an empty refresh publishes nothing", async () => {
    mocks.refreshMulliganLabAggregate.mockResolvedValue(refreshResult(false));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("forwards a lane-specific backfill limit and explicit force override", async () => {
    mocks.refreshMulliganLabAggregate.mockResolvedValue(refreshResult(false));

    await POST(request("?limit=250&force=true"));

    expect(mocks.refreshMulliganLabAggregate).toHaveBeenCalledWith(250, { force: true });
  });

  it("does not run or invalidate when authorization fails", async () => {
    const response = await POST(new NextRequest(
      "https://www.riftlite.com/api/app/mulligan-lab/refresh",
      { method: "POST", headers: { authorization: "Bearer wrong" } },
    ));

    expect(response.status).toBe(401);
    expect(mocks.refreshMulliganLabAggregate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

function request(query = ""): NextRequest {
  return new NextRequest(`https://www.riftlite.com/api/app/mulligan-lab/refresh${query}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

function refreshResult(published: boolean) {
  return {
    published,
    scanned: 0,
    canonicalLoaded: 0,
    artifactsOpened: 0,
    factsCreated: 0,
    factsRead: 2_005,
    factCoverageTruncated: false,
    backfillComplete: true,
    strictCandidates: 2_005,
    drills: published ? 64 : 0,
    rejected: 0,
    failed: 0,
  };
}
