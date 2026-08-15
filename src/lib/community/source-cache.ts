import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

import type { CommunityMatch } from "@/lib/types";

export const COMMUNITY_SOURCE_CACHE_SCHEMA_VERSION = 1;
export const COMMUNITY_SOURCE_MANIFEST_ID = "community-source-v1";
export const COMMUNITY_SOURCE_CHANGE_COLLECTION = "communityAggregateChangesV1";
export const COMMUNITY_SOURCE_SHARD_PREFIX = "community-source-v1-day-";
export const COMMUNITY_SOURCE_SHARDS_PER_DAY = 16;
export const COMMUNITY_SOURCE_RETENTION_DAYS = 30;
export const COMMUNITY_SOURCE_RECONCILE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const COMMUNITY_SOURCE_LEGACY_AUDIT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
// Firestore documents are limited to 1 MiB. Base64 plus metadata must stay
// comfortably below that hard ceiling so a high-volume day fails safely before
// any manifest can reference an unwritable shard.
export const COMMUNITY_SOURCE_MAX_SHARD_BASE64_LENGTH = 800_000;

export type CommunitySourceCursor = {
  changedAtMs: number;
  documentId: string;
};

export type CommunitySourceChange = CommunitySourceCursor & {
  matchId: string;
  match: CommunityMatch;
};

export type CommunitySourceManifest = {
  schemaVersion: typeof COMMUNITY_SOURCE_CACHE_SCHEMA_VERSION;
  cursor: CommunitySourceCursor;
  shardIds: string[];
  sourceMatchCount: number;
  publicLifetimeMatchCount: number | null;
  fullReconciledAt: number;
  legacyTimestampComplete: boolean;
  legacyAuditedAt: number;
  updatedAt: number;
};

export type CommunitySourceShard = {
  id: string;
  day: string;
  shard: number;
  digest: string;
  matchCount: number;
  matchesGz: string;
  matches: CommunityMatch[];
};

const EMPTY_CURSOR: CommunitySourceCursor = { changedAtMs: 0, documentId: "" };

export function emptyCommunitySourceCursor(): CommunitySourceCursor {
  return { ...EMPTY_CURSOR };
}

export function communitySourceMatchCreatedAtMs(match: CommunityMatch): number {
  const raw = Number(match.createdAt ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

export function communitySourceChangeDocId(matchId: string): string {
  return createHash("sha256").update(matchId.trim()).digest("hex");
}

export function nextCommunitySourceChangeTimestamp(
  previousChangedAtMs: unknown,
  now = Date.now(),
): number {
  const previous = nonNegativeSafeInteger(previousChangedAtMs) ?? 0;
  const candidate = Number.isSafeInteger(now) && now >= 0 ? now : Date.now();
  return Math.max(candidate, previous + 1);
}

export function encodeCommunitySourceChange(
  match: CommunityMatch,
  changedAtMs: number,
): Record<string, unknown> {
  if (!match.id.trim()) {
    throw new Error("Community source changes require a match id");
  }
  if (!Number.isSafeInteger(changedAtMs) || changedAtMs <= 0) {
    throw new Error("Community source changes require a positive timestamp");
  }
  return {
    schemaVersion: COMMUNITY_SOURCE_CACHE_SCHEMA_VERSION,
    matchId: match.id,
    changedAtMs,
    matchGz: encodeJson(match),
  };
}

export function decodeCommunitySourceChange(
  documentId: string,
  raw: Record<string, unknown>,
): CommunitySourceChange | null {
  if (raw.schemaVersion !== COMMUNITY_SOURCE_CACHE_SCHEMA_VERSION) return null;
  const matchId = typeof raw.matchId === "string" ? raw.matchId.trim() : "";
  const changedAtMs = positiveSafeInteger(raw.changedAtMs);
  const match = typeof raw.matchGz === "string"
    ? decodeJson<unknown>(raw.matchGz)
    : null;
  if (
    !documentId ||
    !matchId ||
    changedAtMs === null ||
    !isCommunityMatchRecord(match) ||
    match.id !== matchId ||
    communitySourceChangeDocId(matchId) !== documentId
  ) {
    return null;
  }
  return { documentId, matchId, changedAtMs, match };
}

export function compareCommunitySourceCursor(
  left: CommunitySourceCursor,
  right: CommunitySourceCursor,
): number {
  return left.changedAtMs - right.changedAtMs ||
    left.documentId.localeCompare(right.documentId);
}

export function latestCommunitySourceCursor(
  initial: CommunitySourceCursor,
  changes: CommunitySourceChange[],
): CommunitySourceCursor {
  let cursor = { ...initial };
  for (const change of changes) {
    if (compareCommunitySourceCursor(change, cursor) > 0) {
      cursor = {
        changedAtMs: change.changedAtMs,
        documentId: change.documentId,
      };
    }
  }
  return cursor;
}

export function applyCommunitySourceChanges(
  existing: CommunityMatch[],
  changes: CommunitySourceChange[],
  now = Date.now(),
): CommunityMatch[] {
  const byId = new Map<string, CommunityMatch>();
  for (const match of existing) {
    if (isRetainedCommunitySourceMatch(match, now)) {
      byId.set(match.id, match);
    }
  }
  const orderedChanges = [...changes].sort(compareCommunitySourceCursor);
  for (const change of orderedChanges) {
    if (isRetainedCommunitySourceMatch(change.match, now)) {
      byId.set(change.matchId, change.match);
    } else {
      byId.delete(change.matchId);
    }
  }
  return [...byId.values()].sort(
    (left, right) =>
      communitySourceMatchCreatedAtMs(right) - communitySourceMatchCreatedAtMs(left) ||
      left.id.localeCompare(right.id),
  );
}

export function buildCommunitySourceShards(
  matches: CommunityMatch[],
  now = Date.now(),
): CommunitySourceShard[] {
  const buckets = new Map<string, CommunityMatch[]>();
  const retained = applyCommunitySourceChanges([], matches.map((match, index) => ({
    changedAtMs: index + 1,
    documentId: communitySourceChangeDocId(match.id),
    matchId: match.id,
    match,
  })), now);

  for (const match of retained) {
    const day = communitySourceUtcDay(communitySourceMatchCreatedAtMs(match));
    const shard = communitySourceShardIndex(match.id);
    const key = `${day}:${shard}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(match);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const [day, shardText] = key.split(":");
      const shard = Number(shardText);
      const sorted = bucket.sort((left, right) => left.id.localeCompare(right.id));
      const json = JSON.stringify(sorted);
      const digest = createHash("sha256").update(json).digest("hex");
      const matchesGz = gzipSync(json).toString("base64");
      if (matchesGz.length > COMMUNITY_SOURCE_MAX_SHARD_BASE64_LENGTH) {
        throw new Error(`Community source shard ${day}/${shard} exceeds the safe size limit`);
      }
      return {
        id: `${COMMUNITY_SOURCE_SHARD_PREFIX}${day}-${shard}-${digest.slice(0, 16)}`,
        day,
        shard,
        digest,
        matchCount: sorted.length,
        matchesGz,
        matches: sorted,
      } satisfies CommunitySourceShard;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function decodeCommunitySourceShard(
  documentId: string,
  raw: Record<string, unknown>,
): CommunitySourceShard | null {
  if (raw.schemaVersion !== COMMUNITY_SOURCE_CACHE_SCHEMA_VERSION) return null;
  const day = typeof raw.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.day)
    ? raw.day
    : "";
  const shard = nonNegativeSafeInteger(raw.shard);
  const digest = typeof raw.digest === "string" && /^[a-f0-9]{64}$/.test(raw.digest)
    ? raw.digest
    : "";
  const matchCount = nonNegativeSafeInteger(raw.matchCount);
  const matchesGz = typeof raw.matchesGz === "string" ? raw.matchesGz : "";
  const matches = matchesGz ? decodeJson<unknown>(matchesGz) : null;
  if (
    !documentId ||
    !day ||
    shard === null ||
    shard >= COMMUNITY_SOURCE_SHARDS_PER_DAY ||
    !digest ||
    matchCount === null ||
    matchesGz.length > COMMUNITY_SOURCE_MAX_SHARD_BASE64_LENGTH ||
    !Array.isArray(matches) ||
    matches.length !== matchCount ||
    !matches.every(isCommunityMatchRecord)
  ) {
    return null;
  }
  const sorted = [...matches].sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(sorted.map((match) => match.id)).size !== sorted.length) return null;
  const json = JSON.stringify(sorted);
  if (createHash("sha256").update(json).digest("hex") !== digest) return null;
  const expectedId = `${COMMUNITY_SOURCE_SHARD_PREFIX}${day}-${shard}-${digest.slice(0, 16)}`;
  if (documentId !== expectedId) return null;
  for (const match of sorted) {
    if (
      communitySourceUtcDay(communitySourceMatchCreatedAtMs(match)) !== day ||
      communitySourceShardIndex(match.id) !== shard
    ) {
      return null;
    }
  }
  return {
    id: documentId,
    day,
    shard,
    digest,
    matchCount,
    matchesGz,
    matches: sorted,
  };
}

export function encodeCommunitySourceShard(
  shard: CommunitySourceShard,
  updatedAt: number,
): Record<string, unknown> {
  return {
    schemaVersion: COMMUNITY_SOURCE_CACHE_SCHEMA_VERSION,
    day: shard.day,
    shard: shard.shard,
    digest: shard.digest,
    matchCount: shard.matchCount,
    matchesGz: shard.matchesGz,
    updatedAt,
  };
}

export function parseCommunitySourceManifest(
  raw: Record<string, unknown> | undefined,
): CommunitySourceManifest | null {
  if (!raw || raw.schemaVersion !== COMMUNITY_SOURCE_CACHE_SCHEMA_VERSION) return null;
  const cursorChangedAtMs = nonNegativeSafeInteger(raw.cursorChangedAtMs);
  const cursorDocumentId = typeof raw.cursorDocumentId === "string"
    ? raw.cursorDocumentId
    : "";
  const shardIds = Array.isArray(raw.shardIds)
    ? raw.shardIds.filter((value): value is string => (
        typeof value === "string" && value.startsWith(COMMUNITY_SOURCE_SHARD_PREFIX)
      ))
    : [];
  const sourceMatchCount = nonNegativeSafeInteger(raw.sourceMatchCount);
  const publicLifetimeMatchCount = raw.publicLifetimeMatchCount === null ||
    raw.publicLifetimeMatchCount === undefined
    ? null
    : nonNegativeSafeInteger(raw.publicLifetimeMatchCount);
  const fullReconciledAt = nonNegativeSafeInteger(raw.fullReconciledAt);
  const legacyAuditedAt = nonNegativeSafeInteger(raw.legacyAuditedAt);
  const updatedAt = nonNegativeSafeInteger(raw.updatedAt);
  if (
    cursorChangedAtMs === null ||
    sourceMatchCount === null ||
    (raw.publicLifetimeMatchCount !== null &&
      raw.publicLifetimeMatchCount !== undefined &&
      publicLifetimeMatchCount === null) ||
    fullReconciledAt === null ||
    legacyAuditedAt === null ||
    updatedAt === null ||
    shardIds.length !== new Set(shardIds).size ||
    shardIds.length > COMMUNITY_SOURCE_SHARDS_PER_DAY * (COMMUNITY_SOURCE_RETENTION_DAYS + 2)
  ) {
    return null;
  }
  return {
    schemaVersion: COMMUNITY_SOURCE_CACHE_SCHEMA_VERSION,
    cursor: {
      changedAtMs: cursorChangedAtMs,
      documentId: cursorDocumentId,
    },
    shardIds,
    sourceMatchCount,
    publicLifetimeMatchCount,
    fullReconciledAt,
    legacyTimestampComplete: raw.legacyTimestampComplete === true,
    legacyAuditedAt,
    updatedAt,
  };
}

export function encodeCommunitySourceManifest(
  input: Omit<CommunitySourceManifest, "schemaVersion">,
): Record<string, unknown> {
  return {
    schemaVersion: COMMUNITY_SOURCE_CACHE_SCHEMA_VERSION,
    cursorChangedAtMs: input.cursor.changedAtMs,
    cursorDocumentId: input.cursor.documentId,
    shardIds: [...input.shardIds].sort(),
    sourceMatchCount: input.sourceMatchCount,
    publicLifetimeMatchCount: input.publicLifetimeMatchCount,
    fullReconciledAt: input.fullReconciledAt,
    legacyTimestampComplete: input.legacyTimestampComplete,
    legacyAuditedAt: input.legacyAuditedAt,
    updatedAt: input.updatedAt,
  };
}

export function materializeCommunitySourceMatches(
  manifest: CommunitySourceManifest,
  shards: CommunitySourceShard[],
  now = Date.now(),
): CommunityMatch[] | null {
  if (shards.length !== manifest.shardIds.length) return null;
  if (new Set(shards.map((shard) => shard.id)).size !== shards.length) return null;
  if (shards.some((shard) => !manifest.shardIds.includes(shard.id))) return null;
  const storedMatches = shards.flatMap((shard) => shard.matches);
  if (
    storedMatches.length !== manifest.sourceMatchCount ||
    new Set(storedMatches.map((match) => match.id)).size !== storedMatches.length
  ) {
    return null;
  }
  return applyCommunitySourceChanges(
    [],
    storedMatches.map((match, index) => ({
      changedAtMs: index + 1,
      documentId: communitySourceChangeDocId(match.id),
      matchId: match.id,
      match,
    })),
    now,
  );
}

export function communitySourceNeedsFullReconcile(
  manifest: CommunitySourceManifest | null,
  now = Date.now(),
): boolean {
  return !manifest ||
    manifest.fullReconciledAt <= 0 ||
    now - manifest.fullReconciledAt >= COMMUNITY_SOURCE_RECONCILE_INTERVAL_MS;
}

export function communitySourceNeedsLegacyAudit(
  manifest: CommunitySourceManifest | null,
  now = Date.now(),
): boolean {
  return !manifest?.legacyTimestampComplete ||
    manifest.legacyAuditedAt <= 0 ||
    now - manifest.legacyAuditedAt >= COMMUNITY_SOURCE_LEGACY_AUDIT_INTERVAL_MS;
}

function isRetainedCommunitySourceMatch(match: CommunityMatch, now: number): boolean {
  const createdAt = communitySourceMatchCreatedAtMs(match);
  const cutoff = now - COMMUNITY_SOURCE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return Boolean(
    match.id.trim() &&
    !match.superseded &&
    !match.mergedIntoMatchId &&
    createdAt >= cutoff &&
    createdAt <= now + 24 * 60 * 60 * 1000,
  );
}

function communitySourceUtcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function communitySourceShardIndex(matchId: string): number {
  const prefix = createHash("sha256").update(matchId).digest().readUInt32BE(0);
  return prefix % COMMUNITY_SOURCE_SHARDS_PER_DAY;
}

function encodeJson(value: unknown): string {
  return gzipSync(JSON.stringify(value)).toString("base64");
}

function decodeJson<T>(encoded: string): T | null {
  try {
    return JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8")) as T;
  } catch {
    return null;
  }
}

function isCommunityMatchRecord(value: unknown): value is CommunityMatch {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === "string" &&
    (value as { id: string }).id.trim(),
  );
}

function nonNegativeSafeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function positiveSafeInteger(value: unknown): number | null {
  const number = nonNegativeSafeInteger(value);
  return number !== null && number > 0 ? number : null;
}
