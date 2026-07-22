import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getFirestoreAdminMock } = vi.hoisted(() => ({
  getFirestoreAdminMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: getFirestoreAdminMock,
}));

import { InitReplaySchema } from "@/lib/replay-v2-server/contracts";
import { REPLAY_PROCESSING_RETRY_STATUS } from "@/lib/replay-v2-server/constants";
import { deterministicReplayId } from "@/lib/replay-v2-server/ids";
import type { ReplayRecord } from "@/lib/replay-v2-server/model";
import {
  completeReplay,
  initReplay,
  listOwnerReplays,
  listPublicReplays,
  readCanonicalReplay,
  serializeReplay,
  updateReplayVisibility,
} from "@/lib/replay-v2-server/service";

describe("public replay cursor pagination", () => {
  beforeEach(() => {
    getFirestoreAdminMock.mockReset();
  });

  it("returns a stable continuation cursor and resumes after the last visible document", async () => {
    const ids = [
      deterministicReplayId("owner-1", "public-3"),
      deterministicReplayId("owner-1", "public-2"),
      deterministicReplayId("owner-1", "public-1"),
    ];
    const timestamps = [
      Timestamp.fromDate(new Date("2026-07-21T12:03:00.000Z")),
      Timestamp.fromDate(new Date("2026-07-21T12:02:00.000Z")),
      Timestamp.fromDate(new Date("2026-07-21T12:01:00.000Z")),
    ];
    const firstQuery = fakePublicReplayQuery(ids.map((id, index) => (
      publicReplayDocument(id, timestamps[index])
    )));
    getFirestoreAdminMock.mockReturnValue({ collection: vi.fn(() => firstQuery) });

    const firstPage = await listPublicReplays(2);

    expect(firstPage.items.map((item) => item.replayId)).toEqual(ids.slice(0, 2));
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstQuery.limit).toHaveBeenCalledWith(3);
    expect(firstQuery.orderBy).toHaveBeenCalledTimes(2);
    expect(firstQuery.startAfter).not.toHaveBeenCalled();

    const secondQuery = fakePublicReplayQuery([publicReplayDocument(ids[2], timestamps[2])]);
    getFirestoreAdminMock.mockReturnValue({ collection: vi.fn(() => secondQuery) });

    const secondPage = await listPublicReplays(2, firstPage.nextCursor ?? "");

    expect(secondQuery.startAfter).toHaveBeenCalledWith(timestamps[1], ids[1]);
    expect(secondPage.items.map((item) => item.replayId)).toEqual([ids[2]]);
    expect(secondPage).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("rejects a tampered cursor before issuing a Firestore query", async () => {
    const tampered = Buffer.from(JSON.stringify({
      v: 1,
      s: 1_753_099_200,
      n: 0,
      id: "../replayV2Owners/private",
    })).toString("base64url");

    await expect(listPublicReplays(48, tampered)).rejects.toMatchObject({
      status: 400,
      code: "invalid_replay_cursor",
    });
    expect(getFirestoreAdminMock).not.toHaveBeenCalled();
  });
});

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

  it("rejects an idempotent retry that changes the replay provider", async () => {
    const existing = replayRecord();
    const fake = fakeReplayDb(existing);
    getFirestoreAdminMock.mockReturnValue(fake.db);
    const input = { ...replayInput("2026-07-09T18:00:12.000Z"), platform: "tcga" as const };

    await expect(initReplay("owner-1", input)).rejects.toMatchObject({
      status: 409,
      code: "capture_provider_conflict",
    });
    expect(fake.transaction.update).not.toHaveBeenCalled();
    expect(fake.transaction.set).not.toHaveBeenCalled();
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

describe("replay completion concurrency", () => {
  beforeEach(() => {
    getFirestoreAdminMock.mockReset();
  });

  it("joins an in-flight completion and returns the ready replay", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-21T16:00:00.000Z"));
      const processing = processingReplayRecord();
      const ready = readyReplayRecord(processing);
      const fake = fakeReplayDb(processing, [processing, ready]);
      getFirestoreAdminMock.mockReturnValue(fake.db);

      const completion = completeReplay("owner-1", processing.replayId);
      const assertion = expect(completion).resolves.toMatchObject({
        status: "ready",
        canonicalArtifact: ready.canonicalArtifact,
      });
      await vi.runAllTimersAsync();
      await assertion;

      expect(fake.directGet).toHaveBeenCalledTimes(2);
      expect(fake.transaction.update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a still-running completion with the uploader's retryable status", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-21T16:00:00.000Z"));
      const processing = processingReplayRecord();
      const fake = fakeReplayDb(processing);
      getFirestoreAdminMock.mockReturnValue(fake.db);

      const completion = completeReplay("owner-1", processing.replayId);
      const assertion = expect(completion).rejects.toMatchObject({
        status: REPLAY_PROCESSING_RETRY_STATUS,
        code: "replay_processing",
      });
      await vi.runAllTimersAsync();
      await assertion;

      expect(REPLAY_PROCESSING_RETRY_STATUS).toBe(425);
      expect(fake.directGet).toHaveBeenCalledTimes(5);
      expect(fake.transaction.update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("historical replay owner aliases", () => {
  beforeEach(() => {
    getFirestoreAdminMock.mockReset();
  });

  it("lists a replay from an incomplete historical owner index", async () => {
    const record = { ...replayRecord(), replayId: "historical-replay", ownerUid: "desktop-alias", status: "uploading" as const };
    const fake = fakeAliasReplayDb(record, false);
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await expect(listOwnerReplays("owner-1", 20)).resolves.toEqual([
      expect.objectContaining({ replayId: "historical-replay", captureId: record.captureId }),
    ]);
    expect(fake.queriedOwnerIndexes).toEqual(["owner-1", "desktop-alias"]);
  });

  it("authorizes a proven alias-owned replay and opportunistically writes its canonical owner index", async () => {
    const record = {
      ...replayRecord(),
      replayId: "historical-replay",
      ownerUid: "desktop-alias",
      visibility: "private" as const,
    };
    const fake = fakeAliasReplayDb(record, false);
    getFirestoreAdminMock.mockReturnValue(fake.db);

    const updated = await updateReplayVisibility("owner-1", record.replayId, "unlisted");

    expect(updated.visibility).toBe("unlisted");
    expect(fake.transaction.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: `replayV2Owners/owner-1/items/${record.replayId}` }),
      expect.objectContaining({ replayId: record.replayId }),
    );
    await expect(readCanonicalReplay(record.replayId, "owner-1"))
      .resolves.toMatchObject({ record: { ownerUid: "desktop-alias" } });
  });

  it("stops scanning a historical owner index once reference migration is complete", async () => {
    const record = { ...replayRecord(), replayId: "historical-replay", ownerUid: "desktop-alias", status: "uploading" as const };
    const fake = fakeAliasReplayDb(record, true);
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await expect(listOwnerReplays("owner-1", 20)).resolves.toEqual([]);
    expect(fake.queriedOwnerIndexes).toEqual(["owner-1"]);
  });

  it("resumes the alias-derived permanent replay id after account migration", async () => {
    const record = {
      ...replayRecord(),
      replayId: deterministicReplayId("desktop-alias", "capture-1"),
      ownerUid: "desktop-alias",
      status: "uploading" as const,
      capturedAt: Timestamp.fromDate(new Date("2026-07-09T18:00:12.000Z")),
    };
    const fake = fakeAliasReplayDb(record, false);
    getFirestoreAdminMock.mockReturnValue(fake.db);

    const result = await initReplay("owner-1", replayInput("2026-07-09T18:00:12.000Z"));

    expect(result).toMatchObject({
      created: false,
      uploadRequired: true,
      record: { replayId: record.replayId, ownerUid: "desktop-alias" },
    });
    expect(fake.transaction.create).not.toHaveBeenCalled();
    expect(fake.transaction.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: `replayV2Owners/owner-1/items/${record.replayId}` }),
      expect.objectContaining({ replayId: record.replayId }),
    );
  });

  it("does not probe replay ids from an unproven user-record alias", async () => {
    const record = {
      ...replayRecord(),
      replayId: deterministicReplayId("desktop-alias", "capture-1"),
      ownerUid: "desktop-alias",
      status: "uploading" as const,
      capturedAt: Timestamp.fromDate(new Date("2026-07-09T18:00:12.000Z")),
    };
    const fake = fakeAliasReplayDb(record, false, ["injected-unrelated-uid"]);
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await expect(initReplay("owner-1", replayInput("2026-07-09T18:00:12.000Z")))
      .resolves.toMatchObject({ record: { replayId: record.replayId } });

    expect(fake.transactionReplayReads).toEqual([
      `replayV2/${deterministicReplayId("owner-1", "capture-1")}`,
      `replayV2/${deterministicReplayId("desktop-alias", "capture-1")}`,
    ]);
    expect(fake.transactionReplayReads).not.toContain(
      `replayV2/${deterministicReplayId("injected-unrelated-uid", "capture-1")}`,
    );
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

function processingReplayRecord(): ReplayRecord {
  const current = replayRecord();
  return {
    ...current,
    status: "processing",
    processingGeneration: `canonical_${"b".repeat(32)}`,
    rawArtifact: {
      provider: "vercel-blob",
      kind: "raw",
      generation: `raw_${"a".repeat(32)}`,
      pathname: "unused-in-processing-race",
      sha256: "a".repeat(64),
      bytes: 1_024,
      contentType: "application/gzip",
    },
    updatedAt: Timestamp.now(),
  };
}

function readyReplayRecord(processing: ReplayRecord): ReplayRecord {
  return {
    ...processing,
    status: "ready",
    processingGeneration: "",
    canonicalArtifact: {
      provider: "vercel-blob",
      kind: "canonical",
      generation: `canonical_${"c".repeat(32)}`,
      pathname: "unused-ready-canonical",
      sha256: "c".repeat(64),
      bytes: 2_048,
      contentType: "application/gzip",
    },
    updatedAt: Timestamp.now(),
  };
}

function fakeReplayDb(existing?: ReplayRecord, directReads: ReplayRecord[] = []) {
  const snapshotFor = (record?: ReplayRecord) => ({
    exists: Boolean(record),
    data: () => record,
  });
  const snapshot = snapshotFor(existing);
  let directReadIndex = 0;
  const directGet = vi.fn(async () => {
    const record = directReads.length
      ? directReads[Math.min(directReadIndex, directReads.length - 1)]
      : existing;
    directReadIndex += 1;
    return snapshotFor(record);
  });
  const transaction = {
    get: vi.fn(async () => snapshot),
    create: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };
  const db = {
    collection: (name: string) => collectionReference(name, directGet),
    runTransaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
  };
  return { db, directGet, transaction };
}

function collectionReference(path: string, get: () => Promise<unknown>) {
  return {
    path,
    doc: (id: string) => documentReference(`${path}/${id}`, get),
  };
}

function documentReference(path: string, get: () => Promise<unknown>) {
  const isReplayRecord = path.startsWith("replayV2/") && path.split("/").length === 2;
  return {
    path,
    get: isReplayRecord ? get : async () => ({ exists: false, data: () => undefined }),
    collection: (name: string) => collectionReference(`${path}/${name}`, get),
  };
}

function fakeAliasReplayDb(
  record: ReplayRecord,
  migrationComplete: boolean,
  unprovenAliases: string[] = [],
) {
  const documents = new Map<string, Record<string, unknown>>([
    ["users/owner-1", {
      canonicalUid: "owner-1",
      identityAliases: ["owner-1", "desktop-alias", ...unprovenAliases],
    }],
    ["users/desktop-alias", { canonicalUid: "owner-1", identityAliases: ["owner-1", "desktop-alias"] }],
    ["identityAliases/owner-1", { sourceUid: "owner-1", canonicalUid: "owner-1", migrationCompletedAt: 1 }],
    ["identityAliases/desktop-alias", {
      sourceUid: "desktop-alias",
      canonicalUid: "owner-1",
      ...(migrationComplete ? { migrationCompletedAt: 1 } : { migrationError: "retry required" }),
    }],
    [`replayV2/${record.replayId}`, record as unknown as Record<string, unknown>],
    [`replayV2Owners/desktop-alias/items/${record.replayId}`, {
      replayId: record.replayId,
      captureId: record.captureId,
      visibility: record.visibility,
      status: record.status,
      title: record.title,
      platform: record.platform,
      roomCode: record.roomCode,
      messageCount: record.messageCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }],
  ]);
  const queriedOwnerIndexes: string[] = [];
  const transactionReplayReads: string[] = [];
  type Ref = ReturnType<typeof refFor>;
  const snapshot = (path: string) => ({
    exists: documents.has(path),
    data: () => documents.get(path),
  });
  function refFor(path: string): {
    path: string;
    get: () => Promise<ReturnType<typeof snapshot>>;
    collection: (name: string) => ReturnType<typeof collectionFor>;
  } {
    return {
      path,
      get: async () => snapshot(path),
      collection: (name) => collectionFor(`${path}/${name}`),
    };
  }
  function collectionFor(path: string): {
    path: string;
    doc: (id: string) => ReturnType<typeof refFor>;
    orderBy: () => { limit: () => { get: () => Promise<{ docs: Array<{ data: () => Record<string, unknown> }> }> } };
  } {
    return {
      path,
      doc: (id) => refFor(`${path}/${id}`),
      orderBy: () => ({
        limit: () => ({
          get: async () => {
            const match = /^replayV2Owners\/([^/]+)\/items$/.exec(path);
            if (match) queriedOwnerIndexes.push(match[1]);
            const prefix = `${path}/`;
            return {
              docs: [...documents.entries()]
                .filter(([candidate]) => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes("/"))
                .map(([, data]) => ({ data: () => data })),
            };
          },
        }),
      }),
    };
  }
  const transaction = {
    get: vi.fn(async (ref: Ref) => {
      if (/^replayV2\/[^/]+$/.test(ref.path)) transactionReplayReads.push(ref.path);
      return ref.get();
    }),
    getAll: vi.fn(async (...refs: Ref[]) => Promise.all(refs.map((ref) => {
      if (/^replayV2\/[^/]+$/.test(ref.path)) transactionReplayReads.push(ref.path);
      return ref.get();
    }))),
    create: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };
  const db = {
    collection: (name: string) => collectionFor(name),
    runTransaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
  };
  return { db, queriedOwnerIndexes, transaction, transactionReplayReads };
}

function fakePublicReplayQuery(docs: Array<ReturnType<typeof publicReplayDocument>>) {
  const query = {
    orderBy: vi.fn(),
    startAfter: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(async () => ({ docs })),
  };
  query.orderBy.mockReturnValue(query);
  query.startAfter.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function publicReplayDocument(replayId: string, createdAt: Timestamp) {
  return {
    id: replayId,
    data: () => ({
      replayId,
      visibility: "public",
      status: "ready",
      title: "Akali vs Kennen",
      platform: "atlas",
      messageCount: 120,
      listing: {
        version: 1,
        playerName: "Player one",
        opponentName: "Player two",
        playerLegend: "Akali",
        opponentLegend: "Kennen",
        format: "bo1",
        result: "win",
      },
      capturedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    }),
  };
}

function timestampIso(value: unknown): string {
  return value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function"
    ? value.toDate().toISOString()
    : "";
}
