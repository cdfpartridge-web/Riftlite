import type { Firestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: null as Firestore | null }));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: () => mocks.db,
}));

import {
  PrivateHubAggregateEventError,
  readPrivateHubAggregateDuplicate,
  recordPrivateHubAggregateEvent,
} from "@/lib/community/data";

describe("private-hub aggregate ownership", () => {
  let fake: FakeFirestore;

  beforeEach(() => {
    fake = new FakeFirestore({
      "hubs/hub-a": { role_mode: "account" },
      "aggregates/community-private-counters": { privateMatchCount: 0, privatePlayerCount: 0 },
      "aggregates/community-v1": { privateMatchCount: 0, privatePlayerCount: 0 },
    });
    mocks.db = fake.asFirestore();
  });

  it("counts an authoritative match owned by a proven historical identity under the canonical uid", async () => {
    fake.seed("hubs/hub-a/matches/match-a", { uid: "desktop-alias", username: "Player" });

    await expect(recordPrivateHubAggregateEvent(event("upsert"))).resolves.toMatchObject({
      privateMatchCount: 1,
      privatePlayerCount: 1,
    });

    expect(fake.get(indexPath())).toMatchObject({ uid: "account-canonical", username: "Player" });
    expect(fake.get("privateHubPlayers/account-canonical")).toMatchObject({
      uid: "account-canonical",
      matchCount: 1,
    });
  });

  it("reads only the deterministic index and counter for a proven duplicate", async () => {
    fake.seed(indexPath(), {
      hubId: "hub-a",
      matchId: "match-a",
      uid: "desktop-alias",
    });
    fake.seed("aggregates/community-private-counters", {
      privateMatchCount: 23,
      privatePlayerCount: 5,
    });

    await expect(readPrivateHubAggregateDuplicate({
      hubId: "hub-a",
      matchId: "match-a",
      identityUids: ["account-canonical", "desktop-alias"],
    }, fake.asFirestore())).resolves.toEqual({
      privateMatchCount: 23,
      privatePlayerCount: 5,
      alreadyPresent: true,
    });
    expect(fake.readPaths).toEqual([
      indexPath(),
      "aggregates/community-private-counters",
    ]);
  });

  it("does not fast-path a foreign or malformed index row", async () => {
    fake.seed(indexPath(), {
      hubId: "hub-a",
      matchId: "match-a",
      uid: "another-account",
    });

    await expect(readPrivateHubAggregateDuplicate({
      hubId: "hub-a",
      matchId: "match-a",
      identityUids: ["account-canonical", "desktop-alias"],
    }, fake.asFirestore())).resolves.toBeNull();
    expect(fake.readPaths).toEqual([indexPath()]);
  });

  it("rejects an upsert when the stored match belongs to another hub member", async () => {
    fake.seed("hubs/hub-a/matches/match-a", { uid: "another-account" });

    await expect(recordPrivateHubAggregateEvent(event("upsert"))).rejects.toMatchObject({
      code: "source_match_forbidden",
      status: 403,
    });
    expect(fake.get(indexPath())).toBeUndefined();
    expect(fake.get("aggregates/community-private-counters")).toMatchObject({ privateMatchCount: 0 });
  });

  it("rejects an upsert for a caller-supplied match id that does not exist", async () => {
    await expect(recordPrivateHubAggregateEvent(event("upsert"))).rejects.toMatchObject({
      code: "source_match_missing",
      status: 409,
    });
    expect(fake.get(indexPath())).toBeUndefined();
  });

  it("authorizes the desktop delete order from the server-owned index after the source match is gone", async () => {
    fake.seed(indexPath(), { hubId: "hub-a", matchId: "match-a", uid: "desktop-alias" });
    fake.seed("privateHubPlayers/desktop-alias", { uid: "desktop-alias", matchCount: 1 });
    fake.seed("aggregates/community-private-counters", { privateMatchCount: 1, privatePlayerCount: 1 });
    fake.seed("aggregates/community-v1", { privateMatchCount: 1, privatePlayerCount: 1 });

    await expect(recordPrivateHubAggregateEvent(event("delete"))).resolves.toMatchObject({
      privateMatchCount: 0,
      privatePlayerCount: 0,
    });
    expect(fake.get(indexPath())).toBeUndefined();
    expect(fake.get("privateHubPlayers/desktop-alias")).toBeUndefined();
  });

  it("cannot delete another player's aggregate after their source match is gone", async () => {
    fake.seed(indexPath(), { hubId: "hub-a", matchId: "match-a", uid: "another-account" });
    fake.seed("privateHubPlayers/another-account", { uid: "another-account", matchCount: 1 });
    fake.seed("aggregates/community-private-counters", { privateMatchCount: 1, privatePlayerCount: 1 });

    const promise = recordPrivateHubAggregateEvent(event("delete"));
    await expect(promise).rejects.toBeInstanceOf(PrivateHubAggregateEventError);
    await expect(promise).rejects.toMatchObject({ code: "source_match_forbidden", status: 403 });
    expect(fake.get(indexPath())).toBeDefined();
    expect(fake.get("aggregates/community-private-counters")).toMatchObject({ privateMatchCount: 1 });
  });
});

function event(action: "upsert" | "delete") {
  return {
    action,
    hubId: "hub-a",
    matchId: "match-a",
    uid: "account-canonical",
    identityUids: ["account-canonical", "desktop-alias"],
  } as const;
}

function indexPath(): string {
  return `privateHubMatchIndex/${encodeURIComponent("hub-a::match-a")}`;
}

type Row = Record<string, unknown>;
type FakeReference = {
  path: string;
  get: () => Promise<ReturnType<FakeFirestore["snapshot"]>>;
  collection: (name: string) => FakeCollection;
};
type FakeCollection = {
  doc: (id: string) => FakeReference;
};

class FakeFirestore {
  private readonly rows = new Map<string, Row>();
  readonly readPaths: string[] = [];

  constructor(seed: Record<string, Row>) {
    for (const [path, row] of Object.entries(seed)) this.seed(path, row);
  }

  asFirestore(): Firestore {
    return this as unknown as Firestore;
  }

  seed(path: string, row: Row): void {
    this.rows.set(path, { ...row });
  }

  get(path: string): Row | undefined {
    const row = this.rows.get(path);
    return row ? { ...row } : undefined;
  }

  collection(path: string): FakeCollection {
    return {
      doc: (id: string) => this.reference(`${path}/${id}`),
    };
  }

  async runTransaction<T>(callback: (tx: {
    get: (ref: FakeReference) => Promise<ReturnType<FakeFirestore["snapshot"]>>;
    set: (ref: FakeReference, row: Row, options?: { merge?: boolean }) => void;
    delete: (ref: FakeReference) => void;
  }) => Promise<T>): Promise<T> {
    const writes: Array<() => void> = [];
    const result = await callback({
      get: async (ref) => this.snapshot(ref),
      set: (ref, row, options) => writes.push(() => {
        const current = options?.merge ? this.rows.get(ref.path) ?? {} : {};
        this.rows.set(ref.path, { ...current, ...row });
      }),
      delete: (ref) => writes.push(() => {
        this.rows.delete(ref.path);
      }),
    });
    for (const write of writes) write();
    return result;
  }

  private reference(path: string): FakeReference {
    return {
      path,
      get: async () => {
        this.readPaths.push(path);
        return this.snapshot(this.reference(path));
      },
      collection: (name: string) => this.collection(`${path}/${name}`),
    };
  }

  snapshot(ref: FakeReference) {
    const row = this.rows.get(ref.path);
    return {
      exists: Boolean(row),
      data: () => row ? { ...row } : undefined,
      get: (field: string) => row?.[field],
    };
  }
}
