import { describe, expect, it } from "vitest";

import {
  applyCommunitySourceChanges,
  buildCommunitySourceShards,
  communitySourceChangeDocId,
  communitySourceNeedsFullReconcile,
  communitySourceNeedsLegacyAudit,
  decodeCommunitySourceChange,
  decodeCommunitySourceShard,
  emptyCommunitySourceCursor,
  encodeCommunitySourceChange,
  encodeCommunitySourceManifest,
  encodeCommunitySourceShard,
  latestCommunitySourceCursor,
  materializeCommunitySourceMatches,
  nextCommunitySourceChangeTimestamp,
  parseCommunitySourceManifest,
  COMMUNITY_SOURCE_CACHE_SCHEMA_VERSION,
  COMMUNITY_SOURCE_LEGACY_AUDIT_INTERVAL_MS,
  COMMUNITY_SOURCE_RECONCILE_INTERVAL_MS,
} from "@/lib/community/source-cache";
import type { CommunityMatch } from "@/lib/types";

const NOW = Date.UTC(2026, 7, 15, 12);

function match(id: string, ageDays = 1, overrides: Partial<CommunityMatch> = {}): CommunityMatch {
  return {
    id,
    uid: `uid-${id}`,
    username: id,
    date: "2026-08-14",
    result: "Win",
    myChampion: "Ahri",
    oppChampion: "Jinx",
    oppName: "Opponent",
    fmt: "Bo1",
    score: "1-0",
    wentFirst: "First",
    myBattlefield: "",
    oppBattlefield: "",
    flags: "",
    games: [],
    deckName: "",
    deckSourceUrl: "",
    deckSourceKey: "",
    deckSnapshot: null,
    createdAt: NOW - ageDays * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

describe("community aggregate source cache", () => {
  it("round-trips deterministic day shards and the manifest", () => {
    const matches = [match("a"), match("b", 8), match("c", 29)];
    const shards = buildCommunitySourceShards(matches, NOW);
    expect(shards).toHaveLength(3);

    const decoded = shards.map((shard) => decodeCommunitySourceShard(
      shard.id,
      encodeCommunitySourceShard(shard, NOW),
    ));
    expect(decoded.every(Boolean)).toBe(true);

    const rawManifest = encodeCommunitySourceManifest({
      cursor: { changedAtMs: 42, documentId: "a" },
      shardIds: shards.map((shard) => shard.id),
      sourceMatchCount: 3,
      fullReconciledAt: NOW,
      legacyTimestampComplete: true,
      legacyAuditedAt: NOW,
      updatedAt: NOW,
    });
    const manifest = parseCommunitySourceManifest(rawManifest);
    expect(manifest?.schemaVersion).toBe(COMMUNITY_SOURCE_CACHE_SCHEMA_VERSION);
    expect(materializeCommunitySourceMatches(
      manifest!,
      decoded.filter((value) => value !== null),
      NOW,
    )?.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("applies updates, removals and exact rolling-window expiry", () => {
    const existing = [match("keep"), match("remove"), match("expired", 30.1)];
    const changes = [
      {
        documentId: communitySourceChangeDocId("keep"),
        matchId: "keep",
        changedAtMs: 10,
        match: match("keep", 1, { result: "Loss" }),
      },
      {
        documentId: communitySourceChangeDocId("remove"),
        matchId: "remove",
        changedAtMs: 11,
        match: match("remove", 1, { superseded: true }),
      },
      {
        documentId: communitySourceChangeDocId("new"),
        matchId: "new",
        changedAtMs: 12,
        match: match("new", 0),
      },
    ];

    const result = applyCommunitySourceChanges(existing, changes, NOW);
    expect(result.map((row) => row.id)).toEqual(["new", "keep"]);
    expect(result.find((row) => row.id === "keep")?.result).toBe("Loss");
    expect(latestCommunitySourceCursor(emptyCommunitySourceCursor(), changes)).toEqual({
      changedAtMs: 12,
      documentId: communitySourceChangeDocId("new"),
    });
  });

  it("strictly validates journal rows and shard integrity", () => {
    const source = match("match/1");
    const id = communitySourceChangeDocId(source.id);
    const encoded = encodeCommunitySourceChange(source, 10);
    expect(decodeCommunitySourceChange(id, encoded)?.match).toEqual(source);
    expect(decodeCommunitySourceChange("wrong", encoded)).toBeNull();

    const shard = buildCommunitySourceShards([source], NOW)[0];
    expect(decodeCommunitySourceShard(shard.id, {
      ...encodeCommunitySourceShard(shard, NOW),
      digest: "0".repeat(64),
    })).toBeNull();
  });

  it("keeps per-match journal timestamps monotonic", () => {
    expect(nextCommunitySourceChangeTimestamp(100, 100)).toBe(101);
    expect(nextCommunitySourceChangeTimestamp(100, 250)).toBe(250);
  });

  it("expires cached matches without treating the prior manifest as corrupt", () => {
    const shards = buildCommunitySourceShards([
      match("soon-expired", 29.5),
      match("retained", 2),
    ], NOW);
    const manifest = parseCommunitySourceManifest(encodeCommunitySourceManifest({
      cursor: emptyCommunitySourceCursor(),
      shardIds: shards.map((shard) => shard.id),
      sourceMatchCount: 2,
      fullReconciledAt: NOW,
      legacyTimestampComplete: true,
      legacyAuditedAt: NOW,
      updatedAt: NOW,
    }));
    const decoded = shards.map((shard) => decodeCommunitySourceShard(
      shard.id,
      encodeCommunitySourceShard(shard, NOW),
    )).filter((shard) => shard !== null);

    expect(materializeCommunitySourceMatches(
      manifest!,
      decoded,
      NOW + 24 * 60 * 60 * 1000,
    )?.map((row) => row.id)).toEqual(["retained"]);
  });

  it("requires bounded reconciliation and legacy audits", () => {
    const manifest = parseCommunitySourceManifest(encodeCommunitySourceManifest({
      cursor: emptyCommunitySourceCursor(),
      shardIds: [],
      sourceMatchCount: 0,
      fullReconciledAt: NOW,
      legacyTimestampComplete: true,
      legacyAuditedAt: NOW,
      updatedAt: NOW,
    }));
    expect(communitySourceNeedsFullReconcile(manifest, NOW + 1)).toBe(false);
    expect(communitySourceNeedsFullReconcile(
      manifest,
      NOW + COMMUNITY_SOURCE_RECONCILE_INTERVAL_MS,
    )).toBe(true);
    expect(communitySourceNeedsLegacyAudit(manifest, NOW + 1)).toBe(false);
    expect(communitySourceNeedsLegacyAudit(
      manifest,
      NOW + COMMUNITY_SOURCE_LEGACY_AUDIT_INTERVAL_MS,
    )).toBe(true);
  });
});
