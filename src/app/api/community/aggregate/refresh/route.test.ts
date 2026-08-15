import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFirestoreAdmin: vi.fn(),
  invalidateCommunityMatchMemoryCache: vi.fn(),
  refreshCommunityAggregate: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/firebase/admin", () => ({ getFirestoreAdmin: mocks.getFirestoreAdmin }));
vi.mock("@/lib/community/data", () => ({
  invalidateCommunityMatchMemoryCache: mocks.invalidateCommunityMatchMemoryCache,
  refreshCommunityAggregate: mocks.refreshCommunityAggregate,
}));

import { POST } from "@/app/api/community/aggregate/refresh/route";

const SECRET = "community-refresh-test-secret";

describe("Community aggregate refresh endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_AGGREGATE_SECRET", SECRET);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("skips a duplicate same-day repair when the public source count is unchanged", async () => {
    const fake = fakeDb({
      "community-refresh-state-v1": {
        version: 1,
        completedOn: new Date().toISOString().slice(0, 10),
        publicLifetimeMatchCount: 7_000,
      },
      "community-v1": { publicLifetimeMatchCount: 7_000 },
    });
    mocks.getFirestoreAdmin.mockReturnValue(fake.db);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      skipped: true,
      skipReason: "already-repaired-today",
    });
    expect(mocks.refreshCommunityAggregate).not.toHaveBeenCalled();
    expect(mocks.invalidateCommunityMatchMemoryCache).not.toHaveBeenCalled();
  });

  it("repairs when the append-maintained public count changed and records the guard", async () => {
    const fake = fakeDb({
      "community-refresh-state-v1": {
        version: 1,
        completedOn: new Date().toISOString().slice(0, 10),
        publicLifetimeMatchCount: 6_999,
      },
      "community-v1": { publicLifetimeMatchCount: 7_000 },
    });
    mocks.getFirestoreAdmin.mockReturnValue(fake.db);
    mocks.refreshCommunityAggregate.mockResolvedValue(refreshResult(7_000));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.refreshCommunityAggregate).toHaveBeenCalledOnce();
    expect(fake.stateSet).toHaveBeenCalledWith(expect.objectContaining({
      version: 1,
      publicLifetimeMatchCount: 7_000,
    }));
    expect(mocks.invalidateCommunityMatchMemoryCache).toHaveBeenCalledOnce();
  });

  it("honors force=true even after a same-day repair", async () => {
    const fake = fakeDb({
      "community-refresh-state-v1": {
        version: 1,
        completedOn: new Date().toISOString().slice(0, 10),
        publicLifetimeMatchCount: 7_000,
      },
      "community-v1": { publicLifetimeMatchCount: 7_000 },
    });
    mocks.getFirestoreAdmin.mockReturnValue(fake.db);
    mocks.refreshCommunityAggregate.mockResolvedValue(refreshResult(7_000));

    await POST(request("?force=true"));

    expect(mocks.refreshCommunityAggregate).toHaveBeenCalledOnce();
  });

  it("rejects an unauthorized caller before any Firestore work", async () => {
    const response = await POST(new NextRequest(
      "https://www.riftlite.com/api/community/aggregate/refresh",
      { method: "POST", headers: { authorization: "Bearer wrong" } },
    ));

    expect(response.status).toBe(401);
    expect(mocks.getFirestoreAdmin).not.toHaveBeenCalled();
    expect(mocks.refreshCommunityAggregate).not.toHaveBeenCalled();
  });
});

function request(query = ""): NextRequest {
  return new NextRequest(`https://www.riftlite.com/api/community/aggregate/refresh${query}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

function refreshResult(publicLifetimeMatchCount: number) {
  return {
    matchCount: 7_000,
    publicLifetimeMatchCount,
    publicLifetimePlayerCount: 250,
    publicPlayerIndexReady: true,
    privateMatchCount: 100,
    privatePlayerCount: 20,
    updatedAt: Date.now(),
    source: "firestore" as const,
  };
}

function fakeDb(documents: Record<string, Record<string, unknown>>) {
  const stateSet = vi.fn().mockResolvedValue(undefined);
  const db = {
    collection: vi.fn(() => ({
      doc: (id: string) => ({
        get: vi.fn().mockResolvedValue({
          exists: Boolean(documents[id]),
          data: () => documents[id],
        }),
        set: id === "community-refresh-state-v1"
          ? stateSet
          : vi.fn().mockResolvedValue(undefined),
      }),
    })),
  };
  return { db, stateSet };
}
