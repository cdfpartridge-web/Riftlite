import { createHash } from "node:crypto";

export const ACCOUNT_CLOUD_SYNC_FORMAT = "riftlite.account-cloud-sync";
export const ACCOUNT_CLOUD_SYNC_LEGACY_VERSION = 1;
export const ACCOUNT_CLOUD_SYNC_VERSION = 2;
export const ACCOUNT_CLOUD_SYNC_CHUNK_SIZE = 450_000;
export const ACCOUNT_CLOUD_SYNC_MAX_CHUNKS = 10_000;

const SAFE_GENERATION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export type AccountCloudSyncCounts = {
  matches: number;
  decks: number;
  notebooks: number;
  replays: number;
};

export type AccountCloudSyncManifest = {
  format: typeof ACCOUNT_CLOUD_SYNC_FORMAT;
  version: number;
  updatedAt: string;
  deviceId: string;
  deviceName: string;
  appVersion: string;
  generationId: string;
  chunkCount: number;
  byteSize: number;
  checksumAlgorithm: string;
  checksum: string;
  chunkChecksums: string[];
  counts: AccountCloudSyncCounts;
  updateTime: string;
};

export type AccountCloudSyncBackupSummary = {
  available: boolean;
  updatedAt: string;
  deviceName: string;
  appVersion: string;
  byteSize: number;
  counts: AccountCloudSyncCounts;
};

export type AccountCloudSyncConflictSummary = {
  id: string;
  status: "pending";
  currentFingerprint: string;
  legacyFingerprint: string;
  current: AccountCloudSyncBackupSummary;
  legacy: AccountCloudSyncBackupSummary;
};

export type AccountCloudSyncConflictResolution = "keep-current" | "restore-legacy";

export function accountCloudSyncConflictId(canonicalUid: string, sourceUid: string): string {
  return createHash("sha256")
    .update(`riftlite-account-cloud-conflict:v1\0${canonicalUid.trim()}\0${sourceUid.trim()}`, "utf8")
    .digest("hex");
}

export function accountCloudSyncRecoveryArchiveId(
  conflictId: string,
  sourceFingerprint: string,
  currentFingerprint: string,
): string {
  return createHash("sha256")
    .update(
      `riftlite-account-cloud-recovery-archive:v1\0${conflictId.trim()}\0${sourceFingerprint.trim()}\0${currentFingerprint.trim()}`,
      "utf8",
    )
    .digest("hex");
}

export function identityAliasProvesCloudSyncConflict(
  value: Record<string, unknown> | null | undefined,
  sourceUid: string,
  canonicalUid: string,
): boolean {
  if (!value || value.cloudSyncConflict !== true) return false;
  const source = sourceUid.trim();
  const canonical = canonicalUid.trim();
  return Boolean(
    source &&
    canonical &&
    String(value.sourceUid ?? "").trim() === source &&
    String(value.canonicalUid ?? "").trim() === canonical &&
    String(value.cloudSyncSourceUid ?? "").trim() === source &&
    String(value.cloudSyncCanonicalUid ?? "").trim() === canonical
  );
}

export function normalizeAccountCloudSyncManifest(
  value: Record<string, unknown> | null | undefined,
  updateTime = "",
): AccountCloudSyncManifest | null {
  if (!value || String(value.format ?? "") !== ACCOUNT_CLOUD_SYNC_FORMAT) return null;
  const version = positiveInteger(value.version);
  const chunkCount = positiveInteger(value.chunk_count);
  const byteSize = positiveInteger(value.byte_size);
  const generationId = String(value.generation_id ?? "").trim();
  const checksumAlgorithm = String(value.checksum_algorithm ?? "").trim().toLowerCase();
  const checksum = String(value.checksum ?? "").trim().toLowerCase();
  const chunkChecksums = Array.isArray(value.chunk_checksums)
    ? value.chunk_checksums.map((entry) => String(entry ?? "").trim().toLowerCase())
    : [];

  if (
    (version !== ACCOUNT_CLOUD_SYNC_LEGACY_VERSION && version !== ACCOUNT_CLOUD_SYNC_VERSION) ||
    chunkCount < 1 ||
    chunkCount > ACCOUNT_CLOUD_SYNC_MAX_CHUNKS ||
    byteSize < 1 ||
    byteSize > ACCOUNT_CLOUD_SYNC_CHUNK_SIZE * chunkCount
  ) {
    return null;
  }
  if (version === ACCOUNT_CLOUD_SYNC_VERSION && (
    !SAFE_GENERATION_ID.test(generationId) ||
    checksumAlgorithm !== "sha256" ||
    !SHA256.test(checksum) ||
    chunkChecksums.length !== chunkCount ||
    !chunkChecksums.every((entry) => SHA256.test(entry))
  )) {
    return null;
  }

  return {
    format: ACCOUNT_CLOUD_SYNC_FORMAT,
    version,
    updatedAt: String(value.updated_at ?? "").slice(0, 80),
    deviceId: String(value.device_id ?? "").slice(0, 160),
    deviceName: String(value.device_name ?? "").slice(0, 160),
    appVersion: String(value.app_version ?? "").slice(0, 80),
    generationId,
    chunkCount,
    byteSize,
    checksumAlgorithm,
    checksum,
    chunkChecksums,
    counts: normalizeCounts(value.counts),
    updateTime: String(updateTime ?? "").slice(0, 120),
  };
}

export function accountCloudSyncManifestFingerprint(manifest: AccountCloudSyncManifest): string {
  return createHash("sha256").update(JSON.stringify([
    manifest.format,
    manifest.version,
    manifest.updatedAt,
    manifest.deviceId,
    manifest.appVersion,
    manifest.generationId,
    manifest.chunkCount,
    manifest.byteSize,
    manifest.checksumAlgorithm,
    manifest.checksum,
    manifest.chunkChecksums,
    manifest.counts.matches,
    manifest.counts.decks,
    manifest.counts.notebooks,
    manifest.counts.replays,
    manifest.updateTime,
  ]), "utf8").digest("hex");
}

export function accountCloudSyncBackupSummary(
  manifest: AccountCloudSyncManifest | null,
): AccountCloudSyncBackupSummary {
  return manifest ? {
    available: true,
    updatedAt: manifest.updatedAt,
    deviceName: manifest.deviceName,
    appVersion: manifest.appVersion,
    byteSize: manifest.byteSize,
    counts: manifest.counts,
  } : {
    available: false,
    updatedAt: "",
    deviceName: "",
    appVersion: "",
    byteSize: 0,
    counts: emptyCounts(),
  };
}

export function accountCloudSyncChunkDocumentId(manifest: AccountCloudSyncManifest, index: number): string {
  const suffix = `chunk-${String(index).padStart(4, "0")}`;
  return manifest.generationId ? `${manifest.generationId}-${suffix}` : suffix;
}

export function validateAccountCloudSyncChunk(
  manifest: AccountCloudSyncManifest,
  index: number,
  value: Record<string, unknown> | null | undefined,
): { payload: string; byteSize: number; checksum: string } | null {
  if (!value || index < 0 || index >= manifest.chunkCount) return null;
  const payload = typeof value.payload === "string" ? value.payload : "";
  if (!payload || !Number.isInteger(Number(value.index)) || Number(value.index) !== index) return null;
  const byteSize = Buffer.byteLength(payload, "utf8");
  if (byteSize > ACCOUNT_CLOUD_SYNC_CHUNK_SIZE) return null;
  if (manifest.version === ACCOUNT_CLOUD_SYNC_LEGACY_VERSION) {
    return { payload, byteSize, checksum: "" };
  }
  const checksum = createHash("sha256").update(payload, "utf8").digest("hex");
  if (
    String(value.format ?? "") !== ACCOUNT_CLOUD_SYNC_FORMAT ||
    positiveInteger(value.version) !== ACCOUNT_CLOUD_SYNC_VERSION ||
    String(value.generation_id ?? "") !== manifest.generationId ||
    positiveInteger(value.byte_size) !== byteSize ||
    String(value.checksum ?? "").toLowerCase() !== checksum ||
    manifest.chunkChecksums[index] !== checksum
  ) {
    return null;
  }
  return { payload, byteSize, checksum };
}

function normalizeCounts(value: unknown): AccountCloudSyncCounts {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    matches: nonNegativeInteger(raw.matches),
    decks: nonNegativeInteger(raw.decks),
    notebooks: nonNegativeInteger(raw.notebooks),
    replays: nonNegativeInteger(raw.replays),
  };
}

function emptyCounts(): AccountCloudSyncCounts {
  return { matches: 0, decks: 0, notebooks: 0, replays: 0 };
}

function positiveInteger(value: unknown): number {
  const next = Number(value);
  return Number.isInteger(next) && next > 0 ? next : 0;
}

function nonNegativeInteger(value: unknown): number {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? Math.floor(next) : 0;
}
