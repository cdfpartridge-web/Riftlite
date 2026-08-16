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

import {
  mulliganPackDocumentId,
  readMulliganLabPack,
  refreshMulliganLabAggregate,
} from "@/lib/mulligan-lab/server";

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
        backfill: { factVersion: 3, complete: true, cursor: null },
      }),
      { merge: true },
    );
  });

  it("uses a bounded watermark instead of rereading unchanged facts twice in one day", async () => {
    const latestFact = document("fact-latest", { updatedAt: 123_456 });
    const fake = fakeMulliganDb(
      { factVersion: 3, complete: true, cursor: null },
      {
        factCount: 42,
        watermarkPages: [page([latestFact]), page([latestFact])],
      },
    );
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await expect(refreshMulliganLabAggregate(25)).resolves.toMatchObject({ skipped: false });
    const fullFactReads = fake.factQuery.get.mock.calls.length;
    await expect(refreshMulliganLabAggregate(25)).resolves.toMatchObject({
      skipped: true,
      skipReason: "source-unchanged-today",
      factsRead: 0,
    });

    expect(fake.factQuery.get).toHaveBeenCalledTimes(fullFactReads);
    expect(fake.watermarkQuery.get).toHaveBeenCalledTimes(2);
    expect(fake.factCountGet).toHaveBeenCalledTimes(2);
  });

  it("rebuilds on retry when a forced pack write fails after clearing the completion marker", async () => {
    const latestFact = document("fact-latest", { updatedAt: 123_456 });
    const facts = Array.from({ length: 8 }, (_, index) => (
      document(`fact-${index}`, eligibleFact(index))
    ));
    const fake = fakeMulliganDb(
      { factVersion: 3, complete: true, cursor: null },
      {
        factCount: facts.length,
        factPages: [page(facts), page(facts), page(facts)],
        watermarkPages: [page([latestFact]), page([latestFact]), page([latestFact])],
      },
    );
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await expect(refreshMulliganLabAggregate(25)).resolves.toMatchObject({
      skipped: false,
      published: true,
      packs: expect.any(Number),
    });
    expect(fake.packSet).toHaveBeenCalled();

    fake.packSet.mockRejectedValueOnce(new Error("pack write failed"));
    await expect(refreshMulliganLabAggregate(25, { force: true }))
      .rejects.toThrow("pack write failed");
    expect(fake.aggregateData.factRefreshState).toBeNull();
    const factReadsAfterFailure = fake.factQuery.get.mock.calls.length;

    await expect(refreshMulliganLabAggregate(25)).resolves.toMatchObject({ skipped: false });
    expect(fake.factQuery.get.mock.calls.length).toBeGreaterThan(factReadsAfterFailure);
    expect(fake.aggregateData.factRefreshState).toEqual(expect.objectContaining({ version: 1 }));
  });

  it("resumes the index-free document-id walk from its persisted cursor", async () => {
    const fake = fakeMulliganDb({
      factVersion: 3,
      complete: false,
      cursor: { replayId: "rl2_previous" },
    });
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await refreshMulliganLabAggregate(25);

    expect(fake.replayQuery.startAfter).toHaveBeenCalledWith("rl2_previous");
  });

  it("restarts an old v1 cursor so rejected markers can be reconsidered by extractor v3", async () => {
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
        backfill: { factVersion: 3, complete: true, cursor: null },
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
          factVersion: 3,
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

  it("only reads privacy-gated initiative shards for an initiative selector", async () => {
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

    await readMulliganLabPack({
      playerLegendIdentityCode: "UNL-191",
      opponentLegendIdentityCode: "VEN-145",
      deckFingerprint: fingerprint,
      initiative: "first",
    });

    expect(readIds).toEqual([
      mulliganPackDocumentId("UNL-191", "VEN-145", fingerprint, "first"),
      mulliganPackDocumentId("UNL-191", "VEN-145", undefined, "first"),
      mulliganPackDocumentId("UNL-191", undefined, undefined, "first"),
    ]);
    expect(readIds).not.toContain(
      mulliganPackDocumentId("UNL-191", "VEN-145", fingerprint),
    );
    expect(readIds).not.toContain(mulliganPackDocumentId("UNL-191"));
  });
});

function fakeMulliganDb(
  backfill?: Record<string, unknown>,
  options: {
    replayPages?: Array<{ docs: ReturnType<typeof document>[]; empty: boolean }>;
    factPages?: Array<{ docs: ReturnType<typeof document>[]; empty: boolean }>;
    watermarkPages?: Array<{ docs: ReturnType<typeof document>[]; empty: boolean }>;
    factCount?: number;
  } = {},
) {
  const aggregateData: Record<string, unknown> = backfill ? { backfill } : {};
  const aggregateSet = vi.fn(async (value: Record<string, unknown>) => {
    Object.assign(aggregateData, value);
  });
  const packSet = vi.fn().mockResolvedValue(undefined);
  const aggregateRef = {
    get: vi.fn().mockResolvedValue({
      exists: true,
      data: () => aggregateData,
    }),
    set: aggregateSet,
  };
  const replayQuery = chainQueryPages(options.replayPages ?? [page([])]);
  const factQuery = chainQueryPages(options.factPages ?? [page([])]);
  const watermarkQuery = chainQueryPages(options.watermarkPages ?? [page([])]);
  const factCountGet = vi.fn().mockResolvedValue({
    data: () => ({ count: options.factCount ?? 0 }),
  });
  const factCollection = {
    where: (...args: unknown[]) => {
      factQuery.where(...args);
      return factQuery;
    },
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
        doc: (id: string) => id === "mulligan-lab-v1"
          ? aggregateRef
          : { set: packSet },
      };
      if (name === "replayV2") return replayQuery;
      if (name === "mulliganLabFactsV1") return factCollection;
      throw new Error(`Unexpected collection ${name}`);
    }),
    getAll: vi.fn().mockResolvedValue([]),
  };
  return {
    db,
    aggregateData,
    aggregateSet,
    packSet,
    replayQuery,
    factQuery,
    watermarkQuery,
    factCountGet,
  };
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

function eligibleFact(index = 0) {
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
    contributorHash: ((index % 4) + 10).toString(16).repeat(64),
    observedHandId: `mh1_${(index + 1).toString(16).padStart(32, "0")}`,
    observation: {
      provider: "atlas",
      matchKey: `mm1_${(index + 101).toString(16).padStart(32, "0")}`,
      gameNumber: 1,
      eventKey: `me1_${(index + 201).toString(16).padStart(32, "0")}`,
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
