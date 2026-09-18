import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAggregate: vi.fn(),
  getFirestoreAdmin: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: mocks.getFirestoreAdmin,
}));

import {
  getCommunityMatchWindow,
  getCommunityRangeMatchWindow,
  invalidateCommunityMatchMemoryCache,
} from "@/lib/community/data";

describe("community match memory cache", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCommunityMatchMemoryCache();
    mocks.getAggregate.mockResolvedValue({
      exists: true,
      data: () => ({
        updatedAt: Date.now(),
        matchesJson: JSON.stringify([{ id: "match-1", uid: "player-1", result: "Win" }]),
      }),
    });
    mocks.getFirestoreAdmin.mockReturnValue({
      collection: () => ({
        doc: () => ({ get: mocks.getAggregate }),
      }),
    });
  });

  it("coalesces cold loads and reuses the full window until invalidated", async () => {
    const [first, second] = await Promise.all([
      getCommunityMatchWindow(),
      getCommunityMatchWindow(),
    ]);

    expect(mocks.getAggregate).toHaveBeenCalledOnce();
    expect(second).toBe(first);
    await expect(getCommunityMatchWindow()).resolves.toBe(first);
    expect(mocks.getAggregate).toHaveBeenCalledOnce();

    invalidateCommunityMatchMemoryCache();
    await getCommunityMatchWindow();
    expect(mocks.getAggregate).toHaveBeenCalledTimes(2);
  });
  it("coalesces large date detail windows without Next's 2 MiB cache limit", async () => {
    const rows = [{ id: "large-match", uid: "player", result: "Win", createdAt: Date.now(), largeSnapshot: "x".repeat(2_100_000) }];
    mocks.getAggregate.mockResolvedValue({ exists: true, data: () => ({ updatedAt: Date.now(), matchesJson: JSON.stringify(rows) }) });
    const [first, second] = await Promise.all([getCommunityRangeMatchWindow(30), getCommunityRangeMatchWindow(30)]);
    expect(second).toBe(first);
    expect(first[0].id).toBe("large-match");
    const reads = mocks.getAggregate.mock.calls.length;
    await expect(getCommunityRangeMatchWindow(30)).resolves.toBe(first);
    expect(mocks.getAggregate.mock.calls.length).toBe(reads);
    invalidateCommunityMatchMemoryCache();
    await getCommunityRangeMatchWindow(30);
    expect(mocks.getAggregate.mock.calls.length).toBeGreaterThan(reads);
  });

  it("expires date detail windows after the existing thirty-minute TTL", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(2_000_000_000_000);
    const first = await getCommunityRangeMatchWindow(7);
    const reads = mocks.getAggregate.mock.calls.length;
    clock.mockReturnValue(2_000_000_000_000 + 1_800_001);
    const second = await getCommunityRangeMatchWindow(7);
    expect(second).not.toBe(first);
    expect(mocks.getAggregate.mock.calls.length).toBeGreaterThan(reads);
  });

  it("clears a failed in-flight range load so the next request can recover", async () => {
    mocks.getAggregate.mockRejectedValueOnce(new Error("temporarily unavailable"));
    await expect(getCommunityRangeMatchWindow(14)).rejects.toThrow("temporarily unavailable");
    await expect(getCommunityRangeMatchWindow(14)).resolves.toHaveLength(1);
    expect(mocks.getAggregate).toHaveBeenCalledTimes(2);
  });

  it("does not cache an old in-flight range after invalidation", async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.getAggregate.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    const old = getCommunityRangeMatchWindow(30);
    invalidateCommunityMatchMemoryCache();
    const fresh = await getCommunityRangeMatchWindow(30);
    resolveOld({ exists: true, data: () => ({ updatedAt: Date.now(), matchesJson: JSON.stringify([{ id: "old" }]) }) });
    await old;
    await expect(getCommunityRangeMatchWindow(30)).resolves.toBe(fresh);
    expect(fresh[0].id).toBe("match-1");
  });

});
