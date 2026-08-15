import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  communityAggregateSourceWatermark: vi.fn(),
  getFirestoreAdmin: vi.fn(),
  invalidateCommunityMatchMemoryCache: vi.fn(),
  refreshCommunityAggregate: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/firebase/admin", () => ({ getFirestoreAdmin: mocks.getFirestoreAdmin }));
vi.mock("@/lib/community/data", () => ({
  communityAggregateSourceWatermark: mocks.communityAggregateSourceWatermark,
  invalidateCommunityMatchMemoryCache: mocks.invalidateCommunityMatchMemoryCache,
  refreshCommunityAggregate: mocks.refreshCommunityAggregate,
}));

import { POST } from "@/app/api/community/aggregate/refresh/route";

const SECRET = "community-refresh-test-secret";

describe("Community aggregate refresh endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_AGGREGATE_SECRET", SECRET);
    mocks.communityAggregateSourceWatermark.mockResolvedValue({
      cacheReady: true,
      current: { changedAtMs: 42, documentId: "change-42" },
      latest: { changedAtMs: 42, documentId: "change-42" },
      pending: false,
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("skips a duplicate same-day repair when the public source count is unchanged", async () => {
    const fake = fakeDb({
      "community-refresh-state-v1": {
        version: 2,
        completedOn: new Date().toISOString().slice(0, 10),
        publicLifetimeMatchCount: 7_000,
        cursorChangedAtMs: 42,
        cursorDocumentId: "change-42",
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
        version: 2,
        completedOn: new Date().toISOString().slice(0, 10),
        publicLifetimeMatchCount: 6_999,
        cursorChangedAtMs: 42,
        cursorDocumentId: "change-42",
      },
      "community-v1": { publicLifetimeMatchCount: 7_000 },
    });
    mocks.getFirestoreAdmin.mockReturnValue(fake.db);
    mocks.refreshCommunityAggregate.mockResolvedValue(refreshResult(7_000));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.refreshCommunityAggregate).toHaveBeenCalledOnce();
    expect(fake.stateSet).toHaveBeenCalledWith(expect.objectContaining({
      version: 2,
      publicLifetimeMatchCount: 7_000,
      cursorChangedAtMs: 42,
      cursorDocumentId: "change-42",
    }));
    expect(mocks.invalidateCommunityMatchMemoryCache).toHaveBeenCalledOnce();
  });

  it("honors force=true even after a same-day repair", async () => {
    const fake = fakeDb({
      "community-refresh-state-v1": {
        version: 2,
        completedOn: new Date().toISOString().slice(0, 10),
        publicLifetimeMatchCount: 7_000,
        cursorChangedAtMs: 42,
        cursorDocumentId: "change-42",
      },
      "community-v1": { publicLifetimeMatchCount: 7_000 },
    });
    mocks.getFirestoreAdmin.mockReturnValue(fake.db);
    mocks.refreshCommunityAggregate.mockResolvedValue(refreshResult(7_000));

    await POST(request("?force=true"));

    expect(mocks.refreshCommunityAggregate).toHaveBeenCalledWith({
      forceFullReconcile: true,
    });
  });

  it("can bypass the same-day guard without forcing a full reconciliation", async () => {
    const fake = fakeDb({
      "community-refresh-state-v1": {
        version: 2,
        completedOn: new Date().toISOString().slice(0, 10),
        publicLifetimeMatchCount: 7_000,
        cursorChangedAtMs: 42,
        cursorDocumentId: "change-42",
      },
      "community-v1": { publicLifetimeMatchCount: 7_000 },
    });
    mocks.getFirestoreAdmin.mockReturnValue(fake.db);
    mocks.refreshCommunityAggregate.mockResolvedValue(refreshResult(7_000));

    await POST(request("?incremental=true"));

    expect(mocks.communityAggregateSourceWatermark).not.toHaveBeenCalled();
    expect(mocks.refreshCommunityAggregate).toHaveBeenCalledWith({
      forceFullReconcile: false,
    });
  });

  it("repairs again when a corrected match is newer than the source cursor", async () => {
    const fake = fakeDb({
      "community-refresh-state-v1": {
        version: 2,
        completedOn: new Date().toISOString().slice(0, 10),
        publicLifetimeMatchCount: 7_000,
        cursorChangedAtMs: 42,
        cursorDocumentId: "change-42",
      },
      "community-v1": { publicLifetimeMatchCount: 7_000 },
    });
    mocks.getFirestoreAdmin.mockReturnValue(fake.db);
    mocks.communityAggregateSourceWatermark.mockResolvedValue({
      cacheReady: true,
      current: { changedAtMs: 42, documentId: "change-42" },
      latest: { changedAtMs: 43, documentId: "change-43" },
      pending: true,
    });
    mocks.refreshCommunityAggregate.mockResolvedValue(refreshResult(7_000));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.refreshCommunityAggregate).toHaveBeenCalledWith({
      forceFullReconcile: false,
    });
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
    refreshMode: "incremental" as const,
    sourceMatchCount: 7_000,
    sourceShardReads: 56,
    sourceChangeReads: 3,
    changesApplied: 3,
    invalidChanges: 0,
    cursorChangedAtMs: 42,
    cursorDocumentId: "change-42",
    legacyTimestampComplete: true,
    legacyMatchesMigrated: 0,
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
