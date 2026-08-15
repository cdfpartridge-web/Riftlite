import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import {
  deleteHubWebReplay,
  privateReplayHubAccessAllowsViewer,
  putHubWebReplay,
  replayHubGrantDocumentId,
} from "@/lib/replay-v2-server/hub-grants";
import type { ReplayRecord } from "@/lib/replay-v2-server/model";

const REPLAY_ID = `rl2_${"a".repeat(32)}`;

describe("private-hub Web Replay grants", () => {
  it("atomically links records owned through canonical identity aliases", async () => {
    const fake = new FakeFirestore({
      "hubs/hub-a": accountHub("hub-owner"),
      "hubs/hub-a/members/desktop-owner": { uid: "desktop-owner", role: "member" },
      "hubs/hub-a/matches/match-a": { uid: "desktop-owner", result: "Win" },
      [`replayV2/${REPLAY_ID}`]: replayRecord("account-owner", "match-a"),
    });

    await expect(putHubWebReplay(fake.asFirestore(), {
      hubId: "hub-a",
      matchId: "match-a",
      replayId: REPLAY_ID,
      actorUid: "account-owner",
      identityUids: ["account-owner", "desktop-owner"],
    })).resolves.toEqual({ hubId: "hub-a", matchId: "match-a", replayId: REPLAY_ID });

    expect(fake.get("hubs/hub-a/matches/match-a")?.web_replay_id).toBe(REPLAY_ID);
    expect(fake.get(`replayHubGrants/${replayHubGrantDocumentId("hub-a", "match-a")}`)).toMatchObject({
      schema: "riftlite-replay-hub-grant",
      version: 1,
      hubId: "hub-a",
      matchId: "match-a",
      replayId: REPLAY_ID,
      replayOwnerUid: "account-owner",
      grantedByUid: "account-owner",
    });

    const writesAfterFirstLink = fake.transactionWriteCount;
    await putHubWebReplay(fake.asFirestore(), {
      hubId: "hub-a",
      matchId: "match-a",
      replayId: REPLAY_ID,
      actorUid: "account-owner",
      identityUids: ["account-owner", "desktop-owner"],
    });
    expect(fake.transactionWriteCount).toBe(writesAfterFirstLink);
  });

  it("requires ownership of both the hub match and replay", async () => {
    const wrongMatch = new FakeFirestore({
      "hubs/hub-a": accountHub("hub-owner"),
      "hubs/hub-a/members/account-owner": { uid: "account-owner", role: "member" },
      "hubs/hub-a/matches/match-a": { uid: "someone-else" },
      [`replayV2/${REPLAY_ID}`]: replayRecord("account-owner", "match-a"),
    });
    await expect(putHubWebReplay(wrongMatch.asFirestore(), {
      hubId: "hub-a",
      matchId: "match-a",
      replayId: REPLAY_ID,
      actorUid: "account-owner",
      identityUids: ["account-owner"],
    })).rejects.toMatchObject({ code: "hub_match_owner_required", status: 403 });

    const wrongReplay = new FakeFirestore({
      "hubs/hub-a": accountHub("hub-owner"),
      "hubs/hub-a/members/account-owner": { uid: "account-owner", role: "member" },
      "hubs/hub-a/matches/match-a": { uid: "account-owner" },
      [`replayV2/${REPLAY_ID}`]: replayRecord("someone-else", "match-a"),
    });
    await expect(putHubWebReplay(wrongReplay.asFirestore(), {
      hubId: "hub-a",
      matchId: "match-a",
      replayId: REPLAY_ID,
      actorUid: "account-owner",
      identityUids: ["account-owner"],
    })).rejects.toMatchObject({ code: "replay_owner_required", status: 403 });
  });

  it("rejects legacy and deleting hubs", async () => {
    for (const [hub, expectedCode] of [
      [{ owner_uid: "owner" }, "account_hub_required"],
      [{ ...accountHub("owner"), lifecycle_state: "deleting" }, "hub_deleting"],
    ] as const) {
      const fake = new FakeFirestore({
        "hubs/hub-a": hub,
        "hubs/hub-a/matches/match-a": { uid: "owner" },
        [`replayV2/${REPLAY_ID}`]: replayRecord("owner", "match-a"),
      });
      await expect(putHubWebReplay(fake.asFirestore(), {
        hubId: "hub-a",
        matchId: "match-a",
        replayId: REPLAY_ID,
        actorUid: "owner",
        identityUids: ["owner"],
      })).rejects.toMatchObject({ code: expectedCode });
      expect(fake.transactionWriteCount).toBe(0);
      expect(fake.get("hubs/hub-a/matches/match-a")?.web_replay_id).toBeUndefined();
      expect(fake.has(`replayHubGrants/${replayHubGrantDocumentId("hub-a", "match-a")}`)).toBe(false);
    }
  });

  it("does not create a pointer or grant when the replay belongs to another match", async () => {
    const fake = new FakeFirestore({
      "hubs/hub-a": accountHub("hub-owner"),
      "hubs/hub-a/members/owner": { uid: "owner", role: "member" },
      "hubs/hub-a/matches/match-a": { uid: "owner" },
      [`replayV2/${REPLAY_ID}`]: replayRecord("owner", "match-b"),
    });

    await expect(putHubWebReplay(fake.asFirestore(), {
      hubId: "hub-a",
      matchId: "match-a",
      replayId: REPLAY_ID,
      actorUid: "owner",
      identityUids: ["owner"],
    })).rejects.toMatchObject({ code: "replay_match_mismatch", status: 409 });
    expect(fake.transactionWriteCount).toBe(0);
    expect(fake.get("hubs/hub-a/matches/match-a")?.web_replay_id).toBeUndefined();
    expect(fake.has(`replayHubGrants/${replayHubGrantDocumentId("hub-a", "match-a")}`)).toBe(false);
  });

  it("authorizes a current member alias and immediately revokes stale grants", async () => {
    const grantId = replayHubGrantDocumentId("hub-a", "match-a");
    const seed = {
      "hubs/hub-a": accountHub("hub-owner"),
      "hubs/hub-a/members/viewer-old": { uid: "viewer-old", role: "member" },
      "hubs/hub-a/matches/match-a": { uid: "replay-owner", web_replay_id: REPLAY_ID },
      [`replayHubGrants/${grantId}`]: grantRecord("hub-a", "match-a", "replay-owner"),
      "users/viewer-account": { identityAliases: ["viewer-old"] },
      "identityAliases/viewer-old": { canonicalUid: "viewer-account" },
    };
    const fake = new FakeFirestore(seed);
    const replay = replayRecord("replay-owner", "match-a");

    await expect(privateReplayHubAccessAllowsViewer(
      fake.asFirestore(),
      replay,
      "viewer-account",
    )).resolves.toBe(true);

    fake.delete("hubs/hub-a/members/viewer-old");
    await expect(privateReplayHubAccessAllowsViewer(fake.asFirestore(), replay, "viewer-account"))
      .resolves.toBe(false);

    fake.set("hubs/hub-a/members/viewer-old", { uid: "viewer-old", role: "member" });
    fake.delete("hubs/hub-a/matches/match-a");
    await expect(privateReplayHubAccessAllowsViewer(fake.asFirestore(), replay, "viewer-account"))
      .resolves.toBe(false);
  });

  it("denies outsiders and legacy hubs, while retaining canonical owner access", async () => {
    const grantId = replayHubGrantDocumentId("hub-a", "match-a");
    const fake = new FakeFirestore({
      "hubs/hub-a": { owner_uid: "hub-owner" },
      "hubs/hub-a/members/viewer": { uid: "viewer", role: "member" },
      "hubs/hub-a/matches/match-a": { uid: "owner-old", web_replay_id: REPLAY_ID },
      [`replayHubGrants/${grantId}`]: grantRecord("hub-a", "match-a", "owner-old"),
      "users/owner-account": { identityAliases: ["owner-old"] },
      "identityAliases/owner-old": { canonicalUid: "owner-account" },
    });
    const replay = replayRecord("owner-old", "match-a");

    await expect(privateReplayHubAccessAllowsViewer(fake.asFirestore(), replay, "viewer"))
      .resolves.toBe(false);
    await expect(privateReplayHubAccessAllowsViewer(fake.asFirestore(), replay, "outsider"))
      .resolves.toBe(false);
    await expect(privateReplayHubAccessAllowsViewer(fake.asFirestore(), replay, "owner-account"))
      .resolves.toBe(true);
  });

  it("unlinks the pointer and deterministic grant together", async () => {
    const grantId = replayHubGrantDocumentId("hub-a", "match-a");
    const fake = new FakeFirestore({
      "hubs/hub-a": accountHub("hub-owner"),
      "hubs/hub-a/members/match-owner": { uid: "match-owner", role: "admin" },
      "hubs/hub-a/matches/match-a": { uid: "match-owner", web_replay_id: REPLAY_ID },
      [`replayHubGrants/${grantId}`]: grantRecord("hub-a", "match-a", "match-owner"),
    });

    const result = await deleteHubWebReplay(fake.asFirestore(), {
      hubId: "hub-a",
      matchId: "match-a",
      actorUid: "match-owner",
      identityUids: ["match-owner"],
    });

    expect(result).toMatchObject({ replayId: REPLAY_ID, unlinked: true, alreadyUnlinked: false });
    expect(fake.get("hubs/hub-a/matches/match-a")?.web_replay_id).toBeUndefined();
    expect(fake.has(`replayHubGrants/${grantId}`)).toBe(false);
  });

  it("lets a former member revoke their own replay grant after leaving", async () => {
    const grantId = replayHubGrantDocumentId("hub-a", "match-a");
    const fake = new FakeFirestore({
      "hubs/hub-a": accountHub("hub-owner"),
      "hubs/hub-a/matches/match-a": { uid: "former-member", web_replay_id: REPLAY_ID },
      [`replayHubGrants/${grantId}`]: grantRecord("hub-a", "match-a", "former-member"),
    });

    await expect(deleteHubWebReplay(fake.asFirestore(), {
      hubId: "hub-a",
      matchId: "match-a",
      actorUid: "former-member",
      identityUids: ["former-member"],
    })).resolves.toMatchObject({ unlinked: true });
    expect(fake.has(`replayHubGrants/${grantId}`)).toBe(false);
  });
});

function accountHub(ownerUid: string): Record<string, unknown> {
  return {
    role_mode: "account",
    lifecycle_state: "active",
    owner_uid: ownerUid,
    created_by: ownerUid,
  };
}

function replayRecord(ownerUid: string, matchId: string): ReplayRecord {
  return {
    schema: "riftlite-replay-record",
    version: 2,
    replayId: REPLAY_ID,
    ownerUid,
    captureId: "capture-a",
    visibility: "private",
    status: "ready",
    title: "Private replay",
    platform: "atlas",
    localReplayId: "local-replay-a",
    matchId,
    seriesId: "",
    roomCode: "",
    messageCount: 1,
    expectedRaw: { sha256: "b".repeat(64), bytes: 100 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function grantRecord(hubId: string, matchId: string, replayOwnerUid: string): Record<string, unknown> {
  return {
    schema: "riftlite-replay-hub-grant",
    version: 1,
    hubId,
    matchId,
    replayId: REPLAY_ID,
    replayOwnerUid,
    grantedByUid: replayOwnerUid,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

type Row = Record<string, unknown>;
type FakeDocumentReference = {
  path: string;
  id: string;
  get: () => Promise<FakeDocumentSnapshot>;
  collection: (name: string) => FakeCollectionReference;
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
  where: (field: string, operator: string, value: unknown) => FakeQuery;
  limit: (maximum: number) => FakeQuery;
  get: () => Promise<FakeQuerySnapshot>;
};
type FakeCollectionReference = {
  path: string;
  doc: (id: string) => FakeDocumentReference;
  where: (field: string, operator: string, value: unknown) => FakeQuery;
};

class FakeFirestore {
  private readonly documents = new Map<string, Row>();
  transactionWriteCount = 0;

  constructor(seed: Record<string, Row>) {
    for (const [path, value] of Object.entries(seed)) this.set(path, value);
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

  set(path: string, value: Row): void {
    this.documents.set(path, { ...value });
  }

  delete(path: string): void {
    this.documents.delete(path);
  }

  collection(path: string): FakeCollectionReference {
    return {
      path,
      doc: (id: string) => this.document(`${path}/${id}`),
      where: (field: string, operator: string, value: unknown) => {
        if (operator !== "==") throw new Error(`Unsupported operator ${operator}`);
        return this.query(path, [{ field, value }]);
      },
    };
  }

  async getAll(...references: FakeDocumentReference[]): Promise<FakeDocumentSnapshot[]> {
    return references.map((reference) => this.snapshot(reference));
  }

  async runTransaction<T>(callback: (transaction: {
    getAll: (...references: FakeDocumentReference[]) => Promise<FakeDocumentSnapshot[]>;
    update: (reference: FakeDocumentReference, data: Row) => void;
    set: (reference: FakeDocumentReference, data: Row) => void;
    delete: (reference: FakeDocumentReference) => void;
  }) => Promise<T>): Promise<T> {
    const writes: Array<() => void> = [];
    const result = await callback({
      getAll: (...references) => this.getAll(...references),
      update: (reference, data) => writes.push(() => this.applyUpdate(reference.path, data)),
      set: (reference, data) => writes.push(() => this.set(reference.path, data)),
      delete: (reference) => writes.push(() => this.delete(reference.path)),
    });
    this.transactionWriteCount += writes.length;
    for (const write of writes) write();
    return result;
  }

  private document(path: string): FakeDocumentReference {
    return {
      path,
      id: path.split("/").at(-1) ?? "",
      get: async () => this.snapshot(this.document(path)),
      collection: (name: string) => this.collection(`${path}/${name}`),
    };
  }

  private snapshot(reference: FakeDocumentReference): FakeDocumentSnapshot {
    const data = this.documents.get(reference.path);
    return {
      ref: reference,
      id: reference.id,
      exists: Boolean(data),
      data: () => data ? { ...data } : undefined,
      get: (field: string) => data?.[field],
    };
  }

  private query(path: string, filters: Array<{ field: string; value: unknown }>, maximum = Infinity): FakeQuery {
    return {
      where: (field, operator, value) => {
        if (operator !== "==") throw new Error(`Unsupported operator ${operator}`);
        return this.query(path, [...filters, { field, value }], maximum);
      },
      limit: (value) => this.query(path, filters, value),
      get: async () => {
        const parentDepth = path.split("/").length;
        const docs = Array.from(this.documents.keys())
          .filter((candidate) => candidate.startsWith(`${path}/`))
          .filter((candidate) => candidate.split("/").length === parentDepth + 1)
          .map((candidate) => this.snapshot(this.document(candidate)))
          .filter((snapshot) => filters.every((filter) => snapshot.get(filter.field) === filter.value))
          .slice(0, maximum);
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }

  private applyUpdate(path: string, update: Row): void {
    const next = { ...(this.documents.get(path) ?? {}) };
    for (const [key, value] of Object.entries(update)) {
      if (value?.constructor?.name === "DeleteTransform") delete next[key];
      else next[key] = value;
    }
    this.documents.set(path, next);
  }
}
