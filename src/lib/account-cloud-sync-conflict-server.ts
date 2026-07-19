import "server-only";

import { createHash } from "node:crypto";
import { FieldValue, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { type NextRequest } from "next/server";

import {
  accountCloudSyncBackupSummary,
  ACCOUNT_CLOUD_SYNC_CHUNK_SIZE,
  ACCOUNT_CLOUD_SYNC_FORMAT,
  ACCOUNT_CLOUD_SYNC_VERSION,
  accountCloudSyncChunkDocumentId,
  accountCloudSyncConflictId,
  accountCloudSyncManifestFingerprint,
  accountCloudSyncRecoveryArchiveId,
  identityAliasProvesCloudSyncConflict,
  normalizeAccountCloudSyncManifest,
  validateAccountCloudSyncChunk,
  type AccountCloudSyncConflictResolution,
  type AccountCloudSyncConflictSummary,
  type AccountCloudSyncManifest,
} from "@/lib/account-cloud-sync-conflict";
import { linkedReplayUid } from "@/lib/replay-v2-server/identity";
import { identityUidsFor, requireUser, socialJson } from "@/lib/social/server";

type CanonicalOwner = {
  db: Firestore;
  uid: string;
  authenticatedUid: string;
};

type ConflictCandidate = {
  id: string;
  canonicalUid: string;
  sourceUid: string;
  aliasData: Record<string, unknown>;
  currentManifest: AccountCloudSyncManifest | null;
  legacyManifest: AccountCloudSyncManifest | null;
};

export type ResolveAccountCloudSyncConflictInput = {
  choice: AccountCloudSyncConflictResolution;
  legacyFingerprint: string;
  currentFingerprint: string;
  stagedManifest?: unknown;
};

const ACCOUNT_CLOUD_SYNC_RECOVERY_MAX_CHUNKS = 64;
const ACCOUNT_CLOUD_SYNC_RECOVERY_MAX_BYTES = ACCOUNT_CLOUD_SYNC_CHUNK_SIZE * ACCOUNT_CLOUD_SYNC_RECOVERY_MAX_CHUNKS;
const ACCOUNT_CLOUD_SYNC_RECOVERY_READ_BATCH = 8;

export class AccountCloudSyncConflictError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AccountCloudSyncConflictError";
  }
}

export async function requireCanonicalAccountCloudSyncOwner(
  req: NextRequest,
): Promise<CanonicalOwner | { error: Response }> {
  const auth = await requireUser(req);
  if (auth.error) return { error: markPrivateNoStore(auth.error) };
  const authenticatedUid = String(auth.authenticatedUid ?? "").trim();
  const canonicalUid = String(auth.decoded.uid ?? "").trim();
  if (!authenticatedUid || !canonicalUid || authenticatedUid !== canonicalUid) {
    return {
      error: accountCloudSyncPrivateJson({
        error: "Reconnect this desktop to its canonical RiftLite account before recovering a retained backup.",
      }, 409),
    };
  }
  let uid = linkedReplayUid(auth.decoded);
  if (!uid && String(auth.decoded.firebase?.sign_in_provider ?? "").trim().toLowerCase() === "custom") {
    // A Firebase custom-token exchange does not consistently repeat provider
    // identities in the resulting token. Conflict recovery is still allowed
    // only when the raw credential is already canonical and a server-owned
    // self-alias proves this UID was promoted through RiftLite's link flow.
    const selfAlias = await auth.db.collection("identityAliases").doc(canonicalUid).get();
    const selfData = selfAlias.data() ?? {};
    if (
      selfAlias.exists &&
      String(selfData.canonicalUid ?? "").trim() === canonicalUid &&
      String(selfData.sourceUid ?? "").trim() === canonicalUid
    ) {
      uid = canonicalUid;
    }
  }
  if (!uid) {
    return { error: accountCloudSyncPrivateJson({ error: "A Google or email RiftLite account is required." }, 401) };
  }
  return { db: auth.db, uid, authenticatedUid };
}

export async function listAccountCloudSyncConflicts(
  db: Firestore,
  canonicalUid: string,
): Promise<AccountCloudSyncConflictSummary[]> {
  const candidates = await loadConflictCandidates(db, canonicalUid, true);
  return candidates.map((candidate) => ({
    id: candidate.id,
    status: "pending",
    currentFingerprint: candidate.currentManifest
      ? accountCloudSyncManifestFingerprint(candidate.currentManifest)
      : "",
    legacyFingerprint: candidate.legacyManifest
      ? accountCloudSyncManifestFingerprint(candidate.legacyManifest)
      : "",
    current: accountCloudSyncBackupSummary(candidate.currentManifest),
    legacy: accountCloudSyncBackupSummary(candidate.legacyManifest),
  }));
}

export async function getAccountCloudSyncConflictManifest(
  db: Firestore,
  canonicalUid: string,
  conflictId: string,
): Promise<{ conflictId: string; legacyFingerprint: string; manifest: AccountCloudSyncManifest }> {
  const candidate = await loadConflictCandidate(db, canonicalUid, conflictId);
  if (!candidate.legacyManifest) {
    throw new AccountCloudSyncConflictError(409, "The retained backup manifest is missing or invalid.");
  }
  return {
    conflictId: candidate.id,
    legacyFingerprint: accountCloudSyncManifestFingerprint(candidate.legacyManifest),
    manifest: candidate.legacyManifest,
  };
}

export async function getAccountCloudSyncConflictChunk(
  db: Firestore,
  canonicalUid: string,
  conflictId: string,
  index: number,
  expectedLegacyFingerprint: string,
): Promise<{
  conflictId: string;
  legacyFingerprint: string;
  index: number;
  payload: string;
  byteSize: number;
  checksum: string;
}> {
  const candidate = await loadConflictCandidate(db, canonicalUid, conflictId);
  const manifest = candidate.legacyManifest;
  if (!manifest) {
    throw new AccountCloudSyncConflictError(409, "The retained backup manifest is missing or invalid.");
  }
  const fingerprint = accountCloudSyncManifestFingerprint(manifest);
  if (!expectedLegacyFingerprint || expectedLegacyFingerprint !== fingerprint) {
    throw new AccountCloudSyncConflictError(409, "The retained backup changed. Refresh its details before restoring it.");
  }
  if (!Number.isInteger(index) || index < 0 || index >= manifest.chunkCount) {
    throw new AccountCloudSyncConflictError(400, "The retained backup chunk index is invalid.");
  }

  const chunkRef = db.collection("accountSync")
    .doc(candidate.sourceUid)
    .collection("chunks")
    .doc(accountCloudSyncChunkDocumentId(manifest, index));
  const chunkSnapshot = await chunkRef.get();
  const chunk = validateAccountCloudSyncChunk(manifest, index, chunkSnapshot.data() ?? null);
  if (!chunkSnapshot.exists || !chunk) {
    throw new AccountCloudSyncConflictError(409, `Retained backup chunk ${index + 1} is missing or failed validation.`);
  }
  return {
    conflictId: candidate.id,
    legacyFingerprint: fingerprint,
    index,
    ...chunk,
  };
}

export async function resolveAccountCloudSyncConflict(
  db: Firestore,
  canonicalUid: string,
  authenticatedUid: string,
  conflictId: string,
  input: ResolveAccountCloudSyncConflictInput,
): Promise<{
  conflictId: string;
  status: "resolved";
  choice: AccountCloudSyncConflictResolution;
  resolvedAt: number;
}> {
  if (input.choice !== "keep-current" && input.choice !== "restore-legacy") {
    throw new AccountCloudSyncConflictError(400, "Choose either the current account backup or the retained legacy backup.");
  }
  if (!isFingerprint(input.legacyFingerprint) || !isFingerprint(input.currentFingerprint)) {
    throw new AccountCloudSyncConflictError(400, "Refresh both backup summaries before resolving this conflict.");
  }

  const sourceUid = await sourceUidForConflictId(db, canonicalUid, conflictId);
  if (!sourceUid) {
    throw new AccountCloudSyncConflictError(404, "Retained backup conflict not found.");
  }

  const aliasRef = db.collection("identityAliases").doc(sourceUid);
  const sourceManifestRef = manifestRef(db, sourceUid);
  const canonicalManifestRef = manifestRef(db, canonicalUid);
  const canonicalUserRef = db.collection("users").doc(canonicalUid);
  const archiveRef = db.collection("accountSync").doc(canonicalUid)
    .collection("recoveryArchive").doc(accountCloudSyncRecoveryArchiveId(
      conflictId,
      input.legacyFingerprint,
      input.currentFingerprint,
    ));

  const aliasSnapshot = await aliasRef.get();
  const aliasData = aliasSnapshot.data() ?? {};
  const aliasRevision = documentRevision(aliasSnapshot);
  if (aliasData.cloudSyncConflict !== true) {
    return db.runTransaction(async (transaction) => {
      const latestAlias = await transaction.get(aliasRef);
      return priorConflictResolution(latestAlias.data() ?? {}, conflictId, input);
    });
  }
  if (!identityAliasProvesCloudSyncConflict(aliasData, sourceUid, canonicalUid)) {
    throw new AccountCloudSyncConflictError(404, "Retained backup conflict not found.");
  }

  const [sourceManifestSnapshot, canonicalManifestSnapshot] = await Promise.all([
    sourceManifestRef.get(),
    canonicalManifestRef.get(),
  ]);
  const sourceManifest = manifestFromSnapshot(sourceManifestSnapshot);
  const canonicalManifest = manifestFromSnapshot(canonicalManifestSnapshot);
  if (!sourceManifest || !canonicalManifest) {
    throw new AccountCloudSyncConflictError(409, "One of the retained backups is missing or invalid.");
  }
  if (accountCloudSyncManifestFingerprint(sourceManifest) !== input.legacyFingerprint) {
    throw new AccountCloudSyncConflictError(409, "The retained backup changed. Refresh its details before choosing.");
  }
  if (accountCloudSyncManifestFingerprint(canonicalManifest) !== input.currentFingerprint) {
    throw new AccountCloudSyncConflictError(409, "The current account backup changed. Refresh its details before choosing.");
  }

  const stagedManifest = input.choice === "restore-legacy"
    ? normalizeStagedRecoveryManifest(input.stagedManifest, sourceManifest, canonicalManifest)
    : null;
  if (stagedManifest) {
    await validateStagedRecoveryPayload(
      db,
      canonicalUid,
      sourceUid,
      conflictId,
      input.legacyFingerprint,
      sourceManifest,
      stagedManifest,
    );
  }

  return db.runTransaction(async (transaction) => {
    const reads = await Promise.all([
      transaction.get(aliasRef),
      transaction.get(sourceManifestRef),
      transaction.get(canonicalManifestRef),
      ...(stagedManifest ? [transaction.get(archiveRef)] : []),
    ]);
    const latestAliasSnapshot = reads[0];
    const latestSourceManifestSnapshot = reads[1];
    const latestCanonicalManifestSnapshot = reads[2];
    const archiveSnapshot = stagedManifest ? reads[3] : null;
    const latestAliasData = latestAliasSnapshot.data() ?? {};
    if (latestAliasData.cloudSyncConflict !== true) {
      return priorConflictResolution(latestAliasData, conflictId, input);
    }
    if (!identityAliasProvesCloudSyncConflict(latestAliasData, sourceUid, canonicalUid)) {
      throw new AccountCloudSyncConflictError(404, "Retained backup conflict not found.");
    }
    if (documentRevision(latestAliasSnapshot) !== aliasRevision) {
      throw new AccountCloudSyncConflictError(409, "The retained backup conflict changed while it was being recovered.");
    }

    const legacyManifest = manifestFromSnapshot(latestSourceManifestSnapshot);
    const currentManifest = manifestFromSnapshot(latestCanonicalManifestSnapshot);
    if (!legacyManifest || !currentManifest) {
      throw new AccountCloudSyncConflictError(409, "One of the retained backups is missing or invalid.");
    }
    const legacyFingerprint = accountCloudSyncManifestFingerprint(legacyManifest);
    const currentFingerprint = accountCloudSyncManifestFingerprint(currentManifest);
    if (legacyFingerprint !== input.legacyFingerprint) {
      throw new AccountCloudSyncConflictError(409, "The retained backup changed. Refresh its details before choosing.");
    }
    if (currentFingerprint !== input.currentFingerprint) {
      throw new AccountCloudSyncConflictError(409, "The current account backup changed. Its existing backup was preserved.");
    }

    const resolvedAt = Date.now();
    if (stagedManifest) {
      if (archiveSnapshot?.exists) {
        throw new AccountCloudSyncConflictError(409, "A different recovery archive already exists for this conflict.");
      }
      transaction.set(archiveRef, {
        format: "riftlite.account-cloud-sync-recovery-archive",
        version: 1,
        conflict_id: conflictId,
        archived_at: new Date(resolvedAt).toISOString(),
        archived_by_uid: authenticatedUid,
        previous_fingerprint: currentFingerprint,
        previous_manifest_update_time: currentManifest.updateTime,
        retained_source_fingerprint: legacyFingerprint,
        replacement_generation_id: stagedManifest.generationId,
        manifest: latestCanonicalManifestSnapshot.data() ?? {},
      });
      transaction.set(canonicalManifestRef, accountCloudSyncManifestDocument(stagedManifest, {
        updatedAt: new Date(resolvedAt).toISOString(),
        conflictId,
        sourceFingerprint: legacyFingerprint,
        previousCanonicalFingerprint: currentFingerprint,
      }));
    }

    transaction.set(aliasRef, {
      cloudSyncConflict: false,
      cloudSyncConflictId: conflictId,
      cloudSyncResolution: input.choice,
      cloudSyncResolvedAt: resolvedAt,
      cloudSyncResolvedByUid: authenticatedUid,
      cloudSyncResolvedSourceFingerprint: legacyFingerprint,
      cloudSyncResolvedCanonicalFingerprint: stagedManifest ? "" : currentFingerprint,
      cloudSyncResolvedPreviousCanonicalFingerprint: input.currentFingerprint,
      cloudSyncResolvedStagedGenerationId: stagedManifest?.generationId ?? "",
    }, { merge: true });
    transaction.set(canonicalUserRef, {
      accountCloudSyncLegacySources: FieldValue.arrayRemove(sourceUid),
      accountCloudSyncIdentityUpdatedAt: resolvedAt,
    }, { merge: true });
    return { conflictId, status: "resolved" as const, choice: input.choice, resolvedAt };
  });
}

function priorConflictResolution(
  aliasData: Record<string, unknown>,
  conflictId: string,
  input: ResolveAccountCloudSyncConflictInput,
): {
  conflictId: string;
  status: "resolved";
  choice: AccountCloudSyncConflictResolution;
  resolvedAt: number;
} {
  const stagedGenerationId = stagedRecoveryGenerationId(input.stagedManifest);
  const matches = String(aliasData.cloudSyncConflictId ?? "") === conflictId &&
    String(aliasData.cloudSyncResolution ?? "") === input.choice &&
    String(aliasData.cloudSyncResolvedSourceFingerprint ?? "") === input.legacyFingerprint &&
    String(aliasData.cloudSyncResolvedPreviousCanonicalFingerprint ?? "") === input.currentFingerprint &&
    (input.choice !== "restore-legacy" || (
      Boolean(stagedGenerationId) &&
      String(aliasData.cloudSyncResolvedStagedGenerationId ?? "") === stagedGenerationId
    ));
  if (!matches) {
    throw new AccountCloudSyncConflictError(404, "Retained backup conflict not found.");
  }
  return {
    conflictId,
    status: "resolved",
    choice: input.choice,
    resolvedAt: Number(aliasData.cloudSyncResolvedAt ?? 0),
  };
}

function normalizeStagedRecoveryManifest(
  value: unknown,
  sourceManifest: AccountCloudSyncManifest,
  canonicalManifest: AccountCloudSyncManifest,
): AccountCloudSyncManifest {
  if (!isRecord(value)) {
    throw new AccountCloudSyncConflictError(400, "The staged recovery manifest is missing or invalid.");
  }
  const manifest = normalizeAccountCloudSyncManifest({
    format: value.format,
    version: value.version,
    updated_at: value.updatedAt,
    device_id: value.deviceId,
    device_name: value.deviceName,
    app_version: value.appVersion,
    generation_id: value.generationId,
    chunk_count: value.chunkCount,
    byte_size: value.byteSize,
    checksum_algorithm: value.checksumAlgorithm,
    checksum: value.checksum,
    chunk_checksums: value.chunkChecksums,
    counts: value.counts,
  });
  if (
    !manifest ||
    manifest.version !== ACCOUNT_CLOUD_SYNC_VERSION ||
    manifest.chunkCount > ACCOUNT_CLOUD_SYNC_RECOVERY_MAX_CHUNKS ||
    manifest.byteSize > ACCOUNT_CLOUD_SYNC_RECOVERY_MAX_BYTES
  ) {
    throw new AccountCloudSyncConflictError(400, "The staged recovery manifest is unsupported or too large to validate safely.");
  }
  if (
    manifest.generationId === sourceManifest.generationId ||
    manifest.generationId === canonicalManifest.generationId
  ) {
    throw new AccountCloudSyncConflictError(400, "The staged recovery generation must be unique.");
  }
  if (
    manifest.chunkCount !== sourceManifest.chunkCount ||
    manifest.byteSize !== sourceManifest.byteSize ||
    !sameAccountCloudSyncCounts(manifest.counts, sourceManifest.counts)
  ) {
    throw new AccountCloudSyncConflictError(409, "The staged recovery manifest does not describe the retained backup exactly.");
  }
  return manifest;
}

async function validateStagedRecoveryPayload(
  db: Firestore,
  canonicalUid: string,
  sourceUid: string,
  conflictId: string,
  sourceFingerprint: string,
  sourceManifest: AccountCloudSyncManifest,
  stagedManifest: AccountCloudSyncManifest,
): Promise<void> {
  const sourceChunks = db.collection("accountSync").doc(sourceUid).collection("chunks");
  const stagedChunks = db.collection("accountSync").doc(canonicalUid).collection("chunks");
  const payloadHash = createHash("sha256");
  let totalBytes = 0;

  for (let offset = 0; offset < sourceManifest.chunkCount; offset += ACCOUNT_CLOUD_SYNC_RECOVERY_READ_BATCH) {
    const indexes = Array.from(
      { length: Math.min(ACCOUNT_CLOUD_SYNC_RECOVERY_READ_BATCH, sourceManifest.chunkCount - offset) },
      (_, index) => offset + index,
    );
    const chunks = await Promise.all(indexes.map(async (index) => {
      const [sourceSnapshot, stagedSnapshot] = await Promise.all([
        sourceChunks.doc(accountCloudSyncChunkDocumentId(sourceManifest, index)).get(),
        stagedChunks.doc(accountCloudSyncChunkDocumentId(stagedManifest, index)).get(),
      ]);
      const sourceChunk = validateAccountCloudSyncChunk(sourceManifest, index, sourceSnapshot.data() ?? null);
      const stagedChunk = validateAccountCloudSyncChunk(stagedManifest, index, stagedSnapshot.data() ?? null);
      const stagedData = stagedSnapshot.data() ?? {};
      if (!sourceSnapshot.exists || !sourceChunk) {
        throw new AccountCloudSyncConflictError(409, `Retained backup chunk ${index + 1} is missing or invalid.`);
      }
      if (
        !stagedSnapshot.exists ||
        !stagedChunk ||
        String(stagedData.recovery_conflict_id ?? "") !== conflictId ||
        String(stagedData.recovery_source_fingerprint ?? "") !== sourceFingerprint
      ) {
        throw new AccountCloudSyncConflictError(409, `Staged recovery chunk ${index + 1} is missing, invalid, or belongs to another recovery.`);
      }
      if (sourceChunk.payload !== stagedChunk.payload) {
        throw new AccountCloudSyncConflictError(409, `Staged recovery chunk ${index + 1} does not match the retained backup.`);
      }
      return stagedChunk.payload;
    }));
    for (const payload of chunks) {
      totalBytes += Buffer.byteLength(payload, "utf8");
      if (totalBytes > ACCOUNT_CLOUD_SYNC_RECOVERY_MAX_BYTES) {
        throw new AccountCloudSyncConflictError(413, "The retained backup is too large to recover safely in one operation.");
      }
      payloadHash.update(payload, "utf8");
    }
  }

  const checksum = payloadHash.digest("hex");
  if (totalBytes !== sourceManifest.byteSize || totalBytes !== stagedManifest.byteSize) {
    throw new AccountCloudSyncConflictError(409, "The staged recovery payload size does not match the retained backup.");
  }
  if (checksum !== stagedManifest.checksum) {
    throw new AccountCloudSyncConflictError(409, "The staged recovery payload failed its full checksum.");
  }
  if (sourceManifest.version === ACCOUNT_CLOUD_SYNC_VERSION && checksum !== sourceManifest.checksum) {
    throw new AccountCloudSyncConflictError(409, "The retained backup failed its full checksum during recovery.");
  }
}

function accountCloudSyncManifestDocument(
  manifest: AccountCloudSyncManifest,
  recovery: {
    updatedAt: string;
    conflictId: string;
    sourceFingerprint: string;
    previousCanonicalFingerprint: string;
  },
): Record<string, unknown> {
  return {
    format: ACCOUNT_CLOUD_SYNC_FORMAT,
    version: ACCOUNT_CLOUD_SYNC_VERSION,
    updated_at: recovery.updatedAt,
    device_id: manifest.deviceId,
    device_name: manifest.deviceName,
    app_version: manifest.appVersion,
    generation_id: manifest.generationId,
    chunk_count: manifest.chunkCount,
    byte_size: manifest.byteSize,
    checksum_algorithm: "sha256",
    checksum: manifest.checksum,
    chunk_checksums: manifest.chunkChecksums,
    counts: manifest.counts,
    recovery_conflict_id: recovery.conflictId,
    recovery_source_fingerprint: recovery.sourceFingerprint,
    recovery_previous_canonical_fingerprint: recovery.previousCanonicalFingerprint,
  };
}

function stagedRecoveryGenerationId(value: unknown): string {
  if (!isRecord(value)) return "";
  const generationId = String(value.generationId ?? "").trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(generationId) ? generationId : "";
}

function sameAccountCloudSyncCounts(
  left: AccountCloudSyncManifest["counts"],
  right: AccountCloudSyncManifest["counts"],
): boolean {
  return left.matches === right.matches &&
    left.decks === right.decks &&
    left.notebooks === right.notebooks &&
    left.replays === right.replays;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function accountCloudSyncConflictResponse(error: unknown): Response {
  if (error instanceof AccountCloudSyncConflictError) {
    return accountCloudSyncPrivateJson({ error: error.message }, error.status);
  }
  return accountCloudSyncPrivateJson({ error: "Could not access the retained account backup safely." }, 500);
}

export function accountCloudSyncPrivateJson(body: Record<string, unknown>, status = 200): Response {
  return markPrivateNoStore(socialJson(body, status));
}

function markPrivateNoStore(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Authorization");
  return response;
}

async function loadConflictCandidate(
  db: Firestore,
  canonicalUid: string,
  conflictId: string,
): Promise<ConflictCandidate> {
  const candidates = await loadConflictCandidates(db, canonicalUid, true);
  const candidate = candidates.find((entry) => entry.id === conflictId);
  if (!candidate) throw new AccountCloudSyncConflictError(404, "Retained backup conflict not found.");
  return candidate;
}

async function loadConflictCandidates(
  db: Firestore,
  canonicalUid: string,
  pendingOnly: boolean,
): Promise<ConflictCandidate[]> {
  const canonical = canonicalUid.trim();
  if (!canonical) return [];
  const aliases = (await identityUidsFor(canonical)).filter((uid) => uid && uid !== canonical);
  const candidates = await Promise.all(aliases.map(async (sourceUid): Promise<ConflictCandidate | null> => {
    const aliasSnapshot = await db.collection("identityAliases").doc(sourceUid).get();
    const aliasData = aliasSnapshot.data() ?? {};
    if (pendingOnly && !identityAliasProvesCloudSyncConflict(aliasData, sourceUid, canonical)) return null;
    if (!pendingOnly && !identityAliasBelongsToCanonical(aliasData, sourceUid, canonical)) return null;
    const [sourceManifestSnapshot, canonicalManifestSnapshot] = await Promise.all([
      manifestRef(db, sourceUid).get(),
      manifestRef(db, canonical).get(),
    ]);
    return {
      id: accountCloudSyncConflictId(canonical, sourceUid),
      canonicalUid: canonical,
      sourceUid,
      aliasData,
      currentManifest: manifestFromSnapshot(canonicalManifestSnapshot),
      legacyManifest: manifestFromSnapshot(sourceManifestSnapshot),
    };
  }));
  return candidates.filter((candidate): candidate is ConflictCandidate => Boolean(candidate));
}

async function sourceUidForConflictId(
  db: Firestore,
  canonicalUid: string,
  conflictId: string,
): Promise<string> {
  const canonical = canonicalUid.trim();
  if (!canonical || !isFingerprint(conflictId)) return "";
  const aliases = (await identityUidsFor(canonical)).filter((uid) => uid && uid !== canonical);
  const sourceUid = aliases.find((uid) => accountCloudSyncConflictId(canonical, uid) === conflictId) ?? "";
  if (!sourceUid) return "";
  const aliasSnapshot = await db.collection("identityAliases").doc(sourceUid).get();
  return identityAliasBelongsToCanonical(aliasSnapshot.data() ?? {}, sourceUid, canonical) ? sourceUid : "";
}

function manifestRef(db: Firestore, uid: string) {
  return db.collection("accountSync").doc(uid).collection("manifest").doc("current");
}

function manifestFromSnapshot(snapshot: DocumentSnapshot): AccountCloudSyncManifest | null {
  if (!snapshot.exists) return null;
  const updateTime = snapshot.updateTime?.toDate().toISOString() ?? "";
  return normalizeAccountCloudSyncManifest(snapshot.data() ?? null, updateTime);
}

function documentRevision(snapshot: DocumentSnapshot): string {
  return snapshot.updateTime?.toDate().toISOString() ?? "";
}

function identityAliasBelongsToCanonical(
  value: Record<string, unknown>,
  sourceUid: string,
  canonicalUid: string,
): boolean {
  return String(value.sourceUid ?? "").trim() === sourceUid.trim() &&
    String(value.canonicalUid ?? "").trim() === canonicalUid.trim();
}

function isFingerprint(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}
