import { beforeEach, describe, expect, it, vi } from "vitest";

import { mulliganDeckFingerprint } from "@/lib/mulligan-lab/aggregate";
import { storedMulliganFactCandidate } from "@/lib/mulligan-lab/facts";

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

  it("publishes the next incomplete backfill state instead of implying full history", async () => {
    expect(storedMulliganFactCandidate(eligibleFact())).not.toBeNull();
    const pendingReplay = document("rl2_pending", { status: "processing" });
    const fake = fakeMulliganDb(undefined, {
      replayPages: [page([pendingReplay])],
      factPages: [page([document("fact-1", eligibleFact())])],
    });
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await expect(refreshMulliganLabAggregate(1)).resolves.toMatchObject({
      published: true,
      backfillComplete: false,
      factsRead: 1,
      factCoverageTruncated: false,
    });

    expect(fake.aggregateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          source: expect.objectContaining({
            coveragePolicy: "all-available-history",
            backfillComplete: false,
          }),
        }),
        backfill: {
          factVersion: 2,
          complete: false,
          cursor: { replayId: "rl2_pending" },
        },
      }),
      { merge: true },
    );
  });

  it("reads every eligible fact page without a hidden corpus cap", async () => {
    const documents = Array.from({ length: 1_002 }, (_, index) => (
      document(`fact-${String(index).padStart(4, "0")}`, { status: "eligible" })
    ));
    const fake = fakeMulliganDb(undefined, {
      factPages: [
        page(documents.slice(0, 500)),
        page(documents.slice(500, 1_000)),
        page(documents.slice(1_000)),
      ],
    });
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await expect(refreshMulliganLabAggregate(25)).resolves.toMatchObject({
      factsRead: 1_002,
      factCoverageTruncated: false,
      strictCandidates: 0,
    });
    expect(fake.factQuery.get).toHaveBeenCalledTimes(3);
    expect(fake.factQuery.startAfter).toHaveBeenNthCalledWith(1, documents[499]);
    expect(fake.factQuery.startAfter).toHaveBeenNthCalledWith(2, documents[999]);
  });
});

function fakeMulliganDb(
  backfill?: Record<string, unknown>,
  options: {
    replayPages?: Array<{ docs: ReturnType<typeof document>[]; empty: boolean }>;
    factPages?: Array<{ docs: ReturnType<typeof document>[]; empty: boolean }>;
  } = {},
) {
  const aggregateSet = vi.fn().mockResolvedValue(undefined);
  const aggregateRef = {
    get: vi.fn().mockResolvedValue({
      exists: Boolean(backfill),
      data: () => backfill ? { backfill } : undefined,
    }),
    set: aggregateSet,
  };
  const replayQuery = chainQueryPages(options.replayPages ?? [page([])]);
  const factQuery = chainQueryPages(options.factPages ?? [page([])]);
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

function eligibleFact() {
  const playableCodes = [
    "OGN-001", "OGN-002", "OGN-003", "OGN-004", "OGN-005", "OGN-006", "OGN-008",
    "OGN-009", "OGN-010", "OGN-011", "OGN-012", "OGN-013", "OGN-014",
  ];
  const mainDeck = [
    ...playableCodes.map((cardCode, index) => ({
      cardCode,
      name: `Card ${index + 1}`,
      count: 3,
    })),
    { cardCode: "OGN-015", name: "Card 14", count: 1 },
  ];
  return {
    schema: "riftlite-mulligan-fact",
    version: 2,
    status: "eligible",
    contributorHash: "a".repeat(64),
    observedHandId: `mh1_${"1".repeat(32)}`,
    observation: {
      provider: "atlas",
      matchKey: `mm1_${"2".repeat(32)}`,
      gameNumber: 1,
      eventKey: `me1_${"3".repeat(32)}`,
      observedOn: "2026-08-12",
    },
    matchup: {
      playerLegend: { cardCode: "UNL-191", name: "Player legend" },
      opponentLegend: { cardCode: "VEN-145", name: "Opponent legend" },
    },
    initiative: "first",
    hand: ["OGN-001", "OGN-002", "OGN-003", "OGN-014"].map((cardCode) => ({
      cardCode,
      name: cardCode,
    })),
    redrawnCardIndexes: [1],
    wonGame: true,
    deck: { fingerprint: mulliganDeckFingerprint(mainDeck), mainDeck },
  };
}
