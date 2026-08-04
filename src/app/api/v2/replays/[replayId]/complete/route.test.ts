import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeReplayMock } = vi.hoisted(() => ({
  completeReplayMock: vi.fn(),
}));

vi.mock("@/lib/replay-v2-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/replay-v2-server")>("@/lib/replay-v2-server");
  return {
    ...actual,
    completeReplay: completeReplayMock,
    isReplayId: () => true,
    requireReplayUser: async () => "owner-1",
    serializeReplay: (record: unknown) => record,
  };
});

import { POST } from "@/app/api/v2/replays/[replayId]/complete/route";
import { ReplayV2Error } from "@/lib/replay-v2-server";

const REPLAY_ID = `rl2_${"a".repeat(32)}`;

describe("Replay completion override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeReplayMock.mockResolvedValue({
      replayId: REPLAY_ID,
      status: "ready",
      canonicalArtifact: { sha256: "a".repeat(64) },
    });
  });

  it("keeps existing empty-body clients on strict completion", async () => {
    const response = await POST(new Request(completeUrl(), { method: "POST" }), context());

    expect(response.status).toBe(200);
    expect(completeReplayMock).toHaveBeenCalledWith("owner-1", REPLAY_ID, {
      allowIncomplete: false,
    });
  });

  it("treats Vercel's non-null zero-byte request stream as strict completion", async () => {
    const request = new Request(completeUrl(), {
      method: "POST",
      body: new Uint8Array(),
    });
    expect(request.body).not.toBeNull();

    const response = await POST(request, context());

    expect(response.status).toBe(200);
    expect(completeReplayMock).toHaveBeenCalledWith("owner-1", REPLAY_ID, {
      allowIncomplete: false,
    });
  });

  it("passes an explicit incomplete-capture override to the owner-only service", async () => {
    completeReplayMock.mockResolvedValueOnce({
      replayId: REPLAY_ID,
      status: "ready",
      canonicalArtifact: { sha256: "a".repeat(64) },
      warnings: [{
        code: "replay_capture_missing_mulligan",
        message: "The replay did not capture the opening mulligan.",
      }],
    });
    const response = await POST(new Request(completeUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowIncomplete: true }),
    }), context());

    expect(response.status).toBe(200);
    expect(completeReplayMock).toHaveBeenCalledWith("owner-1", REPLAY_ID, {
      allowIncomplete: true,
    });
    await expect(response.json()).resolves.toMatchObject({
      statusEndpoint: `/api/v2/replays/${REPLAY_ID}/status`,
      replay: {
        status: "ready",
        warnings: [{
          code: "replay_capture_missing_mulligan",
          message: "The replay did not capture the opening mulligan.",
        }],
      },
    });
  });

  it("returns structured processing recovery fields and Retry-After", async () => {
    completeReplayMock.mockRejectedValueOnce(new ReplayV2Error(
      425,
      "replay_processing",
      "Replay processing is still in progress. Retry shortly.",
    ));

    const response = await POST(new Request(completeUrl(), { method: "POST" }), context());

    expect(response.status).toBe(425);
    expect(response.headers.get("retry-after")).toBe("5");
    await expect(response.json()).resolves.toEqual({
      error: "Replay processing is still in progress. Retry shortly.",
      code: "replay_processing",
      errorClass: "processing",
      retryable: true,
      recommendedAction: "wait",
      retryAfterMs: 5_000,
    });
  });

  it("returns the stable missing-mulligan override action without changing its message", async () => {
    completeReplayMock.mockRejectedValueOnce(new ReplayV2Error(
      422,
      "replay_capture_missing_mulligan",
      "Replay capture is incomplete: The replay did not capture the opening mulligan.",
    ));

    const response = await POST(new Request(completeUrl(), { method: "POST" }), context());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Replay capture is incomplete: The replay did not capture the opening mulligan.",
      code: "replay_capture_missing_mulligan",
      errorClass: "capture",
      retryable: false,
      recommendedAction: "upload-incomplete",
    });
  });

  it("rejects unknown completion controls", async () => {
    const response = await POST(new Request(completeUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowEverything: true }),
    }), context());

    expect(response.status).toBe(400);
    expect(completeReplayMock).not.toHaveBeenCalled();
  });

  it("rejects a non-empty malformed completion body", async () => {
    const response = await POST(new Request(completeUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }), context());

    expect(response.status).toBe(400);
    expect(completeReplayMock).not.toHaveBeenCalled();
  });
});

function completeUrl(): string {
  return `https://www.riftlite.com/api/v2/replays/${REPLAY_ID}/complete`;
}

function context() {
  return { params: Promise.resolve({ replayId: REPLAY_ID }) };
}
