import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import {
  deletePrivateHub,
  HubLifecycleError,
  leavePrivateHub,
  primaryOwnerUid,
} from "@/lib/social/hub-lifecycle";

describe("private hub lifecycle", () => {
  it("lets a member or co-owner leave across every linked identity", async () => {
    const fake = new FakeFirestore({
      "hubs/hub-a": privateHub("primary-owner"),
      "hubs/hub-a/members/account-uid": { uid: "account-uid", role: "admin" },
      "hubs/hub-a/members/desktop-uid": { uid: "desktop-uid", role: "member" },
    });

    const result = await leavePrivateHub(fake.asFirestore(), "hub-a", ["account-uid", "desktop-uid"]);

    expect(result).toEqual({ hubId: "hub-a", left: true, alreadyLeft: false });
    expect(fake.has("hubs/hub-a/members/account-uid")).toBe(false);
    expect(fake.has("hubs/hub-a/members/desktop-uid")).toBe(false);
    expect(fake.has("hubs/hub-a")).toBe(true);
  });

  it("makes repeat leave harmless but requires the primary owner to delete", async () => {
    const fake = new FakeFirestore({ "hubs/hub-a": privateHub("owner-uid") });

    await expect(leavePrivateHub(fake.asFirestore(), "hub-a", ["owner-uid"]))
      .rejects.toMatchObject({ code: "owner_must_delete", status: 409 });
    await expect(leavePrivateHub(fake.asFirestore(), "hub-a", ["member-uid"]))
      .resolves.toEqual({ hubId: "hub-a", left: false, alreadyLeft: true });
  });

  it("allows only the authoritative primary owner, never a role document, to delete", async () => {
    const fake = new FakeFirestore({
      "hubs/hub-a": privateHub("primary-owner"),
      "hubs/hub-a/members/coowner": { uid: "coowner", role: "owner" },
      "hubInvites/invite-a": { hubId: "hub-a" },
    });

    await expect(deletePrivateHub(fake.asFirestore(), "hub-a", ["coowner"]))
      .rejects.toMatchObject({ code: "primary_owner_required", status: 403 });
    expect(fake.get("hubs/hub-a")?.lifecycle_state).toBeUndefined();
    expect(fake.has("hubInvites/invite-a")).toBe(true);
  });

  it("deletes only the selected hub, its cross-references, and its private counters", async () => {
    const fake = new FakeFirestore({
      "hubs/hub-a": privateHub("primary-owner"),
      "hubs/hub-a/members/primary-owner": { uid: "primary-owner", role: "owner" },
      "hubs/hub-a/matches/a-1": { uid: "player-a" },
      "hubs/hub-a/messages/message-a": { uid: "player-a" },
      "hubs/hub-b": privateHub("other-owner"),
      "hubs/hub-b/matches/b-1": { uid: "player-a" },
      "hubInvites/invite-a": { hubId: "hub-a" },
      "hubInvites/invite-b": { hubId: "hub-b" },
      "users/player-a/inbox/invite-a": { hubId: "hub-a" },
      "users/player-a/inbox/invite-b": { hubId: "hub-b" },
      "replayDiscordShares/share-a": { hubId: "hub-a" },
      "replayDiscordShares/share-b": { hubId: "hub-b" },
      "replayHubGrants/grant-a": { hubId: "hub-a", replayId: "replay-a" },
      "replayHubGrants/grant-b": { hubId: "hub-b", replayId: "replay-b" },
      "discordGuildConfigs/guild-a": { hubId: "hub-a" },
      "discordGuildConfigs/guild-a/testingGoals/goal-a": { status: "active" },
      "discordGuildConfigs/guild-b": { hubId: "hub-b" },
      "discordGuildConfigs/guild-b/testingGoals/goal-b": { status: "active" },
      "privateHubMatchIndex/a-1": { hubId: "hub-a", matchId: "a-1", uid: "player-a" },
      "privateHubMatchIndex/a-2": { hubId: "hub-a", matchId: "a-2", uid: "player-b" },
      "privateHubMatchIndex/b-1": { hubId: "hub-b", matchId: "b-1", uid: "player-a" },
      "privateHubPlayers/player-a": { uid: "player-a", matchCount: 2 },
      "privateHubPlayers/player-b": { uid: "player-b", matchCount: 1 },
      "aggregates/community-private-counters": { privateMatchCount: 3, privatePlayerCount: 2 },
      "aggregates/community-v1": { privateMatchCount: 3, privatePlayerCount: 2 },
    });

    const first = await deletePrivateHub(fake.asFirestore(), "hub-a", ["primary-owner"]);
    const second = await deletePrivateHub(fake.asFirestore(), "hub-a", ["any-signed-in-uid"]);

    expect(first).toEqual({ hubId: "hub-a", deleted: true, alreadyDeleted: false });
    expect(second).toEqual({ hubId: "hub-a", deleted: false, alreadyDeleted: true });
    expect(fake.paths().filter((path) => path === "hubs/hub-a" || path.startsWith("hubs/hub-a/"))).toEqual([]);
    expect(fake.has("hubInvites/invite-a")).toBe(false);
    expect(fake.has("users/player-a/inbox/invite-a")).toBe(false);
    expect(fake.has("replayDiscordShares/share-a")).toBe(false);
    expect(fake.has("replayHubGrants/grant-a")).toBe(false);
    expect(fake.has("discordGuildConfigs/guild-a")).toBe(false);
    expect(fake.has("discordGuildConfigs/guild-a/testingGoals/goal-a")).toBe(false);
    expect(fake.has("privateHubMatchIndex/a-1")).toBe(false);
    expect(fake.has("privateHubMatchIndex/a-2")).toBe(false);
    expect(fake.has("privateHubPlayers/player-b")).toBe(false);
    expect(fake.get("privateHubPlayers/player-a")?.matchCount).toBe(1);
    expect(fake.get("aggregates/community-private-counters")).toMatchObject({
      privateMatchCount: 1,
      privatePlayerCount: 1,
    });
    expect(fake.get("aggregates/community-v1")).toMatchObject({
      privateMatchCount: 1,
      privatePlayerCount: 1,
    });

    expect(fake.has("hubs/hub-b")).toBe(true);
    expect(fake.has("hubs/hub-b/matches/b-1")).toBe(true);
    expect(fake.has("hubInvites/invite-b")).toBe(true);
    expect(fake.has("users/player-a/inbox/invite-b")).toBe(true);
    expect(fake.has("replayDiscordShares/share-b")).toBe(true);
    expect(fake.has("replayHubGrants/grant-b")).toBe(true);
    expect(fake.has("discordGuildConfigs/guild-b/testingGoals/goal-b")).toBe(true);
    expect(fake.has("privateHubMatchIndex/b-1")).toBe(true);
  });

  it("rejects legacy password hubs and uses owner_uid as the primary-owner authority", async () => {
    const fake = new FakeFirestore({
      "hubs/legacy-hub": { owner_uid: "owner", created_by: "creator" },
    });
    await expect(deletePrivateHub(fake.asFirestore(), "legacy-hub", ["owner"]))
      .rejects.toMatchObject({ code: "private_hub_required", status: 409 });
    expect(primaryOwnerUid({ owner_uid: "current", created_by: "creator" })).toBe("current");
    expect(primaryOwnerUid({ created_by: "creator" })).toBe("creator");
  });

  it("uses typed lifecycle errors", () => {
    const error = new HubLifecycleError("message", "hub_not_found", 404);
    expect(error).toMatchObject({ name: "HubLifecycleError", code: "hub_not_found", status: 404 });
  });
});

function privateHub(ownerUid: string): Record<string, unknown> {
  return {
    name: "Private Hub",
    role_mode: "account",
    hidden: true,
    owner_uid: ownerUid,
    created_by: ownerUid,
  };
}

type Row = Record<string, unknown>;
type FakeDocumentReference = {
  _kind: "document";
  path: string;
  id: string;
  get: () => Promise<FakeDocumentSnapshot>;
  collection: (name: string) => FakeCollectionReference;
  listCollections: () => Promise<FakeCollectionReference[]>;
  delete: () => Promise<void>;
};
type FakeDocumentSnapshot = {
  ref: FakeDocumentReference;
  id: string;
  exists: boolean;
  data: () => Row | undefined;
  get: (field: string) => unknown;
};
type FakeQuerySnapshot = {
  docs: FakeDocumentSnapshot[];
  size: number;
  empty: boolean;
};
type FakeQuery = {
  _kind: "query";
  where: (field: string, operator: string, value: unknown) => FakeQuery;
  limit: (maximum: number) => FakeQuery;
  get: () => Promise<FakeQuerySnapshot>;
};
type FakeCollectionReference = {
  path: string;
  doc: (id: string) => FakeDocumentReference;
  where: (field: string, operator: string, value: unknown) => FakeQuery;
  limit: (maximum: number) => FakeQuery;
  get: () => Promise<FakeQuerySnapshot>;
};
type FakeQueryState = {
  collectionPath?: string;
  collectionGroup?: string;
  filters?: Array<{ field: string; value: unknown }>;
  maximum?: number;
};

class FakeFirestore {
  private readonly documents = new Map<string, Row>();

  constructor(seed: Record<string, Row>) {
    for (const [path, data] of Object.entries(seed)) this.documents.set(path, { ...data });
  }

  asFirestore(): Firestore {
    return this as unknown as Firestore;
  }

  has(path: string): boolean {
    return this.documents.has(path);
  }

  get(path: string): Row | undefined {
    return this.documents.get(path);
  }

  paths(): string[] {
    return Array.from(this.documents.keys()).sort();
  }

  collection(path: string): FakeCollectionReference {
    return this.collectionReference(path);
  }

  collectionGroup(collectionId: string): FakeQuery {
    return this.query({ collectionGroup: collectionId });
  }

  async getAll(...refs: FakeDocumentReference[]): Promise<FakeDocumentSnapshot[]> {
    return refs.map((ref) => this.snapshot(ref));
  }

  batch() {
    const deletes: FakeDocumentReference[] = [];
    return {
      delete: (ref: FakeDocumentReference) => deletes.push(ref),
      commit: async () => {
        for (const ref of deletes) this.documents.delete(ref.path);
      },
    };
  }

  async runTransaction<T>(callback: (tx: {
    get: (target: FakeDocumentReference | FakeQuery) => Promise<unknown>;
    set: (ref: FakeDocumentReference, data: Row, options?: { merge?: boolean }) => void;
    delete: (ref: FakeDocumentReference) => void;
  }) => Promise<T>): Promise<T> {
    const writes: Array<() => void> = [];
    const result = await callback({
      get: async (target) => target._kind === "query" ? target.get() : this.snapshot(target),
      set: (ref, data, options) => writes.push(() => this.set(ref.path, data, options?.merge === true)),
      delete: (ref) => writes.push(() => this.documents.delete(ref.path)),
    });
    for (const write of writes) write();
    return result;
  }

  async recursiveDelete(collection: { path: string }): Promise<void> {
    const prefix = `${collection.path}/`;
    for (const path of this.paths()) {
      if (path.startsWith(prefix)) this.documents.delete(path);
    }
  }

  documentReference(path: string): FakeDocumentReference {
    return {
      _kind: "document" as const,
      path,
      id: path.split("/").at(-1) ?? "",
      get: async () => this.snapshot(this.documentReference(path)),
      collection: (name: string) => this.collectionReference(`${path}/${name}`),
      listCollections: async () => {
        const segments = path.split("/");
        const names = new Set<string>();
        for (const candidate of this.documents.keys()) {
          const candidateSegments = candidate.split("/");
          if (candidate.startsWith(`${path}/`) && candidateSegments.length > segments.length + 1) {
            names.add(candidateSegments[segments.length]);
          }
        }
        return Array.from(names, (name) => this.collectionReference(`${path}/${name}`));
      },
      delete: async () => {
        this.documents.delete(path);
      },
    };
  }

  query(input: FakeQueryState): FakeQuery {
    const state = { ...input, filters: [...(input.filters ?? [])] };
    return {
      _kind: "query" as const,
      where: (field: string, operator: string, value: unknown) => {
        if (operator !== "==") throw new Error(`Unsupported fake query operator: ${operator}`);
        return this.query({ ...state, filters: [...state.filters, { field, value }] });
      },
      limit: (maximum: number) => this.query({ ...state, maximum }),
      get: async () => {
        const documents = this.paths()
          .filter((path) => this.queryIncludesPath(path, state.collectionPath, state.collectionGroup))
          .map((path) => this.snapshot(this.documentReference(path)))
          .filter((snapshot) => state.filters.every((filter) => snapshot.get(filter.field) === filter.value))
          .slice(0, state.maximum ?? Number.POSITIVE_INFINITY);
        return { docs: documents, size: documents.length, empty: documents.length === 0 };
      },
    };
  }

  private collectionReference(path: string): FakeCollectionReference {
    return {
      path,
      doc: (id: string) => this.documentReference(`${path}/${id}`),
      where: (field: string, operator: string, value: unknown) =>
        this.query({ collectionPath: path }).where(field, operator, value),
      limit: (maximum: number) => this.query({ collectionPath: path }).limit(maximum),
      get: () => this.query({ collectionPath: path }).get(),
    };
  }

  private snapshot(ref: FakeDocumentReference): FakeDocumentSnapshot {
    const data = this.documents.get(ref.path);
    return {
      ref,
      id: ref.id,
      exists: Boolean(data),
      data: () => data ? { ...data } : undefined,
      get: (field: string) => data?.[field],
    };
  }

  private set(path: string, data: Row, merge: boolean): void {
    this.documents.set(path, merge ? { ...(this.documents.get(path) ?? {}), ...data } : { ...data });
  }

  private queryIncludesPath(path: string, collectionPath?: string, collectionGroup?: string): boolean {
    const segments = path.split("/");
    if (collectionPath) {
      const parent = segments.slice(0, -1).join("/");
      return parent === collectionPath;
    }
    return Boolean(collectionGroup && segments.at(-2) === collectionGroup);
  }
}
