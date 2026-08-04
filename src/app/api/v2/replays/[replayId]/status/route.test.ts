import { beforeEach, describe, expect, it, vi } from "vitest";

const { readOwnerReplayDeliveryStatusMock, requireReplayUserMock } = vi.hoisted(() => ({
  readOwnerReplayDeliveryStatusMock: vi.fn(),
  requireReplayUserMock: vi.fn(),
}));

vi.mock("@/lib/replay-v2-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/replay-v2-server")>("@/lib/replay-v2-server");
  return {
    ...actual,
    readOwnerReplayDeliveryStatus: readOwnerReplayDeliveryStatusMock,
    requireReplayUser: requireReplayUserMock,
  };
});

import { GET } from "@/app/api/v2/replays/[replayId]/status/route";

const REPLAY_ID = `rl2_${"a".repeat(32)}`;

describe("owner replay delivery status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireReplayUserMock.mockResolvedValue("owner-1");
    readOwnerReplayDeliveryStatusMock.mockResolvedValue({
      schema: "riftlite-replay-delivery-status",
      version: 1,
      replayId: REPLAY_ID,
      status: "processing",
      stage: "processing",
      updatedAt: "2026-08-03T12:00:00.000Z",
      retryable: true,
      recommendedAction: "wait",
      retryAfterMs: 5_000,
      warnings: [],
    });
  });

  it("requires a replay owner and returns a bounded no-store status contract", async () => {
    const response = await GET(
      new Request(`https://www.riftlite.com/api/v2/replays/${REPLAY_ID}/status`),
      context(REPLAY_ID),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requireReplayUserMock).toHaveBeenCalledOnce();
    expect(readOwnerReplayDeliveryStatusMock).toHaveBeenCalledWith("owner-1", REPLAY_ID);
    await expect(response.json()).resolves.toEqual({
      replay: expect.objectContaining({
        schema: "riftlite-replay-delivery-status",
        version: 1,
        stage: "processing",
        recommendedAction: "wait",
        retryAfterMs: 5_000,
      }),
    });
  });

  it("rejects an invalid replay id before authenticating", async () => {
    const response = await GET(
      new Request("https://www.riftlite.com/api/v2/replays/not-a-replay/status"),
      context("not-a-replay"),
    );

    expect(response.status).toBe(400);
    expect(requireReplayUserMock).not.toHaveBeenCalled();
    expect(readOwnerReplayDeliveryStatusMock).not.toHaveBeenCalled();
  });
});

function context(replayId: string) {
  return { params: Promise.resolve({ replayId }) };
}
