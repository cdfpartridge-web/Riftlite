import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteOwnerReplayMock, requireReplayViewerUserMock } = vi.hoisted(() => ({
  deleteOwnerReplayMock: vi.fn(),
  requireReplayViewerUserMock: vi.fn(),
}));

vi.mock("@/lib/replay-v2-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/replay-v2-server")>("@/lib/replay-v2-server");
  return {
    ...actual,
    deleteOwnerReplay: deleteOwnerReplayMock,
    requireReplayViewerUser: requireReplayViewerUserMock,
  };
});

import { DELETE } from "@/app/api/v2/replays/[replayId]/route";
import { ReplayV2Error } from "@/lib/replay-v2-server";

const REPLAY_ID = `rl2_${"a".repeat(32)}`;

describe("owner replay deletion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireReplayViewerUserMock.mockResolvedValue("owner-1");
    deleteOwnerReplayMock.mockResolvedValue({ replayId: REPLAY_ID, cleanupComplete: true });
  });

  it("deletes through the authenticated uploader account and never caches the response", async () => {
    const response = await DELETE(
      new Request(`https://www.riftlite.com/api/v2/replays/${REPLAY_ID}`, { method: "DELETE" }),
      context(REPLAY_ID),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requireReplayViewerUserMock).toHaveBeenCalledOnce();
    expect(deleteOwnerReplayMock).toHaveBeenCalledWith("owner-1", REPLAY_ID);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      replayId: REPLAY_ID,
      cleanupComplete: true,
    });
  });

  it("returns an owner-only authorization error without weakening it", async () => {
    deleteOwnerReplayMock.mockRejectedValue(
      new ReplayV2Error(403, "replay_owner_required", "Only the replay owner may perform this action."),
    );

    const response = await DELETE(
      new Request(`https://www.riftlite.com/api/v2/replays/${REPLAY_ID}`, { method: "DELETE" }),
      context(REPLAY_ID),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "replay_owner_required",
      retryable: false,
    });
  });

  it("rejects an invalid replay id before authentication", async () => {
    const response = await DELETE(
      new Request("https://www.riftlite.com/api/v2/replays/not-a-replay", { method: "DELETE" }),
      context("not-a-replay"),
    );

    expect(response.status).toBe(400);
    expect(requireReplayViewerUserMock).not.toHaveBeenCalled();
    expect(deleteOwnerReplayMock).not.toHaveBeenCalled();
  });
});

function context(replayId: string) {
  return { params: Promise.resolve({ replayId }) };
}
