import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listOwnerReplays: vi.fn(),
  listPublicReplays: vi.fn(),
  requireReplayViewerUser: vi.fn(),
}));

vi.mock("@/lib/replay-v2-server", () => ({
  ReplayV2Error: class ReplayV2Error extends Error {},
  listOwnerReplays: mocks.listOwnerReplays,
  listPublicReplays: mocks.listPublicReplays,
  normalizeListLimit: (value: string | null) => value ? Number(value) : 48,
  replayApiError: (error: unknown) => Response.json(
    { error: error instanceof Error ? error.message : "Replay request failed." },
    { status: 500 },
  ),
  requireReplayViewerUser: mocks.requireReplayViewerUser,
}));

import { GET } from "@/app/api/v2/replays/route";

describe("public replay list API pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the opaque cursor and returns continuation metadata", async () => {
    mocks.listPublicReplays.mockResolvedValue({
      items: [{ replayId: "rl2_public" }],
      hasMore: true,
      nextCursor: "next-page-token",
    });

    const response = await GET(new Request(
      "https://www.riftlite.com/api/v2/replays?scope=public&limit=24&cursor=current-page-token",
    ));

    expect(mocks.listPublicReplays).toHaveBeenCalledWith(24, "current-page-token");
    expect(mocks.requireReplayViewerUser).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      items: [{ replayId: "rl2_public" }],
      count: 1,
      scope: "public",
      pageInfo: {
        hasMore: true,
        nextCursor: "next-page-token",
      },
    });
  });
});
