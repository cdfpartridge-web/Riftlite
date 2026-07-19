import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAggregate: vi.fn(),
  getFirestoreAdmin: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: mocks.getFirestoreAdmin,
}));

import {
  getCommunityMatchWindow,
  invalidateCommunityMatchMemoryCache,
} from "@/lib/community/data";

describe("community match memory cache", () => {
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
});
