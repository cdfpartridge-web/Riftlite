import { gzipSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  isDiscordReplayResultResolvedMock,
  readCanonicalReplayMock,
  shareReplayToDiscordFeedsMock,
  updateReplayVisibilityMock,
} = vi.hoisted(() => ({
  isDiscordReplayResultResolvedMock: vi.fn(),
  readCanonicalReplayMock: vi.fn(),
  shareReplayToDiscordFeedsMock: vi.fn(),
  updateReplayVisibilityMock: vi.fn(),
}));

vi.mock("@/lib/discord/replay-share-server", () => ({
  shareReplayToDiscordFeeds: shareReplayToDiscordFeedsMock,
}));

vi.mock("@/lib/discord/replay-share", () => ({
  isDiscordReplayResultResolved: isDiscordReplayResultResolvedMock,
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
    ReplayV2Error: MockReplayV2Error,
    isReplayId: () => true,
    readBoundedJson: (request: Request) => request.json(),
    readCanonicalReplay: readCanonicalReplayMock,
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
    shareReplayToDiscordFeedsMock.mockResolvedValue([{ status: "shared" }]);
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
