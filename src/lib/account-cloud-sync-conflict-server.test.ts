import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  accountCloudSyncConflictId,
  accountCloudSyncManifestFingerprint,
  accountCloudSyncRecoveryArchiveId,
  normalizeAccountCloudSyncManifest,
} from "@/lib/account-cloud-sync-conflict";

const mocks = vi.hoisted(() => ({
  identityUidsFor: vi.fn(),
  linkedReplayUid: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/replay-v2-server/identity", () => ({
  linkedReplayUid: mocks.linkedReplayUid,
}));

vi.mock("@/lib/social/server", () => ({
  identityUidsFor: mocks.identityUidsFor,
  requireUser: mocks.requireUser,
  socialJson: (body: Record<string, unknown>, status = 200) => Response.json(body, { status }),
}));

import {
  AccountCloudSyncConflictError,
  listAccountCloudSyncConflicts,
  requireCanonicalAccountCloudSyncOwner,
  resolveAccountCloudSyncConflict,
} from "@/lib/account-cloud-sync-conflict-server";

describe("retained backup canonical-owner authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.linkedReplayUid.mockReturnValue("");
  });

  it("accepts an exact canonical Google or email credential", async () => {
    mocks.linkedReplayUid.mockReturnValue("account-owner");
    mocks.requireUser.mockResolvedValue(authResult({
      authenticatedUid: "account-owner",
      decodedUid: "account-owner",
      provider: "google.com",
      selfAlias: {},
    }));

    const owner = await requireCanonicalAccountCloudSyncOwner({} as never);

    expect(owner).toMatchObject({ uid: "account-owner", authenticatedUid: "account-owner" });
  });

  it("accepts a canonical custom-token credential only with its server-owned self alias", async () => {
    mocks.requireUser.mockResolvedValue(authResult({
      authenticatedUid: "account-owner",
      decodedUid: "account-owner",
      provider: "custom",
      selfAlias: { sourceUid: "account-owner", canonicalUid: "account-owner" },
    }));

    const owner = await requireCanonicalAccountCloudSyncOwner({} as never);

    expect(owner).toMatchObject({ uid: "account-owner", authenticatedUid: "account-owner" });
  });

  it("rejects a custom-token credential without the canonical self association", async () => {
    mocks.requireUser.mockResolvedValue(authResult({
      authenticatedUid: "account-owner",
      decodedUid: "account-owner",
      provider: "custom",
      selfAlias: { sourceUid: "someone-else", canonicalUid: "account-owner" },
    }));

    const owner = await requireCanonicalAccountCloudSyncOwner({} as never);

    expect(owner).toHaveProperty("error");
    if ("error" in owner) {
      expect(owner.error.status).toBe(401);
      expect(owner.error.headers.get("cache-control")).toContain("no-store");
      expect(owner.error.headers.get("vary")).toContain("Authorization");
    }
  });

  it("rejects an anonymous historical alias even when requireUser canonicalized its decoded uid", async () => {
    mocks.requireUser.mockResolvedValue(authResult({
      authenticatedUid: "desktop-alias",
      decodedUid: "account-owner",
      provider: "anonymous",
      selfAlias: { sourceUid: "account-owner", canonicalUid: "account-owner" },
    }));

    const owner = await requireCanonicalAccountCloudSyncOwner({} as never);

    expect(owner).toHaveProperty("error");
    if ("error" in owner) expect(owner.error.status).toBe(409);
  });
});

describe("retained backup ownership and atomic resolution", () => {
  const canonicalUid = "account-owner";
  const sourceUid = "desktop-source";
  const conflictId = accountCloudSyncConflictId(canonicalUid, sourceUid);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identityUidsFor.mockResolvedValue([canonicalUid, sourceUid]);
  });

  it("lists a conflict only when the exact source alias belongs to the canonical owner", async () => {
    const db = fakeConflictDatabase();

    await expect(listAccountCloudSyncConflicts(db as never, canonicalUid)).resolves.toHaveLength(1);

    db.setData(`identityAliases/${sourceUid}`, conflictAlias({ canonicalUid: "another-owner" }));
    await expect(listAccountCloudSyncConflicts(db as never, canonicalUid)).resolves.toEqual([]);
  });

  it("does not keep the current backup after its displayed fingerprint changed", async () => {
    const db = fakeConflictDatabase();
    const fingerprints = conflictFingerprints(db);

    const resolution = resolveAccountCloudSyncConflict(db as never, canonicalUid, canonicalUid, conflictId, {
      choice: "keep-current",
      legacyFingerprint: fingerprints.legacy,
      currentFingerprint: "d".repeat(64),
    });

    await expectConflictError(resolution, 409);
    expect(db.data(`identityAliases/${sourceUid}`).cloudSyncConflict).toBe(true);
  });

  it("rejects a restore when a staged chunk is missing and preserves the current backup", async () => {
    const db = fakeConflictDatabase();
    const fingerprints = conflictFingerprints(db);
    const stagedManifest = stageRecovery(db, conflictId, fingerprints);
    db.deleteData(`accountSync/${canonicalUid}/chunks/staged-generation-chunk-0000`);

    const resolution = resolveAccountCloudSyncConflict(db as never, canonicalUid, canonicalUid, conflictId, {
      choice: "restore-legacy",
      legacyFingerprint: fingerprints.legacy,
      currentFingerprint: fingerprints.current,
      stagedManifest,
    });

    await expectConflictError(resolution, 409);
    expect(db.data(`identityAliases/${sourceUid}`).cloudSyncConflict).toBe(true);
    expect(db.data(`accountSync/${canonicalUid}/manifest/current`).generation_id).toBe("current-generation");
    expect(db.data(recoveryArchivePath(canonicalUid, conflictId, fingerprints))).toEqual({});
  });

  it("rejects a staged chunk with the wrong payload", async () => {
    const db = fakeConflictDatabase();
    const fingerprints = conflictFingerprints(db);
    const stagedManifest = stageRecovery(db, conflictId, fingerprints);
    db.setData(`accountSync/${canonicalUid}/chunks/staged-generation-chunk-0000`, chunkData(
      "staged-generation",
      "wrong-retained-payload",
      {
        recovery_conflict_id: conflictId,
        recovery_source_fingerprint: fingerprints.legacy,
      },
    ));

    const resolution = resolveAccountCloudSyncConflict(db as never, canonicalUid, canonicalUid, conflictId, {
      choice: "restore-legacy",
      legacyFingerprint: fingerprints.legacy,
      currentFingerprint: fingerprints.current,
      stagedManifest,
    });

    await expectConflictError(resolution, 409);
    expect(db.data(`accountSync/${canonicalUid}/manifest/current`).generation_id).toBe("current-generation");
    expect(db.data(`identityAliases/${sourceUid}`).cloudSyncConflict).toBe(true);
  });

  it("preserves a concurrently changed canonical backup and leaves the conflict pending", async () => {
    const db = fakeConflictDatabase();
    const fingerprints = conflictFingerprints(db);
    const stagedManifest = stageRecovery(db, conflictId, fingerprints);
    db.setBeforeTransaction(() => {
      db.setData(`accountSync/${canonicalUid}/manifest/current`, manifestData(
        "concurrent-generation",
        "concurrent-current-payload",
      ));
    });

    const resolution = resolveAccountCloudSyncConflict(db as never, canonicalUid, canonicalUid, conflictId, {
      choice: "restore-legacy",
      legacyFingerprint: fingerprints.legacy,
      currentFingerprint: fingerprints.current,
      stagedManifest,
    });

    await expectConflictError(resolution, 409);
    expect(db.data(`accountSync/${canonicalUid}/manifest/current`).generation_id).toBe("concurrent-generation");
    expect(db.data(`identityAliases/${sourceUid}`).cloudSyncConflict).toBe(true);
    expect(db.data(recoveryArchivePath(canonicalUid, conflictId, fingerprints))).toEqual({});
  });

  it("archives and switches the canonical manifest atomically, then repeats idempotently", async () => {
    const db = fakeConflictDatabase();
    const fingerprints = conflictFingerprints(db);
    const stagedManifest = stageRecovery(db, conflictId, fingerprints);
    const input = {
      choice: "restore-legacy" as const,
      legacyFingerprint: fingerprints.legacy,
      currentFingerprint: fingerprints.current,
      stagedManifest,
    };

    const first = await resolveAccountCloudSyncConflict(db as never, canonicalUid, canonicalUid, conflictId, input);
    const archivePath = recoveryArchivePath(canonicalUid, conflictId, fingerprints);
    const archivedAfterFirst = db.data(archivePath);
    const second = await resolveAccountCloudSyncConflict(db as never, canonicalUid, canonicalUid, conflictId, input);

    expect(first).toMatchObject({ status: "resolved", choice: "restore-legacy" });
    expect(second).toEqual(first);
    expect(db.data(`accountSync/${canonicalUid}/manifest/current`)).toMatchObject({
      generation_id: "staged-generation",
      recovery_conflict_id: conflictId,
      recovery_source_fingerprint: fingerprints.legacy,
      recovery_previous_canonical_fingerprint: fingerprints.current,
    });
    expect(archivedAfterFirst).toMatchObject({
      format: "riftlite.account-cloud-sync-recovery-archive",
      conflict_id: conflictId,
      previous_fingerprint: fingerprints.current,
      replacement_generation_id: "staged-generation",
      manifest: { generation_id: "current-generation" },
    });
    expect(db.data(archivePath)).toEqual(archivedAfterFirst);
    expect(db.data(`identityAliases/${sourceUid}`)).toMatchObject({
      cloudSyncConflict: false,
      cloudSyncConflictId: conflictId,
      cloudSyncResolution: "restore-legacy",
      cloudSyncResolvedSourceFingerprint: fingerprints.legacy,
      cloudSyncResolvedStagedGenerationId: "staged-generation",
    });
  });

  it("creates a new archive when a changed retained source reopens the same conflict", async () => {
    const db = fakeConflictDatabase();
    const firstFingerprints = conflictFingerprints(db);
    const firstStagedManifest = stageRecovery(db, conflictId, firstFingerprints);

    await resolveAccountCloudSyncConflict(db as never, canonicalUid, canonicalUid, conflictId, {
      choice: "restore-legacy",
      legacyFingerprint: firstFingerprints.legacy,
      currentFingerprint: firstFingerprints.current,
      stagedManifest: firstStagedManifest,
    });

    const nextPayload = "later-retained-compressed-payload";
    db.setData(
      `accountSync/${sourceUid}/manifest/current`,
      manifestData("later-legacy-generation", nextPayload),
    );
    db.setData(
      `accountSync/${sourceUid}/chunks/later-legacy-generation-chunk-0000`,
      chunkData("later-legacy-generation", nextPayload),
    );
    db.setData(`identityAliases/${sourceUid}`, {
      ...db.data(`identityAliases/${sourceUid}`),
      cloudSyncConflict: true,
      cloudSyncSourceUid: sourceUid,
      cloudSyncCanonicalUid: canonicalUid,
    });

    const secondFingerprints = conflictFingerprints(db);
    const secondStagedManifest = stageRecovery(db, conflictId, secondFingerprints, {
      generationId: "second-staged-generation",
      payload: nextPayload,
    });
    const second = await resolveAccountCloudSyncConflict(db as never, canonicalUid, canonicalUid, conflictId, {
      choice: "restore-legacy",
      legacyFingerprint: secondFingerprints.legacy,
      currentFingerprint: secondFingerprints.current,
      stagedManifest: secondStagedManifest,
    });

    const firstArchivePath = recoveryArchivePath(canonicalUid, conflictId, firstFingerprints);
    const secondArchivePath = recoveryArchivePath(canonicalUid, conflictId, secondFingerprints);
    expect(second).toMatchObject({ status: "resolved", choice: "restore-legacy" });
    expect(secondArchivePath).not.toBe(firstArchivePath);
    expect(db.data(firstArchivePath)).toMatchObject({
      previous_fingerprint: firstFingerprints.current,
      replacement_generation_id: "staged-generation",
    });
    expect(db.data(secondArchivePath)).toMatchObject({
      previous_fingerprint: secondFingerprints.current,
      retained_source_fingerprint: secondFingerprints.legacy,
      replacement_generation_id: "second-staged-generation",
    });
    expect(db.data(`accountSync/${canonicalUid}/manifest/current`).generation_id)
      .toBe("second-staged-generation");
  });

  it("keeps the current manifest and clears the conflict in one idempotent transaction", async () => {
    const db = fakeConflictDatabase();
    const fingerprints = conflictFingerprints(db);
    const input = {
      choice: "keep-current" as const,
      legacyFingerprint: fingerprints.legacy,
      currentFingerprint: fingerprints.current,
    };

    const first = await resolveAccountCloudSyncConflict(db as never, canonicalUid, canonicalUid, conflictId, input);
    const second = await resolveAccountCloudSyncConflict(db as never, canonicalUid, canonicalUid, conflictId, input);

    expect(second).toEqual(first);
    expect(db.data(`accountSync/${canonicalUid}/manifest/current`).generation_id).toBe("current-generation");
    expect(db.data(recoveryArchivePath(canonicalUid, conflictId, fingerprints))).toEqual({});
    expect(db.data(`identityAliases/${sourceUid}`)).toMatchObject({
      cloudSyncConflict: false,
      cloudSyncResolution: "keep-current",
    });
  });
});

function authResult(options: {
  authenticatedUid: string;
  decodedUid: string;
  provider: string;
  selfAlias: Record<string, unknown>;
}) {
  const selfAliasSnapshot = {
    exists: true,
    data: () => options.selfAlias,
  };
  return {
    authenticatedUid: options.authenticatedUid,
    decoded: {
      uid: options.decodedUid,
      firebase: { sign_in_provider: options.provider, identities: {} },
    },
    db: {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({ get: vi.fn(async () => selfAliasSnapshot) })),
      })),
    },
  };
}

function fakeConflictDatabase() {
  const legacyPayload = "retained-compressed-payload";
  const currentPayload = "current-compressed-payload";
  const documents = new Map<string, Record<string, unknown>>([
    [`identityAliases/desktop-source`, conflictAlias()],
    [`accountSync/desktop-source/manifest/current`, manifestData("legacy-generation", legacyPayload, { device_name: "Old Mac" })],
    [`accountSync/desktop-source/chunks/legacy-generation-chunk-0000`, chunkData("legacy-generation", legacyPayload)],
    [`accountSync/account-owner/manifest/current`, manifestData("current-generation", currentPayload, { device_name: "Current PC" })],
    [`accountSync/account-owner/chunks/current-generation-chunk-0000`, chunkData("current-generation", currentPayload)],
    [`users/account-owner`, {}],
  ]);
  const updateTime = {
    toDate: () => new Date("2026-07-18T12:00:01.000Z"),
  };

  const documentRef = (path: string): Record<string, unknown> => ({
    path,
    get: vi.fn(async () => snapshot(path)),
    collection: vi.fn((name: string) => collectionRef(`${path}/${name}`)),
  });
  const collectionRef = (path: string) => ({
    doc: vi.fn((id: string) => documentRef(`${path}/${id}`)),
  });
  const snapshot = (path: string) => ({
    exists: documents.has(path),
    data: () => documents.get(path),
    updateTime,
  });
  let beforeTransaction: (() => void) | null = null;
  const applySet = (ref: { path: string }, value: Record<string, unknown>, options?: { merge?: boolean }) => {
    documents.set(ref.path, options?.merge ? { ...(documents.get(ref.path) ?? {}), ...value } : { ...value });
  };
  const db = {
    collection: vi.fn((name: string) => collectionRef(name)),
    runTransaction: vi.fn(async <T>(callback: (transaction: {
      get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>;
      set: (ref: { path: string }, value: Record<string, unknown>, options?: { merge?: boolean }) => void;
    }) => Promise<T>) => {
      const hook = beforeTransaction;
      beforeTransaction = null;
      hook?.();
      const writes: Array<{
        ref: { path: string };
        value: Record<string, unknown>;
        options?: { merge?: boolean };
      }> = [];
      const result = await callback({
        get: async (ref) => snapshot(ref.path),
        set: (ref, value, options) => writes.push({ ref, value, options }),
      });
      for (const write of writes) applySet(write.ref, write.value, write.options);
      return result;
    }),
    data: (path: string) => documents.get(path) ?? {},
    setData: (path: string, value: Record<string, unknown>) => documents.set(path, value),
    deleteData: (path: string) => documents.delete(path),
    setBeforeTransaction: (callback: () => void) => {
      beforeTransaction = callback;
    },
  };
  return db;
}

function conflictAlias(overrides: Record<string, unknown> = {}) {
  return {
    sourceUid: "desktop-source",
    canonicalUid: "account-owner",
    cloudSyncConflict: true,
    cloudSyncSourceUid: "desktop-source",
    cloudSyncCanonicalUid: "account-owner",
    ...overrides,
  };
}

function manifestData(
  generationId: string,
  payload: string,
  overrides: Record<string, unknown> = {},
) {
  const checksum = sha256(payload);
  return {
    format: "riftlite.account-cloud-sync",
    version: 2,
    updated_at: "2026-07-18T12:00:00.000Z",
    device_id: `device-${generationId}`,
    device_name: "RiftLite device",
    app_version: "0.8.5-dev.7",
    generation_id: generationId,
    chunk_count: 1,
    byte_size: Buffer.byteLength(payload, "utf8"),
    checksum_algorithm: "sha256",
    checksum,
    chunk_checksums: [checksum],
    counts: { matches: 3, decks: 2, notebooks: 1, replays: 0 },
    ...overrides,
  };
}

function chunkData(
  generationId: string,
  payload: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    format: "riftlite.account-cloud-sync",
    version: 2,
    generation_id: generationId,
    index: 0,
    payload,
    byte_size: Buffer.byteLength(payload, "utf8"),
    checksum: sha256(payload),
    ...overrides,
  };
}

function stageRecovery(
  db: ReturnType<typeof fakeConflictDatabase>,
  conflictId: string,
  fingerprints: { legacy: string; current: string },
  options: { generationId?: string; payload?: string } = {},
) {
  const generationId = options.generationId ?? "staged-generation";
  const payload = options.payload ?? "retained-compressed-payload";
  const checksum = sha256(payload);
  db.setData(`accountSync/account-owner/chunks/${generationId}-chunk-0000`, chunkData(
    generationId,
    payload,
    {
      recovery_conflict_id: conflictId,
      recovery_source_fingerprint: fingerprints.legacy,
    },
  ));
  return {
    format: "riftlite.account-cloud-sync",
    version: 2,
    updatedAt: "2026-07-18T12:01:00.000Z",
    deviceId: "recovery-device",
    deviceName: "Recovery PC",
    appVersion: "0.8.5-dev.8",
    generationId,
    chunkCount: 1,
    byteSize: Buffer.byteLength(payload, "utf8"),
    checksumAlgorithm: "sha256",
    checksum,
    chunkChecksums: [checksum],
    counts: { matches: 3, decks: 2, notebooks: 1, replays: 0 },
  };
}

function recoveryArchivePath(
  canonicalUid: string,
  conflictId: string,
  fingerprints: { legacy: string; current: string },
): string {
  return `accountSync/${canonicalUid}/recoveryArchive/${accountCloudSyncRecoveryArchiveId(
    conflictId,
    fingerprints.legacy,
    fingerprints.current,
  )}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function conflictFingerprints(db: ReturnType<typeof fakeConflictDatabase>) {
  const updateTime = "2026-07-18T12:00:01.000Z";
  const legacy = normalizeAccountCloudSyncManifest(db.data("accountSync/desktop-source/manifest/current"), updateTime);
  const current = normalizeAccountCloudSyncManifest(db.data("accountSync/account-owner/manifest/current"), updateTime);
  if (!legacy || !current) throw new Error("Test manifest did not normalize");
  return {
    legacy: accountCloudSyncManifestFingerprint(legacy),
    current: accountCloudSyncManifestFingerprint(current),
  };
}

async function expectConflictError(promise: Promise<unknown>, status: number) {
  try {
    await promise;
    throw new Error("Expected conflict resolution to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(AccountCloudSyncConflictError);
    expect((error as AccountCloudSyncConflictError).status).toBe(status);
  }
}
