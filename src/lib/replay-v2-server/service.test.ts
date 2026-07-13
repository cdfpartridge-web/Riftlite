import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getFirestoreAdminMock } = vi.hoisted(() => ({
  getFirestoreAdminMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: getFirestoreAdminMock,
}));

import { InitReplaySchema } from "@/lib/replay-v2-server/contracts";
import { deterministicReplayId } from "@/lib/replay-v2-server/ids";
import type { ReplayRecord } from "@/lib/replay-v2-server/model";
import { initReplay, serializeReplay, updateReplayVisibility } from "@/lib/replay-v2-server/service";

describe("replay captured-time persistence", () => {
  beforeEach(() => {
    getFirestoreAdminMock.mockReset();
  });

  it("stores capturedAt on a new replay and owner summary", async () => {
    const fake = fakeReplayDb();
    getFirestoreAdminMock.mockReturnValue(fake.db);
    const input = replayInput("2026-07-09T18:00:12.000Z");

    const result = await initReplay("owner-1", input);

    expect(result.created).toBe(true);
    const created = fake.transaction.create.mock.calls[0]?.[1] as ReplayRecord;
    expect(timestampIso(created.capturedAt)).toBe("2026-07-09T18:00:12.000Z");
    expect(fake.transaction.set).toHaveBeenCalledOnce();
    expect(timestampIso(fake.transaction.set.mock.calls[0]?.[1]?.capturedAt)).toBe("2026-07-09T18:00:12.000Z");
  });

  it("backfills an existing replay and both ready public summaries", async () => {
    const existing = replayRecord();
    const fake = fakeReplayDb(existing);
    getFirestoreAdminMock.mockReturnValue(fake.db);

    const result = await initReplay("owner-1", replayInput("2026-07-09T18:00:12.000Z"));

    expect(result.created).toBe(false);
    expect(fake.transaction.update).toHaveBeenCalledOnce();
    expect(timestampIso(fake.transaction.update.mock.calls[0]?.[1]?.capturedAt)).toBe("2026-07-09T18:00:12.000Z");
    expect(fake.transaction.set).toHaveBeenCalledTimes(2);
    expect(fake.transaction.set.mock.calls.map((call) => call[0].path)).toEqual([
      `replayV2Owners/owner-1/items/${existing.replayId}`,
      `replayV2Public/${existing.replayId}`,
    ]);
    expect(serializeReplay(result.record, true).capturedAt).toBe("2026-07-09T18:00:12.000Z");
    expect(result.record.updatedAt).toBe(existing.updatedAt);
  });

  it("does not replace an existing immutable capture time on retry", async () => {
    const existing = {
      ...replayRecord(),
      capturedAt: Timestamp.fromDate(new Date("2026-07-08T12:00:00.000Z")),
    };
    const fake = fakeReplayDb(existing);
    getFirestoreAdminMock.mockReturnValue(fake.db);

    const result = await initReplay("owner-1", replayInput("2026-07-09T18:00:12.000Z"));

    expect(fake.transaction.update).not.toHaveBeenCalled();
    expect(fake.transaction.set).not.toHaveBeenCalled();
    expect(serializeReplay(result.record, true).capturedAt).toBe("2026-07-08T12:00:00.000Z");
  });

  it("keeps unlisted replays in the owner library and removes them from the public index", async () => {
    const existing = replayRecord();
    const fake = fakeReplayDb(existing);
    getFirestoreAdminMock.mockReturnValue(fake.db);

    const result = await updateReplayVisibility("owner-1", existing.replayId, "unlisted");

    expect(result.visibility).toBe("unlisted");
    expect(fake.transaction.set.mock.calls[0]?.[0]?.path).toBe(`replayV2Owners/owner-1/items/${existing.replayId}`);
    expect(fake.transaction.delete.mock.calls[0]?.[0]?.path).toBe(`replayV2Public/${existing.replayId}`);
  });
});

function replayInput(capturedAt: string) {
  return InitReplaySchema.parse({
    captureId: "capture-1",
    sha256: "a".repeat(64),
    bytes: 1_024,
    visibility: "public",
    capturedAt,
  });
}

function replayRecord(): ReplayRecord {
  const now = Timestamp.fromDate(new Date("2026-07-10T15:40:00.000Z"));
  return {
    schema: "riftlite-replay-record",
    version: 2,
    replayId: deterministicReplayId("owner-1", "capture-1"),
    ownerUid: "owner-1",
    captureId: "capture-1",
    visibility: "public",
    status: "ready",
    title: "Replay",
    platform: "atlas",
    localReplayId: "",
    matchId: "",
    seriesId: "",
    roomCode: "",
    messageCount: 10,
    expectedRaw: { sha256: "a".repeat(64), bytes: 1_024 },
    failure: null,
    createdAt: now,
    updatedAt: now,
  };
}

function fakeReplayDb(existing?: ReplayRecord) {
  const snapshot = {
    exists: Boolean(existing),
    data: () => existing,
  };
  const transaction = {
    get: vi.fn(async () => snapshot),
    create: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };
  const db = {
    collection: (name: string) => collectionReference(name),
    runTransaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
  };
  return { db, transaction };
}

function collectionReference(path: string) {
  return {
    path,
    doc: (id: string) => documentReference(`${path}/${id}`),
  };
}

function documentReference(path: string) {
  return {
    path,
    collection: (name: string) => collectionReference(`${path}/${name}`),
  };
}

function timestampIso(value: unknown): string {
  return value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function"
    ? value.toDate().toISOString()
    : "";
}
