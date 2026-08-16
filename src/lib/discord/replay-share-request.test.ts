import { beforeEach, describe, expect, it, vi } from "vitest";

const { getFirestoreAdminMock } = vi.hoisted(() => ({
  getFirestoreAdminMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({ getFirestoreAdmin: getFirestoreAdminMock }));

import {
  readReplayDiscordRequestReceipt,
  writeReplayDiscordRequestReceipt,
} from "@/lib/discord/replay-share-request";

describe("Discord replay request receipts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("round-trips a completed request using a canonical hub set", async () => {
    const fake = fakeReceiptDb();
    getFirestoreAdminMock.mockReturnValue(fake.db);
    await writeReplayDiscordRequestReceipt({
      ownerUid: "owner-1",
      replayId: "replay-1",
      hubIds: ["hub-b", "hub-a", "hub-a"],
      receipt: {
        status: "complete",
        results: [
          { hubId: "hub-a", status: "shared" },
          { hubId: "hub-b", status: "already-shared" },
        ],
      },
    });

    await expect(readReplayDiscordRequestReceipt({
      ownerUid: "owner-1",
      replayId: "replay-1",
      hubIds: ["hub-a", "hub-b"],
    })).resolves.toMatchObject({ status: "complete" });
    expect(fake.values[0]?.hubIds).toEqual(["hub-a", "hub-b"]);
  });

  it("expires a pending-result circuit breaker so the result can be checked again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T10:00:00.000Z"));
    const fake = fakeReceiptDb();
    getFirestoreAdminMock.mockReturnValue(fake.db);
    await writeReplayDiscordRequestReceipt({
      ownerUid: "owner-1",
      replayId: "replay-1",
      hubIds: ["hub-a"],
      receipt: { status: "result-pending" },
    });

    await expect(readReplayDiscordRequestReceipt({
      ownerUid: "owner-1",
      replayId: "replay-1",
      hubIds: ["hub-a"],
    })).resolves.toEqual({ status: "result-pending" });

    vi.advanceTimersByTime(6 * 60 * 60 * 1_000 + 1);
    await expect(readReplayDiscordRequestReceipt({
      ownerUid: "owner-1",
      replayId: "replay-1",
      hubIds: ["hub-a"],
    })).resolves.toBeNull();
  });
});

function fakeReceiptDb() {
  const values: Array<Record<string, unknown>> = [];
  const document = {
    get: vi.fn(async () => ({
      exists: Boolean(values.length),
      data: () => values.at(-1),
    })),
    set: vi.fn(async (value: Record<string, unknown>) => {
      values.push(value);
    }),
  };
  return {
    values,
    db: {
      collection: vi.fn(() => ({ doc: vi.fn(() => document) })),
    },
  };
}
