import { gzipSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  isDiscordReplayResultResolvedMock,
  normalizeReplayProviderCaptureMock,
  readCanonicalReplayMock,
  readReplayDiscordRequestReceiptMock,
  readOwnerRawReplayMock,
  shareReplayToDiscordFeedsMock,
  updateReplayVisibilityMock,
  writeReplayDiscordRequestReceiptMock,
} = vi.hoisted(() => ({
  isDiscordReplayResultResolvedMock: vi.fn(),
  normalizeReplayProviderCaptureMock: vi.fn(),
  readCanonicalReplayMock: vi.fn(),
  readReplayDiscordRequestReceiptMock: vi.fn(),
  readOwnerRawReplayMock: vi.fn(),
  shareReplayToDiscordFeedsMock: vi.fn(),
  updateReplayVisibilityMock: vi.fn(),
  writeReplayDiscordRequestReceiptMock: vi.fn(),
}));

vi.mock("@/lib/discord/replay-share-server", () => ({
  shareReplayToDiscordFeeds: shareReplayToDiscordFeedsMock,
}));

vi.mock("@/lib/discord/replay-share", () => ({
  isDiscordReplayResultResolved: isDiscordReplayResultResolvedMock,
}));

vi.mock("@/lib/discord/replay-share-request", () => ({
  readReplayDiscordRequestReceipt: readReplayDiscordRequestReceiptMock,
  writeReplayDiscordRequestReceipt: writeReplayDiscordRequestReceiptMock,
}));

vi.mock("@/lib/replay-v2/provider-normalization", () => ({
  normalizeReplayProviderCapture: normalizeReplayProviderCaptureMock,
}));

vi.mock("@/lib/replay-v2-server", () => {
  class MockReplayV2Error extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    MAX_CANONICAL_JSON_BYTES: 64 * 1024 * 1024,
    MAX_RAW_JSON_BYTES: 64 * 1024 * 1024,
    ReplayV2Error: MockReplayV2Error,
    isReplayId: () => true,
    readBoundedJson: (request: Request) => request.json(),
    readCanonicalReplay: readCanonicalReplayMock,
    readOwnerRawReplay: readOwnerRawReplayMock,
    replayApiError: (error: unknown) => {
      const failure = error as { status?: number; code?: string; message?: string };
      return Response.json({ error: failure.code, message: failure.message }, {
        status: failure.status ?? 500,
      });
    },
    requireReplayUser: async () => "owner-1",
    updateReplayVisibility: updateReplayVisibilityMock,
  };
});

import { POST } from "@/app/api/v2/replays/[replayId]/share-discord/route";

const REPLAY_ID = `rl2_${"a".repeat(32)}`;

describe("Discord replay share eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shareReplayToDiscordFeedsMock.mockResolvedValue([{ hubId: "hub-1", status: "shared" }]);
    readReplayDiscordRequestReceiptMock.mockResolvedValue(null);
    writeReplayDiscordRequestReceiptMock.mockResolvedValue(undefined);
  });

  it("returns a completed request receipt without reopening the replay artifact", async () => {
    readReplayDiscordRequestReceiptMock.mockResolvedValue({
      status: "complete",
      results: [{ hubId: "hub-1", status: "already-shared" }],
    });

    const response = await shareRequest();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, visibility: "unlisted" });
    expect(readCanonicalReplayMock).not.toHaveBeenCalled();
    expect(updateReplayVisibilityMock).not.toHaveBeenCalled();
    expect(shareReplayToDiscordFeedsMock).not.toHaveBeenCalled();
  });

  it("returns a cached pending-result conflict without reopening either artifact", async () => {
    readReplayDiscordRequestReceiptMock.mockResolvedValue({ status: "result-pending" });

    const response = await shareRequest();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "replay_result_pending" });
    expect(readCanonicalReplayMock).not.toHaveBeenCalled();
    expect(readOwnerRawReplayMock).not.toHaveBeenCalled();
  });

  it("does not change TCGA visibility while processing", async () => {
    readCanonicalReplayMock.mockResolvedValue({
      record: { platform: "tcga", status: "processing" },
      bytes: null,
    });

    const response = await shareRequest();

    expect(response.status).toBe(409);
    expect(updateReplayVisibilityMock).not.toHaveBeenCalled();
    expect(shareReplayToDiscordFeedsMock).not.toHaveBeenCalled();
  });

  it("does not change TCGA visibility when its result is unresolved", async () => {
    readCanonicalReplayMock.mockResolvedValue({
      record: { platform: "tcga", status: "ready" },
      bytes: gzipSync(Buffer.from(JSON.stringify({ schema: "riftlite-canonical-replay", version: 2 }))),
    });
    isDiscordReplayResultResolvedMock.mockReturnValue(false);

    const response = await shareRequest();

    expect(response.status).toBe(409);
    expect(updateReplayVisibilityMock).not.toHaveBeenCalled();
    expect(shareReplayToDiscordFeedsMock).not.toHaveBeenCalled();
    expect(writeReplayDiscordRequestReceiptMock).toHaveBeenCalledWith({
      ownerUid: "owner-1",
      replayId: REPLAY_ID,
      hubIds: ["hub-1"],
      receipt: { status: "result-pending" },
    });
  });

  it("makes an eligible replay unlisted immediately before sharing", async () => {
    readCanonicalReplayMock.mockResolvedValue({
      record: { platform: "tcga", status: "ready" },
      bytes: gzipSync(Buffer.from(JSON.stringify({ schema: "riftlite-canonical-replay", version: 2 }))),
    });
    isDiscordReplayResultResolvedMock.mockReturnValue(true);

    const response = await shareRequest();

    expect(response.status).toBe(200);
    expect(updateReplayVisibilityMock).toHaveBeenCalledWith("owner-1", REPLAY_ID, "unlisted");
    expect(updateReplayVisibilityMock.mock.invocationCallOrder[0]).toBeLessThan(
      shareReplayToDiscordFeedsMock.mock.invocationCallOrder[0],
    );
    expect(writeReplayDiscordRequestReceiptMock).toHaveBeenCalledWith({
      ownerUid: "owner-1",
      replayId: REPLAY_ID,
      hubIds: ["hub-1"],
      receipt: { status: "complete", results: [{ hubId: "hub-1", status: "shared" }] },
    });
  });

  it("recovers an older unresolved canonical from its reviewed raw capture", async () => {
    const canonical = { schema: "riftlite-canonical-replay", version: 2, marker: "old" };
    const refreshed = { schema: "riftlite-canonical-replay", version: 2, marker: "refreshed" };
    const rawPayload = { schema: "riftreplay-raw-capture", version: 1 };
    readCanonicalReplayMock.mockResolvedValue({
      record: { platform: "atlas", status: "ready" },
      bytes: gzipSync(Buffer.from(JSON.stringify(canonical))),
    });
    readOwnerRawReplayMock.mockResolvedValue({
      record: { captureId: "capture-1", platform: "atlas" },
      bytes: gzipSync(Buffer.from(JSON.stringify(rawPayload))),
    });
    normalizeReplayProviderCaptureMock.mockReturnValue({
      captureId: "capture-1",
      replay: refreshed,
    });
    isDiscordReplayResultResolvedMock.mockImplementation(
      (replay: { marker?: string }) => replay.marker === "refreshed",
    );

    const response = await shareRequest();

    expect(response.status).toBe(200);
    expect(readOwnerRawReplayMock).toHaveBeenCalledWith("owner-1", REPLAY_ID);
    expect(normalizeReplayProviderCaptureMock)
      .toHaveBeenCalledWith(rawPayload, "atlas", REPLAY_ID);
    expect(shareReplayToDiscordFeedsMock).toHaveBeenCalledWith(
      expect.objectContaining({ replay: refreshed }),
    );
  });
});

function shareRequest(): Promise<Response> {
  return POST(new Request(`https://www.riftlite.com/api/v2/replays/${REPLAY_ID}/share-discord`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hubIds: ["hub-1"] }),
  }), {
    params: Promise.resolve({ replayId: REPLAY_ID }),
  });
}
