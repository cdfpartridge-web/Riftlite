import { beforeEach, describe, expect, it, vi } from "vitest";

const { getFirestoreAdminMock } = vi.hoisted(() => ({ getFirestoreAdminMock: vi.fn() }));

vi.mock("@/lib/firebase/admin", () => ({ getFirestoreAdmin: getFirestoreAdminMock }));
vi.mock("@/lib/replay-v2-server/artifacts", () => ({ readImmutableArtifact: vi.fn() }));

import { refreshSideboardLabAggregate } from "@/lib/sideboard-lab/server";

describe("Sideboard Lab all-history fact refresh", () => {
  beforeEach(() => getFirestoreAdminMock.mockReset());

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
        backfill: { factVersion: 1, complete: true, cursor: null },
      }),
      { merge: true },
    );
  });

  it("resumes the index-free replay walk from the saved cursor", async () => {
    const fake = fakeSideboardDb({
      factVersion: 1,
      complete: false,
      cursor: { replayId: "rl2_previous" },
    });
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await refreshSideboardLabAggregate(25);
    expect(fake.replayQuery.startAfter).toHaveBeenCalledWith("rl2_previous");
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
});

function fakeSideboardDb(
  backfill?: Record<string, unknown>,
  options: { factPages?: Array<{ docs: ReturnType<typeof document>[]; empty: boolean }> } = {},
) {
  const aggregateSet = vi.fn().mockResolvedValue(undefined);
  const aggregateRef = {
    get: vi.fn().mockResolvedValue({
      exists: Boolean(backfill),
      data: () => backfill ? { backfill } : undefined,
    }),
    set: aggregateSet,
  };
  const replayQuery = chainQueryPages([page([])]);
  const factQuery = chainQueryPages(options.factPages ?? [page([])]);
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "aggregates") return { doc: () => aggregateRef };
      if (name === "replayV2") return replayQuery;
      if (name === "sideboardLabFactsV1") return {
        ...factQuery,
        doc: (id: string) => ({ id }),
      };
      throw new Error(`Unexpected collection ${name}`);
    }),
    getAll: vi.fn().mockResolvedValue([]),
  };
  return { db, aggregateSet, replayQuery, factQuery };
}

function chainQueryPages(snapshots: Array<{ docs: unknown[]; empty: boolean }>) {
  const query = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    get: vi.fn(),
  };
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.startAfter.mockReturnValue(query);
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
