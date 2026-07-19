import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getChunk: vi.fn(),
  getManifest: vi.fn(),
  listConflicts: vi.fn(),
  requireOwner: vi.fn(),
  resolveConflict: vi.fn(),
}));

vi.mock("@/lib/account-cloud-sync-conflict-server", () => ({
  accountCloudSyncConflictResponse: (error: unknown) => Response.json({ error: String(error) }, { status: 500 }),
  accountCloudSyncPrivateJson: (body: Record<string, unknown>, status = 200) => {
    const response = Response.json(body, { status });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Vary", "Authorization");
    return response;
  },
  getAccountCloudSyncConflictChunk: mocks.getChunk,
  getAccountCloudSyncConflictManifest: mocks.getManifest,
  listAccountCloudSyncConflicts: mocks.listConflicts,
  requireCanonicalAccountCloudSyncOwner: mocks.requireOwner,
  resolveAccountCloudSyncConflict: mocks.resolveConflict,
}));

vi.mock("@/lib/social/server", () => ({
  socialJson: (body: Record<string, unknown>, status = 200) => Response.json(body, { status }),
}));

import { GET as listConflicts } from "@/app/api/account/cloud-sync/conflicts/route";
import { GET as getManifest } from "@/app/api/account/cloud-sync/conflicts/[conflictId]/manifest/route";
import { GET as getChunk } from "@/app/api/account/cloud-sync/conflicts/[conflictId]/chunks/[index]/route";
import { POST as resolveConflict } from "@/app/api/account/cloud-sync/conflicts/[conflictId]/resolve/route";

describe("account cloud backup conflict routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({ db: { marker: "db" }, uid: "account-owner", authenticatedUid: "account-owner" });
  });

  it("lists only opaque conflict ids and safe backup summaries", async () => {
    mocks.listConflicts.mockResolvedValue([{
      id: "a".repeat(64),
      status: "pending",
      currentFingerprint: "b".repeat(64),
      legacyFingerprint: "c".repeat(64),
      current: backupSummary("Current PC"),
      legacy: backupSummary("Old Mac"),
    }]);

    const response = await listConflicts({} as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toContain("Authorization");
    expect(payload).toMatchObject({
      ok: true,
      conflicts: [{ id: "a".repeat(64), current: { deviceName: "Current PC" }, legacy: { deviceName: "Old Mac" } }],
    });
    expect(JSON.stringify(payload)).not.toContain("sourceUid");
    expect(JSON.stringify(payload)).not.toContain("canonicalUid");
  });

  it("proxies a retained manifest and fingerprint without accepting a source uid", async () => {
    mocks.getManifest.mockResolvedValue({
      conflictId: "a".repeat(64),
      legacyFingerprint: "c".repeat(64),
      manifest: { version: 2, chunkCount: 1 },
    });

    const response = await getManifest({} as never, params({ conflictId: "a".repeat(64) }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      conflictId: "a".repeat(64),
      legacyFingerprint: "c".repeat(64),
      manifest: { version: 2, chunkCount: 1 },
    });
    expect(mocks.getManifest).toHaveBeenCalledWith({ marker: "db" }, "account-owner", "a".repeat(64));
  });

  it("binds every chunk request to the manifest fingerprint", async () => {
    mocks.getChunk.mockResolvedValue({
      conflictId: "a".repeat(64),
      legacyFingerprint: "c".repeat(64),
      index: 0,
      payload: "compressed",
      byteSize: 10,
      checksum: "d".repeat(64),
    });
    const request = {
      nextUrl: new URL(`https://riftlite.example/api/account/cloud-sync/conflicts/${"a".repeat(64)}/chunks/0?legacyFingerprint=${"c".repeat(64)}`),
    } as never;

    const response = await getChunk(request, params({ conflictId: "a".repeat(64), index: "0" }));

    expect(response.status).toBe(200);
    expect(mocks.getChunk).toHaveBeenCalledWith(
      { marker: "db" },
      "account-owner",
      "a".repeat(64),
      0,
      "c".repeat(64),
    );
  });

  it("passes an explicit owner choice and staged manifest to atomic resolution", async () => {
    mocks.resolveConflict.mockResolvedValue({
      conflictId: "a".repeat(64),
      status: "resolved",
      choice: "restore-legacy",
      resolvedAt: 123,
    });
    const stagedManifest = {
      format: "riftlite.account-cloud-sync",
      version: 2,
      generationId: "recovered-generation",
      chunkCount: 1,
      byteSize: 10,
      checksumAlgorithm: "sha256",
      checksum: "d".repeat(64),
      chunkChecksums: ["d".repeat(64)],
      counts: { matches: 1, decks: 1, notebooks: 0, replays: 0 },
    };
    const request = {
      json: async () => ({
        choice: "restore-legacy",
        legacyFingerprint: "c".repeat(64),
        currentFingerprint: "b".repeat(64),
        stagedManifest,
      }),
    } as never;

    const response = await resolveConflict(request, params({ conflictId: "a".repeat(64) }));

    expect(response.status).toBe(200);
    expect(mocks.resolveConflict).toHaveBeenCalledWith(
      { marker: "db" },
      "account-owner",
      "account-owner",
      "a".repeat(64),
      {
        choice: "restore-legacy",
        legacyFingerprint: "c".repeat(64),
        currentFingerprint: "b".repeat(64),
        stagedManifest,
      },
    );
  });

  it("returns canonical-owner authentication failures before reading conflict state", async () => {
    mocks.requireOwner.mockResolvedValue({ error: Response.json({ error: "Reconnect required" }, { status: 409 }) });

    const response = await listConflicts({} as never);

    expect(response.status).toBe(409);
    expect(mocks.listConflicts).not.toHaveBeenCalled();
  });
});

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

function backupSummary(deviceName: string) {
  return {
    available: true,
    updatedAt: "2026-07-18T12:00:00.000Z",
    deviceName,
    appVersion: "0.8.5-dev.7",
    byteSize: 128,
    counts: { matches: 3, decks: 2, notebooks: 1, replays: 0 },
  };
}
