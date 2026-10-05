import { gzipSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  isDiscordReplayResultResolvedMock,
  normalizeReplayProviderCaptureMock,
  readCanonicalReplayMock,
  readReplayDiscordRequestReceiptMock,
  readOwnerRawReplayMock,
  readOwnerReplayVisibilityMock,
  shareReplayToDiscordFeedsMock,
  updateReplayVisibilityMock,
  writeReplayDiscordRequestReceiptMock,
} = vi.hoisted(() => ({
  isDiscordReplayResultResolvedMock: vi.fn(),
  normalizeReplayProviderCaptureMock: vi.fn(),
  readCanonicalReplayMock: vi.fn(),
  readReplayDiscordRequestReceiptMock: vi.fn(),
  readOwnerRawReplayMock: vi.fn(),
  readOwnerReplayVisibilityMock: vi.fn(),
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
    readOwnerReplayVisibility: readOwnerReplayVisibilityMock,
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
    shareReplayToDiscordFeedsMock.mockImplementation(async ({ beforeFirstPost }: { beforeFirstPost: () => Promise<void> }) => {
      await beforeFirstPost();
      return [{ hubId: "hub-1", status: "shared" }];
    });
    readReplayDiscordRequestReceiptMock.mockResolvedValue(null);
    readOwnerReplayVisibilityMock.mockResolvedValue("unlisted");
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

  it("keeps current private visibility for a cached non-delivery without reopening the replay artifact", async () => {
    readOwnerReplayVisibilityMock.mockResolvedValue("private");
    readReplayDiscordRequestReceiptMock.mockResolvedValue({
      status: "terminal",
      results: [{ hubId: "hub-1", status: "not-configured" }],
    });

    const response = await shareRequest();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false,
      visibility: "private",
      results: [{ hubId: "hub-1", status: "not-configured" }],
    });
    expect(readCanonicalReplayMock).not.toHaveBeenCalled();
  });

  it("reports current privacy if a previously shared replay has since been made private", async () => {
    readOwnerReplayVisibilityMock.mockResolvedValue("private");
    readReplayDiscordRequestReceiptMock.mockResolvedValue({ status: "complete", results: [{ hubId: "hub-1", status: "shared" }] });
    const response = await shareRequest();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, visibility: "private" });
    expect(readOwnerReplayVisibilityMock).toHaveBeenCalledWith("owner-1", REPLAY_ID);
    expect(readCanonicalReplayMock).not.toHaveBeenCalled();
    expect(updateReplayVisibilityMock).not.toHaveBeenCalled();
    expect(shareReplayToDiscordFeedsMock).not.toHaveBeenCalled();
  });

  it("rechecks terminal configuration failures only for an explicit delivery retry", async () => {
    readReplayDiscordRequestReceiptMock.mockResolvedValue({ status: "terminal", results: [{ hubId: "hub-1", status: "not-configured" }] });
    readCanonicalReplayMock.mockResolvedValue({ record: { platform: "atlas", status: "ready", visibility: "private" },
      bytes: gzipSync(Buffer.from(JSON.stringify({ schema: "riftlite-canonical-replay", version: 2 }))) });
    isDiscordReplayResultResolvedMock.mockReturnValue(true);
    const response = await shareRequest({ retryDelivery: true });
    expect(response.status).toBe(200);
    expect(shareReplayToDiscordFeedsMock).toHaveBeenCalledWith(expect.objectContaining({ hubIds: ["hub-1"] }));
    expect(writeReplayDiscordRequestReceiptMock).toHaveBeenCalledWith(expect.objectContaining({ receipt: { status: "complete", results: [{ hubId: "hub-1", status: "shared" }] } }));
  });

  it("does not bypass a successful delivery receipt even for explicit retry", async () => {
    readReplayDiscordRequestReceiptMock.mockResolvedValue({ status: "complete", results: [{ hubId: "hub-1", status: "shared" }] });
    const response = await shareRequest({ retryDelivery: true });
    expect(response.status).toBe(200);
    expect(shareReplayToDiscordFeedsMock).not.toHaveBeenCalled();
    expect(updateReplayVisibilityMock).not.toHaveBeenCalled();
  });

  it("stores settled non-delivery results so later old-client retries stay cheap", async () => {
    readCanonicalReplayMock.mockResolvedValue({
      record: { platform: "tcga", status: "ready", visibility: "private" },
      bytes: gzipSync(Buffer.from(JSON.stringify({ schema: "riftlite-canonical-replay", version: 2 }))),
    });
    isDiscordReplayResultResolvedMock.mockReturnValue(true);
    shareReplayToDiscordFeedsMock.mockResolvedValue([{ hubId: "hub-1", status: "not-configured" }]);

    const response = await shareRequest();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: false, visibility: "private" });
    expect(updateReplayVisibilityMock).not.toHaveBeenCalled();
    expect(writeReplayDiscordRequestReceiptMock).toHaveBeenCalledWith({
      ownerUid: "owner-1",
      replayId: REPLAY_ID,
      hubIds: ["hub-1"],
      receipt: {
        status: "terminal",
        results: [{ hubId: "hub-1", status: "not-configured" }],
      },
    });
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

  it.each(["public", "unlisted"])("preserves current %s visibility for automatic Discord delivery", async (visibility) => {
    readCanonicalReplayMock.mockResolvedValue({ record: { platform: "atlas", status: "ready", visibility: "unlisted" },
      bytes: gzipSync(Buffer.from(JSON.stringify({ schema: "riftlite-canonical-replay", version: 2 }))) });
    isDiscordReplayResultResolvedMock.mockReturnValue(true);
    readOwnerReplayVisibilityMock.mockResolvedValue(visibility);
    const response = await shareRequest({ automatic: true, retryDelivery: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, visibility });
    expect(updateReplayVisibilityMock).not.toHaveBeenCalled();
    expect(readOwnerReplayVisibilityMock).toHaveBeenCalledWith("owner-1", REPLAY_ID);
  });

  it("blocks automatic sharing of an owner's Private replay before attempting delivery", async () => {
    readCanonicalReplayMock.mockResolvedValue({ record: { platform: "atlas", status: "ready", visibility: "private" },
      bytes: gzipSync(Buffer.from(JSON.stringify({ schema: "riftlite-canonical-replay", version: 2 }))) });
    const response = await shareRequest({ automatic: true, retryDelivery: true });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "replay_visibility_changed" });
    expect(shareReplayToDiscordFeedsMock).not.toHaveBeenCalled();
    expect(updateReplayVisibilityMock).not.toHaveBeenCalled();
  });

  it("stops an automatic post if privacy changed while its destination was being prepared", async () => {
    readCanonicalReplayMock.mockResolvedValue({ record: { platform: "atlas", status: "ready", visibility: "unlisted" },
      bytes: gzipSync(Buffer.from(JSON.stringify({ schema: "riftlite-canonical-replay", version: 2 }))) });
    isDiscordReplayResultResolvedMock.mockReturnValue(true);
    readOwnerReplayVisibilityMock.mockResolvedValue("private");
    // The real delivery helper converts a failed before-send guard to a failed
    // destination. The route must still return the terminal privacy error.
    shareReplayToDiscordFeedsMock.mockImplementation(async ({ beforeFirstPost }: { beforeFirstPost: () => Promise<void> }) => {
      try { await beforeFirstPost(); } catch { return [{ hubId: "hub-1", status: "failed" }]; }
      throw new Error("A Private replay should not be posted.");
    });
    const response = await shareRequest({ automatic: true });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "replay_visibility_changed" });
    expect(updateReplayVisibilityMock).not.toHaveBeenCalled();
    expect(writeReplayDiscordRequestReceiptMock).not.toHaveBeenCalled();
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
    expect(shareReplayToDiscordFeedsMock).toHaveBeenCalledWith(expect.objectContaining({ beforeFirstPost: expect.any(Function) }));
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
  it("releases a cached pending result using a reviewed result bound to the owned capture", async () => {
    readReplayDiscordRequestReceiptMock.mockResolvedValue({ status: "result-pending" });
    readCanonicalReplayMock.mockResolvedValue({ record: { platform: "atlas", status: "ready", visibility: "private" },
      bytes: gzipSync(Buffer.from(JSON.stringify({ series: { perspectivePlayerId: "self", participants: [{ id: "opponent" }, { id: "self" }], games: [{ gameNumber: 1 }] } }))) });
    readOwnerRawReplayMock.mockResolvedValue({ record: { platform: "atlas" }, bytes: gzipSync(Buffer.from(JSON.stringify({ capture: { captureSessionId: "capture-reviewed" } }))) });
    isDiscordReplayResultResolvedMock.mockReturnValue(true);
    const response = await shareRequest({ reviewedResult: { captureSessionId: "capture-reviewed", match: {
      format: "bo1", result: "win", score: { perspective: 1, opponent: 0 }, games: [{ gameNumber: 1, result: "win" }]
    } } });
    expect(response.status).toBe(200);
    expect(readOwnerRawReplayMock).toHaveBeenCalledWith("owner-1", REPLAY_ID);
    expect(shareReplayToDiscordFeedsMock).toHaveBeenCalledWith(expect.objectContaining({ ownerUid: "owner-1", hubIds: ["hub-1"],
      replay: expect.objectContaining({ series: expect.objectContaining({ result: expect.objectContaining({ winnerPlayerId: "self" }) }) }) }));
  });

  it("never changes visibility or posts a reviewed result from another capture", async () => {
    readCanonicalReplayMock.mockResolvedValue({ record: { platform: "atlas", status: "ready", visibility: "private" },
      bytes: gzipSync(Buffer.from(JSON.stringify({ series: { perspectivePlayerId: "self", participants: [{ id: "opponent" }, { id: "self" }], games: [{ gameNumber: 1 }] } }))) });
    readOwnerRawReplayMock.mockResolvedValue({ record: { platform: "atlas" }, bytes: gzipSync(Buffer.from(JSON.stringify({ capture: { captureSessionId: "different-capture" } }))) });
    const response = await shareRequest({ reviewedResult: { captureSessionId: "capture-reviewed", match: {
      format: "bo1", result: "win", score: { perspective: 1, opponent: 0 }, games: [{ gameNumber: 1, result: "win" }]
    } } });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "reviewed_result_mismatch" });
    expect(shareReplayToDiscordFeedsMock).not.toHaveBeenCalled();
    expect(updateReplayVisibilityMock).not.toHaveBeenCalled();
  });

});

function shareRequest(extra: Record<string, unknown> = {}): Promise<Response> {
  return POST(new Request(`https://www.riftlite.com/api/v2/replays/${REPLAY_ID}/share-discord`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hubIds: ["hub-1"], ...extra }),
  }), {
    params: Promise.resolve({ replayId: REPLAY_ID }),
  });
}
