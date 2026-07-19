import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getFirestoreAdminMock, hubAccessMock } = vi.hoisted(() => ({
  getFirestoreAdminMock: vi.fn(),
  hubAccessMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: getFirestoreAdminMock,
}));

vi.mock("@/lib/replay-v2-server/hub-grants", () => ({
  privateReplayHubAccessAllowsViewer: hubAccessMock,
}));

import type { ReplayRecord } from "@/lib/replay-v2-server/model";
import { readCanonicalReplay } from "@/lib/replay-v2-server/service";

const REPLAY_ID = `rl2_${"c".repeat(32)}`;

describe("private Replay V2 reads through hub grants", () => {
  beforeEach(() => {
    getFirestoreAdminMock.mockReset();
    hubAccessMock.mockReset();
    getFirestoreAdminMock.mockReturnValue(replayDb(privateReplay()));
  });

  it("keeps direct owner access without consulting hub grants", async () => {
    await expect(readCanonicalReplay(REPLAY_ID, "owner-uid"))
      .resolves.toMatchObject({ record: { replayId: REPLAY_ID } });
    expect(hubAccessMock).not.toHaveBeenCalled();
  });

  it("allows a signed-in current hub member when the live grant check succeeds", async () => {
    hubAccessMock.mockResolvedValue(true);

    await expect(readCanonicalReplay(REPLAY_ID, "hub-member"))
      .resolves.toMatchObject({ record: { replayId: REPLAY_ID } });
    expect(hubAccessMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ replayId: REPLAY_ID, ownerUid: "owner-uid" }),
      "hub-member",
    );
  });

  it("denies anonymous users, outsiders, and ex-members when the live check fails", async () => {
    hubAccessMock.mockResolvedValue(false);

    await expect(readCanonicalReplay(REPLAY_ID, ""))
      .rejects.toMatchObject({ code: "replay_private", status: 403 });
    await expect(readCanonicalReplay(REPLAY_ID, "outsider"))
      .rejects.toMatchObject({ code: "replay_private", status: 403 });
    await expect(readCanonicalReplay(REPLAY_ID, "ex-member"))
      .rejects.toMatchObject({ code: "replay_private", status: 403 });
  });
});

function privateReplay(): ReplayRecord {
  const now = Timestamp.fromDate(new Date("2026-07-19T12:00:00.000Z"));
  return {
    schema: "riftlite-replay-record",
    version: 2,
    replayId: REPLAY_ID,
    ownerUid: "owner-uid",
    captureId: "capture-private",
    visibility: "private",
    status: "ready",
    title: "Private replay",
    platform: "atlas",
    localReplayId: "",
    matchId: "match-a",
    seriesId: "",
    roomCode: "",
    messageCount: 1,
    expectedRaw: { sha256: "d".repeat(64), bytes: 100 },
    createdAt: now,
    updatedAt: now,
  };
}

function replayDb(record: ReplayRecord) {
  return {
    collection: (collection: string) => ({
      doc: (id: string) => ({
        get: vi.fn(async () => ({
          exists: collection === "replayV2" && id === record.replayId,
          data: () => collection === "replayV2" && id === record.replayId ? record : undefined,
        })),
      }),
    }),
  };
}
