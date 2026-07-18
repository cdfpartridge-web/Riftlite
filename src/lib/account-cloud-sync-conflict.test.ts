import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  accountCloudSyncChunkDocumentId,
  accountCloudSyncConflictId,
  accountCloudSyncManifestFingerprint,
  identityAliasProvesCloudSyncConflict,
  normalizeAccountCloudSyncManifest,
  validateAccountCloudSyncChunk,
} from "@/lib/account-cloud-sync-conflict";

describe("account cloud backup conflict primitives", () => {
  it("requires an exact server-owned canonical-to-source conflict relationship", () => {
    const record = {
      sourceUid: "desktop-source",
      canonicalUid: "account-owner",
      cloudSyncConflict: true,
      cloudSyncSourceUid: "desktop-source",
      cloudSyncCanonicalUid: "account-owner",
    };

    expect(identityAliasProvesCloudSyncConflict(record, "desktop-source", "account-owner")).toBe(true);
    expect(identityAliasProvesCloudSyncConflict(record, "other-source", "account-owner")).toBe(false);
    expect(identityAliasProvesCloudSyncConflict(record, "desktop-source", "other-owner")).toBe(false);
    expect(identityAliasProvesCloudSyncConflict({ ...record, cloudSyncConflict: false }, "desktop-source", "account-owner")).toBe(false);
  });

  it("uses an opaque stable id instead of exposing either Firebase UID", () => {
    const id = accountCloudSyncConflictId("account-owner", "desktop-source");

    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(id).not.toContain("account-owner");
    expect(id).not.toContain("desktop-source");
    expect(accountCloudSyncConflictId("account-owner", "desktop-source")).toBe(id);
    expect(accountCloudSyncConflictId("another-owner", "desktop-source")).not.toBe(id);
  });

  it("normalizes and fingerprints the desktop v2 manifest deterministically", () => {
    const payload = "compressed-backup";
    const checksum = sha256(payload);
    const manifest = normalizeAccountCloudSyncManifest({
      format: "riftlite.account-cloud-sync",
      version: 2,
      updated_at: "2026-07-18T12:00:00.000Z",
      device_id: "device-private",
      device_name: "Gaming PC",
      app_version: "0.8.5-dev.7",
      generation_id: "generation-safe",
      chunk_count: 1,
      byte_size: Buffer.byteLength(payload, "utf8"),
      checksum_algorithm: "sha256",
      checksum,
      chunk_checksums: [checksum],
      counts: { matches: 12, decks: 3, notebooks: 2, replays: 0 },
    }, "2026-07-18T12:00:01.000Z");

    expect(manifest).not.toBeNull();
    expect(accountCloudSyncManifestFingerprint(manifest!)).toMatch(/^[a-f0-9]{64}$/);
    expect(accountCloudSyncChunkDocumentId(manifest!, 0)).toBe("generation-safe-chunk-0000");
    expect(validateAccountCloudSyncChunk(manifest!, 0, {
      format: "riftlite.account-cloud-sync",
      version: 2,
      generation_id: "generation-safe",
      index: 0,
      payload,
      byte_size: Buffer.byteLength(payload, "utf8"),
      checksum,
    })).toEqual({ payload, byteSize: Buffer.byteLength(payload, "utf8"), checksum });
  });

  it("rejects a corrupt v2 chunk before proxying its payload", () => {
    const payload = "compressed-backup";
    const checksum = sha256(payload);
    const manifest = normalizeAccountCloudSyncManifest({
      format: "riftlite.account-cloud-sync",
      version: 2,
      generation_id: "generation-safe",
      chunk_count: 1,
      byte_size: payload.length,
      checksum_algorithm: "sha256",
      checksum,
      chunk_checksums: [checksum],
      counts: {},
    });

    expect(manifest).not.toBeNull();
    expect(validateAccountCloudSyncChunk(manifest!, 0, {
      format: "riftlite.account-cloud-sync",
      version: 2,
      generation_id: "generation-safe",
      index: 0,
      payload: `${payload}-tampered`,
      byte_size: payload.length,
      checksum,
    })).toBeNull();
  });

  it("retains compatibility with fixed-id v1 backup chunks", () => {
    const manifest = normalizeAccountCloudSyncManifest({
      format: "riftlite.account-cloud-sync",
      version: 1,
      chunk_count: 1,
      byte_size: 7,
      counts: {},
    });

    expect(manifest).not.toBeNull();
    expect(accountCloudSyncChunkDocumentId(manifest!, 0)).toBe("chunk-0000");
    expect(validateAccountCloudSyncChunk(manifest!, 0, { index: 0, payload: "legacy!" }))
      .toEqual({ payload: "legacy!", byteSize: 7, checksum: "" });
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
