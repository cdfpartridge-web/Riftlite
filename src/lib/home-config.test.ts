import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const cache = { populated: false, value: null as unknown };
  return {
    cache,
    getFirestoreAdmin: vi.fn(),
    get: vi.fn(),
    unstableCache: vi.fn((callback: () => Promise<unknown>) => async () => {
      if (!cache.populated) {
        cache.value = await callback();
        cache.populated = true;
      }
      return cache.value;
    }),
  };
});

vi.mock("next/cache", () => ({ unstable_cache: mocks.unstableCache }));
vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: mocks.getFirestoreAdmin,
}));

import {
  getCachedHomeConfig,
  HOME_CONFIG_CACHE_SECONDS,
  HOME_CONFIG_CACHE_TAG,
} from "@/lib/home-config";

describe("shared app Home configuration cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cache.populated = false;
    mocks.cache.value = null;
    mocks.getFirestoreAdmin.mockReturnValue({
      collection: () => ({
        doc: () => ({ get: mocks.get }),
      }),
    });
    mocks.get.mockResolvedValue({
      exists: true,
      data: () => ({
        liveTakeover: { enabled: false },
        updatedAt: { toJSON: () => ({ seconds: 123, nanoseconds: 0 }) },
      }),
    });
  });

  it("shares one serialization-safe Firestore read for the configured TTL", async () => {
    const first = await getCachedHomeConfig();
    const second = await getCachedHomeConfig();

    expect(first).toEqual({
      liveTakeover: { enabled: false },
      updatedAt: { seconds: 123, nanoseconds: 0 },
    });
    expect(second).toEqual(first);
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(HOME_CONFIG_CACHE_SECONDS).toBe(300);
    expect(HOME_CONFIG_CACHE_TAG).toBe("app-home-config-v1");
  });
});
