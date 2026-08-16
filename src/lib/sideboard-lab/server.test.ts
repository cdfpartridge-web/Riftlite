import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildSideboardLabSnapshotMock, getFirestoreAdminMock } = vi.hoisted(() => ({
  buildSideboardLabSnapshotMock: vi.fn(),
  getFirestoreAdminMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({ getFirestoreAdmin: getFirestoreAdminMock }));
vi.mock("@/lib/replay-v2-server/artifacts", () => ({ readImmutableArtifact: vi.fn() }));
vi.mock("@/lib/sideboard-lab/aggregate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sideboard-lab/aggregate")>();
  buildSideboardLabSnapshotMock.mockImplementation(actual.buildSideboardLabSnapshot);
  return { ...actual, buildSideboardLabSnapshot: buildSideboardLabSnapshotMock };
});

import {
  readSideboardLabPack,
  refreshSideboardLabAggregate,
  sideboardPackDocumentId,
  syncSideboardPackDocuments,
} from "@/lib/sideboard-lab/server";

describe("Sideboard Lab all-history fact refresh", () => {
  beforeEach(() => {
    getFirestoreAdminMock.mockReset();
    buildSideboardLabSnapshotMock.mockClear();
  });

  it("walks replay ids without a composite index and completes an empty backfill", async () => {
    const fake = fakeSideboardDb();
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await expect(refreshSideboardLabAggregate(25)).resolves.toMatchObject({
      scanned: 0,
      factsRead: 0,
      backfillComplete: true,
      published: false,
    });
    expect(fake.replayQuery.where).not.toHaveBeenCalled();
    expect(fake.factQuery.where).not.toHaveBeenCalled();
    expect(fake.aggregateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        backfill: { factVersion: 3, complete: true, cursor: null },
      }),
      { merge: true },
    );
  });

  it("uses a bounded watermark instead of rereading unchanged facts twice in one day", async () => {
    const latestFact = document("fact-latest", { updatedAt: 123_456 });
    const fake = fakeSideboardDb(
      { factVersion: 3, complete: true, cursor: null },
      {
        factCount: 42,
        watermarkPages: [page([latestFact]), page([latestFact])],
      },
    );
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await expect(refreshSideboardLabAggregate(25)).resolves.toMatchObject({ skipped: false });
    const fullFactReads = fake.factQuery.get.mock.calls.length;
    await expect(refreshSideboardLabAggregate(25)).resolves.toMatchObject({
      skipped: true,
      skipReason: "source-unchanged-today",
      factsRead: 0,
    });

    expect(fake.factQuery.get).toHaveBeenCalledTimes(fullFactReads);
    expect(fake.watermarkQuery.get).toHaveBeenCalledTimes(2);
    expect(fake.factCountGet).toHaveBeenCalledTimes(2);
  });

  it("rebuilds on retry when a forced pack sync fails after clearing the completion marker", async () => {
    const latestFact = document("fact-latest", { updatedAt: 123_456 });
    const fake = fakeSideboardDb(
      { factVersion: 3, complete: true, cursor: null },
      {
        watermarkPages: [page([latestFact]), page([latestFact]), page([latestFact])],
        aggregatePackPages: [page([])],
      },
    );
    const payload = { drills: [] } as never;
    buildSideboardLabSnapshotMock
      .mockReturnValueOnce(payload)
      .mockReturnValueOnce(payload)
      .mockReturnValueOnce(payload);
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await expect(refreshSideboardLabAggregate(25)).resolves.toMatchObject({
      skipped: false,
      published: true,
    });

    fake.aggregatePackQuery.get.mockRejectedValueOnce(new Error("pack sync failed"));
    await expect(refreshSideboardLabAggregate(25, { force: true }))
      .rejects.toThrow("pack sync failed");
    expect(fake.aggregateData.factRefreshState).toBeNull();
    const factReadsAfterFailure = fake.factQuery.get.mock.calls.length;

    await expect(refreshSideboardLabAggregate(25)).resolves.toMatchObject({ skipped: false });
    expect(fake.factQuery.get.mock.calls.length).toBeGreaterThan(factReadsAfterFailure);
    expect(fake.aggregateData.factRefreshState).toEqual(expect.objectContaining({ version: 1 }));
  });

  it("resumes the index-free replay walk from the saved cursor", async () => {
    const fake = fakeSideboardDb({
      factVersion: 3,
      complete: false,
      cursor: { replayId: "rl2_previous" },
    });
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await refreshSideboardLabAggregate(25);
    expect(fake.replayQuery.startAfter).toHaveBeenCalledWith("rl2_previous");
  });

  it("restarts the v1 walk so initiative context can be backfilled", async () => {
    const fake = fakeSideboardDb({ factVersion: 1, complete: true, cursor: null });
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await refreshSideboardLabAggregate(25);
    expect(fake.replayQuery.startAfter).not.toHaveBeenCalled();
    expect(fake.aggregateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        backfill: { factVersion: 3, complete: true, cursor: null },
      }),
      { merge: true },
    );
  });

  it("preserves existing packs when refresh cannot produce a valid snapshot", async () => {
    const staleId = sideboardPackDocumentId("UNL-191", "VEN-145");
    const fake = fakeSideboardDb(undefined, {
      aggregatePackPages: [page([document(staleId, { payload: { marker: "existing" } })])],
    });
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await expect(refreshSideboardLabAggregate(25)).resolves.toMatchObject({ published: false });

    expect(fake.aggregatePackQuery.orderBy).not.toHaveBeenCalled();
    expect(fake.packDelete).not.toHaveBeenCalled();
  });

  it("reads every fact document page and filters eligibility in the strict adapter", async () => {
    const documents = Array.from({ length: 1_002 }, (_, index) => document(
      `fact-${String(index).padStart(4, "0")}`,
      { schema: "riftlite-sideboard-fact", version: 1, status: "ineligible" },
    ));
    const fake = fakeSideboardDb(undefined, {
      factPages: [
        page(documents.slice(0, 500)),
        page(documents.slice(500, 1_000)),
        page(documents.slice(1_000)),
      ],
    });
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await expect(refreshSideboardLabAggregate(25)).resolves.toMatchObject({
      factsRead: 1_002,
      strictCandidates: 0,
    });
    expect(fake.factQuery.where).not.toHaveBeenCalled();
    expect(fake.factQuery.get).toHaveBeenCalledTimes(3);
    expect(fake.factQuery.startAfter).toHaveBeenNthCalledWith(1, documents[499]);
    expect(fake.factQuery.startAfter).toHaveBeenNthCalledWith(2, documents[999]);
  });

  it("only reads privacy-gated result shards for a prior-result selector", async () => {
    const readIds: string[] = [];
    const db = {
      collection: vi.fn(() => ({
        doc: (id: string) => {
          readIds.push(id);
          return { get: vi.fn().mockResolvedValue({ exists: false }) };
        },
      })),
    };
    getFirestoreAdminMock.mockReturnValue(db);
    const fingerprint = "a".repeat(64);

    await readSideboardLabPack({
      playerLegendIdentityCode: "UNL-191",
      opponentLegendIdentityCode: "VEN-145",
      deckFingerprint: fingerprint,
      priorGameResult: "loss",
    });

    expect(readIds).toEqual([
      sideboardPackDocumentId("UNL-191", "VEN-145", fingerprint, "loss"),
      sideboardPackDocumentId("UNL-191", "VEN-145", undefined, "loss"),
      sideboardPackDocumentId("UNL-191", undefined, undefined, "loss"),
    ]);
    expect(readIds).not.toContain(
      sideboardPackDocumentId("UNL-191", "VEN-145", fingerprint),
    );
    expect(readIds).not.toContain(sideboardPackDocumentId("UNL-191"));
  });

  it("removes stale Sideboard packs while preserving current and unrelated aggregates", async () => {
    const currentId = sideboardPackDocumentId("UNL-191", "VEN-145", undefined, "win");
    const staleId = sideboardPackDocumentId("UNL-191", "VEN-145");
    const dailySideboardId = "sideboard-lab-v1";
    const mulliganPackId = "mulligan-lab-pack-v1-not-sideboard";
    const fake = fakeAggregatePackDb(new Map([
      [currentId, { payload: { marker: "old-current" } }],
      [staleId, { payload: { marker: "stale" } }],
      [dailySideboardId, { payload: { marker: "daily" } }],
      [mulliganPackId, { payload: { marker: "mulligan" } }],
    ]));
    const currentPayload = { marker: "fresh-current" } as never;

    await syncSideboardPackDocuments(fake.db as never, [{ id: currentId, payload: currentPayload }]);

    expect(fake.deletedIds).toEqual([staleId]);
    expect(fake.documents.has(staleId)).toBe(false);
    expect(fake.documents.get(currentId)).toEqual(expect.objectContaining({ payload: currentPayload }));
    expect(fake.documents.get(dailySideboardId)).toEqual({ payload: { marker: "daily" } });
    expect(fake.documents.get(mulliganPackId)).toEqual({ payload: { marker: "mulligan" } });
    expect(fake.query.startAt).toHaveBeenCalledWith("sideboard-lab-pack-v1-");
    expect(fake.query.endBefore).toHaveBeenCalledWith("sideboard-lab-pack-v1-\uf8ff");
  });
});

function fakeSideboardDb(
  backfill?: Record<string, unknown>,
  options: {
    factPages?: Array<{ docs: ReturnType<typeof document>[]; empty: boolean }>;
    aggregatePackPages?: Array<{ docs: ReturnType<typeof document>[]; empty: boolean }>;
    watermarkPages?: Array<{ docs: ReturnType<typeof document>[]; empty: boolean }>;
    factCount?: number;
  } = {},
) {
  const aggregateData: Record<string, unknown> = backfill ? { backfill } : {};
  const aggregateSet = vi.fn(async (value: Record<string, unknown>) => {
    Object.assign(aggregateData, value);
  });
  const aggregateRef = {
    get: vi.fn().mockResolvedValue({
      exists: true,
      data: () => aggregateData,
    }),
    set: aggregateSet,
  };
  const replayQuery = chainQueryPages([page([])]);
  const factQuery = chainQueryPages(options.factPages ?? [page([])]);
  const watermarkQuery = chainQueryPages(options.watermarkPages ?? [page([])]);
  const factCountGet = vi.fn().mockResolvedValue({
    data: () => ({ count: options.factCount ?? 0 }),
  });
  const aggregatePackQuery = chainQueryPages(options.aggregatePackPages ?? [page([])]);
  const packDelete = vi.fn().mockResolvedValue(undefined);
  const factCollection = {
    orderBy: (...args: unknown[]) => {
      if (args[0] === "updatedAt") {
        watermarkQuery.orderBy(...args);
        return watermarkQuery;
      }
      factQuery.orderBy(...args);
      return factQuery;
    },
    count: () => ({ get: factCountGet }),
    doc: (id: string) => ({ id }),
  };
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "aggregates") return {
        ...aggregatePackQuery,
        doc: (id: string) => id === "sideboard-lab-v1"
          ? aggregateRef
          : { delete: packDelete, set: vi.fn().mockResolvedValue(undefined) },
      };
      if (name === "replayV2") return replayQuery;
      if (name === "sideboardLabFactsV1") return factCollection;
      throw new Error(`Unexpected collection ${name}`);
    }),
    getAll: vi.fn().mockResolvedValue([]),
  };
  return {
    db,
    aggregateData,
    aggregateSet,
    replayQuery,
    factQuery,
    watermarkQuery,
    factCountGet,
    aggregatePackQuery,
    packDelete,
  };
}

function fakeAggregatePackDb(initial: Map<string, Record<string, unknown>>) {
  const documents = new Map(initial);
  const deletedIds: string[] = [];
  let start = "";
  let after = "";
  let end = "\uffff";
  let maximum = Number.POSITIVE_INFINITY;
  const query = {
    orderBy: vi.fn(),
    startAt: vi.fn(),
    startAfter: vi.fn(),
    endBefore: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(),
  };
  query.orderBy.mockReturnValue(query);
  query.startAt.mockImplementation((value: string) => {
    start = value;
    return query;
  });
  query.startAfter.mockImplementation((value: string) => {
    after = value;
    return query;
  });
  query.endBefore.mockImplementation((value: string) => {
    end = value;
    return query;
  });
  query.limit.mockImplementation((value: number) => {
    maximum = value;
    return query;
  });
  query.get.mockImplementation(async () => {
    const docs = [...documents]
      .filter(([id]) => id >= start && id > after && id < end)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, maximum)
      .map(([id, value]) => ({ id, data: () => value }));
    return { docs, empty: docs.length === 0 };
  });
  const collection = {
    ...query,
    doc: (id: string) => ({
      set: vi.fn(async (value: Record<string, unknown>, options?: { merge?: boolean }) => {
        documents.set(id, options?.merge ? { ...(documents.get(id) ?? {}), ...value } : value);
      }),
      delete: vi.fn(async () => {
        deletedIds.push(id);
        documents.delete(id);
      }),
    }),
  };
  const db = {
    collection: vi.fn((name: string) => {
      if (name !== "aggregates") throw new Error(`Unexpected collection ${name}`);
      return collection;
    }),
  };
  return { db, deletedIds, documents, query };
}

function chainQueryPages(snapshots: Array<{ docs: unknown[]; empty: boolean }>) {
  const query = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAt: vi.fn(),
    startAfter: vi.fn(),
    endBefore: vi.fn(),
    get: vi.fn(),
  };
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.startAt.mockReturnValue(query);
  query.startAfter.mockReturnValue(query);
  query.endBefore.mockReturnValue(query);
  snapshots.forEach((snapshot) => query.get.mockResolvedValueOnce(snapshot));
  query.get.mockResolvedValue({ docs: [], empty: true });
  return query;
}

function page(documents: ReturnType<typeof document>[]) {
  return { docs: documents, empty: documents.length === 0 };
}

function document(id: string, value: Record<string, unknown>) {
  return { id, data: () => value };
}
