import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { migrateAccountCloudBackup } from "@/lib/social/server";

const SOURCE_UID = "desktop-source";
const CANONICAL_UID = "account-owner";
const SOURCE_MANIFEST_PATH = `accountSync/${SOURCE_UID}/manifest/current`;
const CANONICAL_MANIFEST_PATH = `accountSync/${CANONICAL_UID}/manifest/current`;

describe("account cloud backup identity migration", () => {
  it("reads and stages only chunks referenced by the validated source manifest", async () => {
    const db = fakeCloudMigrationDatabase();
    seedBackup(db, SOURCE_UID, "source-generation", "source-payload");
    db.seed(`accountSync/${SOURCE_UID}/chunks/stale-generation-chunk-0000`, {
      index: 0,
      payload: "must-not-be-read",
    });

    await migrateAccountCloudBackup(SOURCE_UID, CANONICAL_UID, 1_000, db as never);

    expect(db.readPaths).toContain(`accountSync/${SOURCE_UID}/chunks/source-generation-chunk-0000`);
    expect(db.readPaths).not.toContain(`accountSync/${SOURCE_UID}/chunks/stale-generation-chunk-0000`);
    const canonicalManifest = db.data(CANONICAL_MANIFEST_PATH);
    expect(canonicalManifest).toMatchObject({
      format: "riftlite.account-cloud-sync",
      version: 2,
      identityMigratedFromUid: SOURCE_UID,
      identityMigratedSourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(canonicalManifest.generation_id).not.toBe("source-generation");
    const canonicalChunks = db.paths(`accountSync/${CANONICAL_UID}/chunks/`);
    expect(canonicalChunks).toHaveLength(1);
    expect(db.data(canonicalChunks[0])).toMatchObject({
      payload: "source-payload",
      generation_id: canonicalManifest.generation_id,
      identityMigratedFromUid: SOURCE_UID,
    });
  });

  it("retains and flags a canonical backup created while source chunks are staging", async () => {
    const db = fakeCloudMigrationDatabase();
    seedBackup(db, SOURCE_UID, "source-generation", "source-payload");
    db.beforeTransaction = () => {
      seedBackup(db, CANONICAL_UID, "concurrent-generation", "canonical-payload");
    };

    await migrateAccountCloudBackup(SOURCE_UID, CANONICAL_UID, 2_000, db as never);

    expect(db.data(CANONICAL_MANIFEST_PATH).generation_id).toBe("concurrent-generation");
    expect(db.data(`identityAliases/${SOURCE_UID}`)).toMatchObject({
      cloudSyncConflict: true,
      cloudSyncSourceUid: SOURCE_UID,
      cloudSyncCanonicalUid: CANONICAL_UID,
    });
    expect(db.paths(`accountSync/${CANONICAL_UID}/chunks/`)).toEqual([
      `accountSync/${CANONICAL_UID}/chunks/concurrent-generation-chunk-0000`,
    ]);
  });

  it("does not switch to a staged generation when the source manifest changes", async () => {
    const db = fakeCloudMigrationDatabase();
    seedBackup(db, SOURCE_UID, "source-generation", "source-payload");
    db.beforeTransaction = () => {
      seedBackup(db, SOURCE_UID, "new-source-generation", "new-source-payload");
    };

    await expect(migrateAccountCloudBackup(SOURCE_UID, CANONICAL_UID, 3_000, db as never))
      .rejects.toThrow("changed during migration");

    expect(db.has(CANONICAL_MANIFEST_PATH)).toBe(false);
    expect(db.paths(`accountSync/${CANONICAL_UID}/chunks/`)).toEqual([]);
    expect(db.data(`identityAliases/${SOURCE_UID}`)).toMatchObject({
      cloudSyncMigrationSourceChanged: true,
      cloudSyncMigrationSourceChangedAt: 3_000,
    });
  });

  it("keeps a committed staged generation when the transaction acknowledgement is lost", async () => {
    const db = fakeCloudMigrationDatabase();
    seedBackup(db, SOURCE_UID, "source-generation", "source-payload");
    db.transactionCommitError = new Error("transaction acknowledgement lost");

    await expect(migrateAccountCloudBackup(SOURCE_UID, CANONICAL_UID, 3_500, db as never))
      .resolves.toBeUndefined();

    const canonicalManifest = db.data(CANONICAL_MANIFEST_PATH);
    expect(canonicalManifest).toMatchObject({
      identityMigratedFromUid: SOURCE_UID,
      identityMigratedSourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(db.paths(`accountSync/${CANONICAL_UID}/chunks/`)).toEqual([
      `accountSync/${CANONICAL_UID}/chunks/${canonicalManifest.generation_id}-chunk-0000`,
    ]);
    expect(db.data(`identityAliases/${SOURCE_UID}`).cloudSyncMigratedSourceFingerprint)
      .toBe(canonicalManifest.identityMigratedSourceFingerprint);
  });

  it("reopens a retained-backup conflict when the legacy source changes after migration", async () => {
    const db = fakeCloudMigrationDatabase();
    seedBackup(db, SOURCE_UID, "source-generation", "source-payload");
    await migrateAccountCloudBackup(SOURCE_UID, CANONICAL_UID, 4_000, db as never);
    const migratedGeneration = db.data(CANONICAL_MANIFEST_PATH).generation_id;

    seedBackup(db, SOURCE_UID, "later-source-generation", "later-source-payload");
    await migrateAccountCloudBackup(SOURCE_UID, CANONICAL_UID, 5_000, db as never);

    expect(db.data(CANONICAL_MANIFEST_PATH).generation_id).toBe(migratedGeneration);
    expect(db.data(`identityAliases/${SOURCE_UID}`)).toMatchObject({
      cloudSyncConflict: true,
      cloudSyncCheckedAt: 5_000,
    });
  });

  it("rejects an oversized inline migration before reading any chunk documents", async () => {
    const db = fakeCloudMigrationDatabase();
    const chunks = Array.from({ length: 65 }, () => "x");
    db.seed(SOURCE_MANIFEST_PATH, manifestData("oversized", chunks));

    await expect(migrateAccountCloudBackup(SOURCE_UID, CANONICAL_UID, 6_000, db as never))
      .rejects.toThrow("too large for safe inline migration");

    expect(db.readPaths.some((path) => path.includes("/chunks/"))).toBe(false);
    expect(db.has(CANONICAL_MANIFEST_PATH)).toBe(false);
  });

  it("surfaces an invalid retained manifest as repair attention without creating an unresolvable conflict", async () => {
    const db = fakeCloudMigrationDatabase();
    seedBackup(db, CANONICAL_UID, "current-generation", "current-payload");
    db.seed(SOURCE_MANIFEST_PATH, { format: "corrupt-backup", chunk_count: 1 });

    await expect(migrateAccountCloudBackup(SOURCE_UID, CANONICAL_UID, 7_000, db as never))
      .rejects.toThrow("invalid and needs support");

    expect(db.data(CANONICAL_MANIFEST_PATH).generation_id).toBe("current-generation");
    expect(db.data(`identityAliases/${SOURCE_UID}`)).toMatchObject({
      cloudSyncCheckedAt: 7_000,
    });
    expect(db.data(`identityAliases/${SOURCE_UID}`).cloudSyncConflict).not.toBe(true);
    expect(db.data(`users/${CANONICAL_UID}`).accountCloudSyncLegacySources).toBeUndefined();
  });

  it("rejects an undecodable v1 payload before promoting it to a checksummed v2 generation", async () => {
    const db = fakeCloudMigrationDatabase();
    const payload = "same-length-but-not-a-deflated-backup";
    db.seed(SOURCE_MANIFEST_PATH, {
      format: "riftlite.account-cloud-sync",
      version: 1,
      updated_at: "2026-07-18T12:00:00.000Z",
      device_id: "legacy-device",
      device_name: "Legacy device",
      app_version: "0.8.4",
      generation_id: "legacy-generation",
      chunk_count: 1,
      byte_size: Buffer.byteLength(payload, "utf8"),
      counts: { matches: 2, decks: 1, notebooks: 0, replays: 0 },
    });
    db.seed(`accountSync/${SOURCE_UID}/chunks/legacy-generation-chunk-0000`, {
      index: 0,
      payload,
    });

    await expect(migrateAccountCloudBackup(SOURCE_UID, CANONICAL_UID, 8_000, db as never))
      .rejects.toThrow("could not be decoded safely");

    expect(db.has(CANONICAL_MANIFEST_PATH)).toBe(false);
    expect(db.paths(`accountSync/${CANONICAL_UID}/chunks/`)).toEqual([]);
  });

  it("promotes a decoded v1 backup when its schema and counts match", async () => {
    const db = fakeCloudMigrationDatabase();
    const payload = deflateRawSync(Buffer.from(JSON.stringify({
      format: "riftlite.backup",
      version: 1,
      settings: {},
      matches: [{ id: "match-a" }],
      deletedMatches: [{ id: "match-b" }],
      decks: [{ id: "deck-a" }],
      notebooks: [],
      replays: [],
      deletedReplays: [],
    }), "utf8")).toString("base64");
    db.seed(SOURCE_MANIFEST_PATH, {
      format: "riftlite.account-cloud-sync",
      version: 1,
      updated_at: "2026-07-18T12:00:00.000Z",
      device_id: "legacy-device",
      device_name: "Legacy device",
      app_version: "0.8.4",
      generation_id: "legacy-generation",
      chunk_count: 1,
      byte_size: Buffer.byteLength(payload, "utf8"),
      counts: { matches: 2, decks: 1, notebooks: 0, replays: 0 },
    });
    db.seed(`accountSync/${SOURCE_UID}/chunks/legacy-generation-chunk-0000`, {
      index: 0,
      payload,
    });

    await expect(migrateAccountCloudBackup(SOURCE_UID, CANONICAL_UID, 9_000, db as never))
      .resolves.toBeUndefined();

    expect(db.data(CANONICAL_MANIFEST_PATH)).toMatchObject({
      version: 2,
      checksum_algorithm: "sha256",
      counts: { matches: 2, decks: 1, notebooks: 0, replays: 0 },
      identityMigratedFromUid: SOURCE_UID,
    });
  });
});

function seedBackup(
  db: ReturnType<typeof fakeCloudMigrationDatabase>,
  uid: string,
  generationId: string,
  payload: string,
) {
  db.seed(`accountSync/${uid}/manifest/current`, manifestData(generationId, [payload]));
  db.seed(`accountSync/${uid}/chunks/${generationId}-chunk-0000`, chunkData(generationId, 0, payload));
}

function manifestData(generationId: string, chunks: string[]) {
  const compressed = chunks.join("");
  return {
    format: "riftlite.account-cloud-sync",
    version: 2,
    updated_at: `2026-07-18T12:00:${String(chunks.length).padStart(2, "0")}.000Z`,
    device_id: `device-${generationId}`,
    device_name: "Test device",
    app_version: "0.8.5-dev.8",
    generation_id: generationId,
    chunk_count: chunks.length,
    byte_size: Buffer.byteLength(compressed, "utf8"),
    checksum_algorithm: "sha256",
    checksum: sha256(compressed),
    chunk_checksums: chunks.map(sha256),
    counts: { matches: 2, decks: 1, notebooks: 0, replays: 0 },
  };
}

function chunkData(generationId: string, index: number, payload: string) {
  return {
    format: "riftlite.account-cloud-sync",
    version: 2,
    generation_id: generationId,
    index,
    payload,
    byte_size: Buffer.byteLength(payload, "utf8"),
    checksum: sha256(payload),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function fakeCloudMigrationDatabase() {
  type StoredDocument = { data: Record<string, unknown>; version: number };
  type FakeReference = ReturnType<typeof reference>;
  const documents = new Map<string, StoredDocument>();
  let version = 0;
  const readPaths: string[] = [];
  let beforeTransaction: (() => void) | undefined;
  let transactionCommitError: Error | undefined;

  function snapshot(path: string) {
    const stored = documents.get(path);
    return {
      exists: Boolean(stored),
      data: () => stored ? { ...stored.data } : undefined,
      updateTime: stored ? {
        toDate: () => new Date(Date.UTC(2026, 6, 18, 12, 0, 0) + stored.version * 1_000),
      } : undefined,
    };
  }

  function write(path: string, data: Record<string, unknown>, merge = false) {
    version += 1;
    documents.set(path, {
      data: merge ? { ...(documents.get(path)?.data ?? {}), ...data } : { ...data },
      version,
    });
  }

  function reference(path: string) {
    return {
      path,
      collection: (collectionId: string) => ({
        doc: (documentId: string) => reference(`${path}/${collectionId}/${documentId}`),
        get: async () => { throw new Error("Unbounded collection reads are forbidden in this test"); },
      }),
      get: async () => {
        readPaths.push(path);
        return snapshot(path);
      },
      set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
        write(path, data, options?.merge === true);
      },
    };
  }

  function batch() {
    const operations: Array<() => void> = [];
    return {
      set: (ref: FakeReference, data: Record<string, unknown>, options?: { merge?: boolean }) => {
        operations.push(() => write(ref.path, data, options?.merge === true));
      },
      delete: (ref: FakeReference) => {
        operations.push(() => documents.delete(ref.path));
      },
      commit: async () => {
        for (const operation of operations) operation();
      },
    };
  }

  const db = {
    collection: (collectionId: string) => ({
      doc: (documentId: string) => reference(`${collectionId}/${documentId}`),
    }),
    batch,
    runTransaction: async <T>(callback: (transaction: {
      get: (ref: FakeReference) => Promise<ReturnType<typeof snapshot>>;
      set: (ref: FakeReference, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
    }) => Promise<T>) => {
      if (beforeTransaction) {
        const hook = beforeTransaction;
        beforeTransaction = undefined;
        hook();
      }
      const operations: Array<() => void> = [];
      const result = await callback({
        get: async (ref) => {
          readPaths.push(ref.path);
          return snapshot(ref.path);
        },
        set: (ref, data, options) => {
          operations.push(() => write(ref.path, data, options?.merge === true));
        },
      });
      for (const operation of operations) operation();
      if (transactionCommitError) {
        const error = transactionCommitError;
        transactionCommitError = undefined;
        throw error;
      }
      return result;
    },
  };

  return {
    ...db,
    get beforeTransaction() { return beforeTransaction; },
    set beforeTransaction(value: (() => void) | undefined) { beforeTransaction = value; },
    get transactionCommitError() { return transactionCommitError; },
    set transactionCommitError(value: Error | undefined) { transactionCommitError = value; },
    data: (path: string) => ({ ...(documents.get(path)?.data ?? {}) }),
    has: (path: string) => documents.has(path),
    paths: (prefix: string) => Array.from(documents.keys()).filter((path) => path.startsWith(prefix)).sort(),
    readPaths,
    seed: (path: string, data: Record<string, unknown>) => write(path, data),
  };
}
