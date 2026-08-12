import { beforeEach, describe, expect, it, vi } from "vitest";

const { getFirestoreAdminMock } = vi.hoisted(() => ({
  getFirestoreAdminMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: getFirestoreAdminMock,
}));

vi.mock("@/lib/replay-v2-server/artifacts", () => ({
  readImmutableArtifact: vi.fn(),
}));

import { refreshMulliganLabAggregate } from "@/lib/mulligan-lab/server";

describe("Mulligan Lab fact backfill", () => {
  beforeEach(() => {
    getFirestoreAdminMock.mockReset();
  });

  it("walks replay ids without a Firestore composite index and completes an empty backfill", async () => {
    const fake = fakeMulliganDb();
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await expect(refreshMulliganLabAggregate(25)).resolves.toMatchObject({
      scanned: 0,
      factsRead: 0,
      backfillComplete: true,
      published: false,
    });

    expect(fake.replayQuery.where).not.toHaveBeenCalled();
    expect(fake.replayQuery.orderBy).toHaveBeenCalledOnce();
    expect(fake.replayQuery.startAfter).not.toHaveBeenCalled();
    expect(fake.aggregateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        backfill: { factVersion: 2, complete: true, cursor: null },
      }),
      { merge: true },
    );
  });

  it("resumes the index-free document-id walk from its persisted cursor", async () => {
    const fake = fakeMulliganDb({
      factVersion: 2,
      complete: false,
      cursor: { replayId: "rl2_previous" },
    });
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await refreshMulliganLabAggregate(25);

    expect(fake.replayQuery.startAfter).toHaveBeenCalledWith("rl2_previous");
  });

  it("restarts an old v1 cursor so rejected markers can be reconsidered by extractor v2", async () => {
    const fake = fakeMulliganDb({
      factVersion: 1,
      complete: true,
      cursor: null,
    });
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await refreshMulliganLabAggregate(25);

    expect(fake.replayQuery.startAfter).not.toHaveBeenCalled();
    expect(fake.aggregateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        backfill: { factVersion: 2, complete: true, cursor: null },
      }),
      { merge: true },
    );
  });
});

function fakeMulliganDb(backfill?: Record<string, unknown>) {
  const aggregateSet = vi.fn().mockResolvedValue(undefined);
  const aggregateRef = {
    get: vi.fn().mockResolvedValue({
      exists: Boolean(backfill),
      data: () => backfill ? { backfill } : undefined,
    }),
    set: aggregateSet,
  };
  const replayQuery = chainQuery({ docs: [], empty: true });
  const factQuery = chainQuery({ docs: [], empty: true });
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "aggregates") return { doc: () => aggregateRef };
      if (name === "replayV2") return replayQuery;
      if (name === "mulliganLabFactsV1") return {
        ...factQuery,
        doc: (id: string) => ({ id }),
      };
      throw new Error(`Unexpected collection ${name}`);
    }),
    getAll: vi.fn().mockResolvedValue([]),
  };
  return { db, aggregateSet, replayQuery, factQuery };
}

function chainQuery(snapshot: { docs: unknown[]; empty: boolean }) {
  const query = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    get: vi.fn().mockResolvedValue(snapshot),
  };
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.startAfter.mockReturnValue(query);
  return query;
}
