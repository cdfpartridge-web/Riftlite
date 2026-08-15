import { gunzipSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFirestoreAdmin: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: mocks.getFirestoreAdmin,
}));

import {
  appendMatchToAggregate,
  normalizeMatch,
  refreshCommunityAggregate,
} from "@/lib/community/data";
import {
  communitySourceChangeDocId,
  decodeCommunitySourceChange,
  encodeCommunitySourceChange,
  COMMUNITY_SOURCE_CHANGE_COLLECTION,
  COMMUNITY_SOURCE_MANIFEST_ID,
} from "@/lib/community/source-cache";

const NOW = Date.UTC(2026, 7, 15, 12);

describe("incremental Community aggregate refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("matches a full reconciliation after applying a correction without rescanning matches", async () => {
    const fake = new FakeFirestore();
    fake.put("aggregates", "community-v1", {
      updatedAt: NOW,
      publicLifetimeMatchCount: 7_000,
      publicLifetimePlayerCount: 7_000,
      publicPlayerIndexReady: true,
    });
    fake.put("aggregates", "community-private-counters", {
      privateMatchCount: 100,
      privatePlayerCount: 20,
    });
    fake.put("publicPlayers", "player-index", { uid: "player-index" });
    for (let index = 0; index < 7_000; index += 1) {
      const id = `match-${String(index).padStart(5, "0")}`;
      const raw = rawMatch(id, index % 2 ? "Win" : "Loss");
      if (index === 6_999) {
        const { created_at: createdAt, ...legacy } = raw;
        fake.put("matches", id, { ...legacy, createdAt });
      } else {
        fake.put("matches", id, raw);
      }
    }
    mocks.getFirestoreAdmin.mockReturnValue(fake as never);

    const bootstrap = await refreshCommunityAggregate({
      forceFullReconcile: true,
      now: NOW,
    });
    expect(bootstrap).toMatchObject({
      refreshMode: "reconcile",
      sourceMatchCount: 7_000,
      changesApplied: 0,
      invalidChanges: 0,
      legacyTimestampComplete: true,
      legacyMatchesMigrated: 1,
    });
    expect(fake.get("aggregates", COMMUNITY_SOURCE_MANIFEST_ID)).toBeTruthy();
    expect(fake.get("aggregates", COMMUNITY_SOURCE_MANIFEST_ID)?.publicLifetimeMatchCount)
      .toBe(7_000);
    const readsAfterBootstrap = fake.rawMatchDocumentReads;
    expect(readsAfterBootstrap).toBe(7_001);

    const correctedId = "match-00000";
    const correctedRaw = rawMatch(correctedId, "Win");
    fake.put("matches", correctedId, correctedRaw);
    const corrected = normalizeMatch(correctedId, correctedRaw);
    fake.put(
      COMMUNITY_SOURCE_CHANGE_COLLECTION,
      communitySourceChangeDocId(correctedId),
      encodeCommunitySourceChange(corrected, NOW + 100),
    );

    const incremental = await refreshCommunityAggregate({ now: NOW + 24 * 60 * 60 * 1000 });
    expect(incremental).toMatchObject({
      refreshMode: "incremental",
      sourceMatchCount: 7_000,
      sourceChangeReads: 1,
      changesApplied: 1,
      invalidChanges: 0,
    });
    expect(incremental.sourceShardReads).toBeGreaterThan(0);
    expect(fake.rawMatchDocumentReads).toBe(readsAfterBootstrap);
    const incrementalStats = decodedStats(fake.get("aggregates", "community-range-30d"));

    const reconciled = await refreshCommunityAggregate({
      forceFullReconcile: true,
      now: NOW + 24 * 60 * 60 * 1000,
    });
    expect(reconciled.refreshMode).toBe("reconcile");
    expect(fake.rawMatchDocumentReads).toBe(readsAfterBootstrap + 7_000);
    const reconciledStats = decodedStats(fake.get("aggregates", "community-range-30d"));
    expect(withoutUpdatedAt(reconciledStats)).toEqual(withoutUpdatedAt(incrementalStats));

    fake.put(COMMUNITY_SOURCE_CHANGE_COLLECTION, "malformed-change", {
      schemaVersion: 1,
      changedAtMs: NOW + 24 * 60 * 60 * 1000 + 200,
      matchId: "malformed",
      matchGz: "not-gzip",
    });
    const readsBeforeRepair = fake.rawMatchDocumentReads;
    const repaired = await refreshCommunityAggregate({
      now: NOW + 2 * 24 * 60 * 60 * 1000,
    });
    expect(repaired).toMatchObject({
      refreshMode: "reconcile",
      invalidChanges: 1,
    });
    expect(fake.rawMatchDocumentReads).toBe(readsBeforeRepair + 7_000);

    fake.put("matches", "missed-append", rawMatch("missed-append", "Win"));
    const readsBeforeCountRepair = fake.rawMatchDocumentReads;
    const countRepaired = await refreshCommunityAggregate({
      now: NOW + 3 * 24 * 60 * 60 * 1000,
    });
    expect(countRepaired).toMatchObject({
      refreshMode: "reconcile",
      publicLifetimeMatchCount: 7_001,
      sourceMatchCount: 7_001,
    });
    expect(fake.rawMatchDocumentReads).toBe(readsBeforeCountRepair + 7_001);
  }, 30_000);

  it("records an idempotent journal row in the append transaction", async () => {
    const fake = new FakeFirestore();
    fake.put("aggregates", "community-v1", {
      updatedAt: NOW,
      matchCount: 0,
      chunkCount: 0,
      publicLifetimeMatchCount: 0,
      publicLifetimePlayerCount: 0,
      publicPlayerIndexReady: true,
    });
    mocks.getFirestoreAdmin.mockReturnValue(fake as never);
    const id = "append-match";
    const first = normalizeMatch(id, rawMatch(id, "Win"));

    await appendMatchToAggregate(first);
    const changeId = communitySourceChangeDocId(id);
    const firstRaw = fake.get(COMMUNITY_SOURCE_CHANGE_COLLECTION, changeId)!;
    const firstChange = decodeCommunitySourceChange(changeId, firstRaw);
    expect(firstChange?.match.result).toBe("Win");

    await appendMatchToAggregate(first);
    const duplicateRaw = fake.get(COMMUNITY_SOURCE_CHANGE_COLLECTION, changeId)!;
    expect(duplicateRaw.changedAtMs).toBe(firstRaw.changedAtMs);

    const corrected = normalizeMatch(id, rawMatch(id, "Loss"));
    await appendMatchToAggregate(corrected);
    const correctedRaw = fake.get(COMMUNITY_SOURCE_CHANGE_COLLECTION, changeId)!;
    expect(Number(correctedRaw.changedAtMs)).toBeGreaterThan(Number(firstRaw.changedAtMs));
    expect(decodeCommunitySourceChange(changeId, correctedRaw)?.match.result).toBe("Loss");
  });
});

function rawMatch(id: string, result: "Win" | "Loss") {
  const parsedIndex = Number(id.slice(-5));
  const index = Number.isFinite(parsedIndex) ? parsedIndex : 0;
  return {
    uid: `uid-${id}`,
    username: `Player ${id}`,
    date: "2026-08-14",
    result,
    my_champion: index % 3 === 0 ? "Ahri" : "Jinx",
    opp_champion: index % 5 === 0 ? "Ahri" : "Jinx",
    opp_name: "Opponent",
    fmt: "Bo1",
    score: result === "Win" ? "1-0" : "0-1",
    went_first: index % 2 === 0 ? "First" : "Second",
    games_json: "[]",
    created_at: Math.floor((NOW - 24 * 60 * 60 * 1000 - index) / 1000),
  };
}

function decodedStats(raw: Record<string, unknown> | undefined) {
  if (!raw || typeof raw.statsGz !== "string") {
    throw new Error("Range stats were not written");
  }
  return JSON.parse(gunzipSync(Buffer.from(raw.statsGz, "base64")).toString("utf8"));
}

function withoutUpdatedAt(value: Record<string, unknown>) {
  const rest = { ...value };
  delete rest.updatedAt;
  return rest;
}

type StoredDocument = Record<string, unknown>;
type QueryFilter = { field: string; op: string; value: unknown };
type QueryOrder = { field: string; direction: "asc" | "desc" };

class FakeFirestore {
  private readonly collections = new Map<string, Map<string, StoredDocument>>();
  rawMatchDocumentReads = 0;

  put(collection: string, id: string, value: StoredDocument) {
    const rows = this.collections.get(collection) ?? new Map<string, StoredDocument>();
    rows.set(id, structuredClone(value));
    this.collections.set(collection, rows);
  }

  get(collection: string, id: string): StoredDocument | undefined {
    const value = this.collections.get(collection)?.get(id);
    return value ? structuredClone(value) : undefined;
  }

  collection(name: string) {
    return new FakeQuery(this, name);
  }

  rows(name: string): Array<[string, StoredDocument]> {
    return [...(this.collections.get(name)?.entries() ?? [])];
  }

  batch() {
    const operations: Array<() => void> = [];
    return {
      set: (ref: FakeDocumentReference, value: StoredDocument, options?: { merge?: boolean }) => {
        operations.push(() => {
          const current = options?.merge ? this.get(ref.collectionName, ref.id) ?? {} : {};
          this.put(ref.collectionName, ref.id, { ...current, ...value });
        });
      },
      update: (ref: FakeDocumentReference, value: StoredDocument) => {
        operations.push(() => {
          this.put(ref.collectionName, ref.id, {
            ...(this.get(ref.collectionName, ref.id) ?? {}),
            ...value,
          });
        });
      },
      delete: (ref: FakeDocumentReference) => {
        operations.push(() => this.collections.get(ref.collectionName)?.delete(ref.id));
      },
      commit: async () => {
        operations.forEach((operation) => operation());
      },
    };
  }

  async runTransaction<T>(callback: (transaction: {
    get(ref: FakeDocumentReference): Promise<FakeDocumentSnapshot>;
    set(ref: FakeDocumentReference, value: StoredDocument, options?: { merge?: boolean }): void;
    delete(ref: FakeDocumentReference): void;
  }) => Promise<T>): Promise<T> {
    const operations: Array<() => void> = [];
    const result = await callback({
      get: (ref) => ref.get(),
      set: (ref, value, options) => {
        operations.push(() => {
          const current = options?.merge ? this.get(ref.collectionName, ref.id) ?? {} : {};
          this.put(ref.collectionName, ref.id, { ...current, ...value });
        });
      },
      delete: (ref) => {
        operations.push(() => this.collections.get(ref.collectionName)?.delete(ref.id));
      },
    });
    operations.forEach((operation) => operation());
    return result;
  }

  noteQueryRead(collection: string, count: number, isCount: boolean) {
    if (collection === "matches" && !isCount) {
      this.rawMatchDocumentReads += count;
    }
  }
}

class FakeDocumentReference {
  constructor(
    private readonly db: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}

  async get() {
    return new FakeDocumentSnapshot(this, this.db.get(this.collectionName, this.id));
  }

  async set(value: StoredDocument, options?: { merge?: boolean }) {
    const current = options?.merge ? this.db.get(this.collectionName, this.id) ?? {} : {};
    this.db.put(this.collectionName, this.id, { ...current, ...value });
  }
}

class FakeDocumentSnapshot {
  readonly exists: boolean;

  constructor(
    readonly ref: FakeDocumentReference,
    private readonly value: StoredDocument | undefined,
  ) {
    this.exists = value !== undefined;
  }

  get id() {
    return this.ref.id;
  }

  data() {
    return this.value ? structuredClone(this.value) : undefined;
  }

  get(field: string) {
    return this.value?.[field];
  }
}

class FakeQuery {
  private filters: QueryFilter[] = [];
  private orders: QueryOrder[] = [];
  private maximum: number | null = null;
  private after: unknown[] | null = null;
  private countOnly = false;

  constructor(
    private readonly db: FakeFirestore,
    private readonly collectionName: string,
  ) {}

  doc(id: string) {
    return new FakeDocumentReference(this.db, this.collectionName, id);
  }

  where(field: string, op: string, value: unknown) {
    this.filters.push({ field, op, value });
    return this;
  }

  orderBy(field: unknown, direction: "asc" | "desc" = "asc") {
    this.orders.push({
      field: typeof field === "string" ? field : "__name__",
      direction,
    });
    return this;
  }

  limit(value: number) {
    this.maximum = value;
    return this;
  }

  startAfter(...values: unknown[]) {
    this.after = values;
    return this;
  }

  select() {
    return this;
  }

  count() {
    this.countOnly = true;
    return this;
  }

  async get() {
    let rows = this.db.rows(this.collectionName)
      .filter(([id, value]) => this.filters.every((filter) => {
        const actual = filter.field === "__name__" ? id : value[filter.field];
        if (filter.op === "==") return actual === filter.value;
        if (filter.op === ">=") return typeof actual === "number" && actual >= Number(filter.value);
        throw new Error(`Unsupported fake query operator ${filter.op}`);
      }))
      .filter(([, value]) => this.orders.every((order) => (
        order.field === "__name__" || value[order.field] !== undefined
      )));

    rows.sort((left, right) => compareRows(left, right, this.orders));
    if (this.after) {
      rows = rows.filter((row) => compareRowToValues(row, this.after!, this.orders) > 0);
    }
    if (this.maximum !== null) rows = rows.slice(0, this.maximum);
    this.db.noteQueryRead(this.collectionName, rows.length, this.countOnly);

    if (this.countOnly) {
      return { data: () => ({ count: rows.length }) };
    }
    const docs = rows.map(([id, value]) => new FakeDocumentSnapshot(
      new FakeDocumentReference(this.db, this.collectionName, id),
      value,
    ));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

function compareRows(
  left: [string, StoredDocument],
  right: [string, StoredDocument],
  orders: QueryOrder[],
) {
  for (const order of orders) {
    const leftValue = order.field === "__name__" ? left[0] : left[1][order.field];
    const rightValue = order.field === "__name__" ? right[0] : right[1][order.field];
    const result = compareValues(leftValue, rightValue);
    if (result) return order.direction === "desc" ? -result : result;
  }
  return left[0].localeCompare(right[0]);
}

function compareRowToValues(
  row: [string, StoredDocument],
  values: unknown[],
  orders: QueryOrder[],
) {
  for (let index = 0; index < orders.length; index += 1) {
    const order = orders[index];
    const actual = order.field === "__name__" ? row[0] : row[1][order.field];
    const result = compareValues(actual, values[index]);
    if (result) return order.direction === "desc" ? -result : result;
  }
  return 0;
}

function compareValues(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""));
}
