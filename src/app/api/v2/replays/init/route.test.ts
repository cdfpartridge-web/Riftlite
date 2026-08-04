import { beforeEach, describe, expect, it, vi } from "vitest";

const { initReplayMock } = vi.hoisted(() => ({ initReplayMock: vi.fn() }));

vi.mock("@/lib/replay-v2-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/replay-v2-server")>("@/lib/replay-v2-server");
  return {
    ...actual,
    initReplay: initReplayMock,
    requireReplayUser: async () => "owner-1",
    serializeReplay: (record: unknown) => record,
  };
});

import { POST } from "@/app/api/v2/replays/init/route";

const REPLAY_ID = `rl2_${"a".repeat(32)}`;

describe("Replay initialization recovery endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initReplayMock.mockResolvedValue({
      created: true,
      uploadRequired: true,
      record: {
        replayId: REPLAY_ID,
        status: "uploading",
        visibility: "private",
        expectedRaw: { sha256: "b".repeat(64), bytes: 100 },
      },
    });
  });

  it("returns stable same-origin resume and status paths", async () => {
    const response = await POST(new Request("https://www.riftlite.com/api/v2/replays/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        captureId: "capture-1",
        sha256: "b".repeat(64),
        bytes: 100,
        visibility: "private",
        platform: "atlas",
      }),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      uploadRequired: true,
      upload: { endpoint: `/api/v2/replays/${REPLAY_ID}/raw` },
      completeEndpoint: `/api/v2/replays/${REPLAY_ID}/complete`,
      statusEndpoint: `/api/v2/replays/${REPLAY_ID}/status`,
      canonicalEndpoint: `/api/v2/replays/${REPLAY_ID}`,
      playerPath: `/replays/${REPLAY_ID}`,
    });
  });
});
