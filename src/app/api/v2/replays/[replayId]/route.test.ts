import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteOwnerReplayMock, requireReplayViewerUserMock, requireReplayMutationUserMock, readOwnerReplayVisibilityDetailsMock, updateReplayVisibilityMock, serializeReplayMock } = vi.hoisted(() => ({
  deleteOwnerReplayMock: vi.fn(),
  requireReplayViewerUserMock: vi.fn(),
  requireReplayMutationUserMock: vi.fn(),
  readOwnerReplayVisibilityDetailsMock: vi.fn(),
  updateReplayVisibilityMock: vi.fn(),
  serializeReplayMock: vi.fn((record: unknown) => record),
}));

vi.mock("@/lib/replay-v2-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/replay-v2-server")>("@/lib/replay-v2-server");
  return {
    ...actual,
    deleteOwnerReplay: deleteOwnerReplayMock,
    requireReplayViewerUser: requireReplayViewerUserMock,
    requireReplayMutationUser: requireReplayMutationUserMock,
    readOwnerReplayVisibilityDetails: readOwnerReplayVisibilityDetailsMock,
    updateReplayVisibility: updateReplayVisibilityMock,
    serializeReplay: serializeReplayMock,
  };
});

import { DELETE, GET, PATCH } from "@/app/api/v2/replays/[replayId]/route";
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

describe("owner replay visibility routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireReplayViewerUserMock.mockResolvedValue("owner-1");
    requireReplayMutationUserMock.mockResolvedValue("owner-1");
    readOwnerReplayVisibilityDetailsMock.mockResolvedValue({ replayId: REPLAY_ID, title: "Akali vs Irelia", visibility: "unlisted" });
    updateReplayVisibilityMock.mockResolvedValue({ replayId: REPLAY_ID, visibility: "public" });
  });
  it("loads owner-only visibility metadata with the linked session and no caching", async () => {
    const req = new Request(`https://www.riftlite.com/api/v2/replays/${REPLAY_ID}?manage=visibility`);
    const response = await GET(req, context(REPLAY_ID));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requireReplayViewerUserMock).toHaveBeenCalledWith(req);
    expect(readOwnerReplayVisibilityDetailsMock).toHaveBeenCalledWith("owner-1", REPLAY_ID);
    await expect(response.json()).resolves.toMatchObject({ replay: { visibility: "unlisted" } });
  });
  it("saves through the mutation authentication and owner service", async () => {
    const req = new Request(`https://www.riftlite.com/api/v2/replays/${REPLAY_ID}`, { method: "PATCH", body: JSON.stringify({ visibility: "public" }) });
    const response = await PATCH(req, context(REPLAY_ID));
    expect(response.status).toBe(200);
    expect(requireReplayMutationUserMock).toHaveBeenCalledWith(req);
    expect(updateReplayVisibilityMock).toHaveBeenCalledWith("owner-1", REPLAY_ID, "public");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("does not mutate after authentication or ownership failure", async () => {
    requireReplayMutationUserMock.mockRejectedValueOnce(new ReplayV2Error(403, "replay_origin_required", "Wrong origin"));
    const req = () => new Request(`https://www.riftlite.com/api/v2/replays/${REPLAY_ID}`, { method: "PATCH", body: JSON.stringify({ visibility: "public" }) });
    expect((await PATCH(req(), context(REPLAY_ID))).status).toBe(403);
    expect(updateReplayVisibilityMock).not.toHaveBeenCalled();
    updateReplayVisibilityMock.mockRejectedValueOnce(new ReplayV2Error(403, "replay_owner_required", "Only owner"));
    expect((await PATCH(req(), context(REPLAY_ID))).status).toBe(403);
  });
  it("does not fall back to public production data for a failed owner-management read", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    readOwnerReplayVisibilityDetailsMock.mockRejectedValueOnce(new ReplayV2Error(503, "firebase_unavailable", "Unavailable"));
    try {
      const response = await GET(new Request(`http://localhost:3000/api/v2/replays/${REPLAY_ID}?manage=visibility`), context(REPLAY_ID));
      expect(response.status).toBe(503);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});

function context(replayId: string) {
  return { params: Promise.resolve({ replayId }) };
}
