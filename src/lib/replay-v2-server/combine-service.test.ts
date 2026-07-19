import { gzipSync } from "node:zlib";

import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  combineCanonicalReplaysMock,
  getFirestoreAdminMock,
  readCanonicalReplayMock,
  storeImmutableArtifactMock,
} = vi.hoisted(() => ({
  combineCanonicalReplaysMock: vi.fn(),
  getFirestoreAdminMock: vi.fn(),
  readCanonicalReplayMock: vi.fn(),
  storeImmutableArtifactMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: getFirestoreAdminMock,
}));

vi.mock("@/lib/replay-v2-server/artifacts", () => ({
  storeImmutableArtifact: storeImmutableArtifactMock,
}));

vi.mock("@/lib/replay-v2-server/service", () => ({
  readCanonicalReplay: readCanonicalReplayMock,
}));

vi.mock("@/lib/replay-v2/combine-replays", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/replay-v2/combine-replays")>();
  return {
    ...actual,
    combineCanonicalReplays: combineCanonicalReplaysMock,
  };
});

import type { CanonicalReplayV2 } from "@/lib/replay-v2/types";
import { deterministicReplayId } from "@/lib/replay-v2-server/ids";
import type { ReplayArtifactPointer, ReplayRecord } from "@/lib/replay-v2-server/model";
import {
  REPLAY_COMBINATION_SCHEMA,
  assertExistingCombinedReplay,
  buildCombinedReplayRecord,
  createCombinedReplay,
  deterministicCombinedCaptureId,
  type CombinedReplayRecord,
} from "@/lib/replay-v2-server/combine-service";

const LEFT_ID = `rl2_${"a".repeat(32)}`;
const RIGHT_ID = `rl2_${"b".repeat(32)}`;
const LEFT_SHA = "1".repeat(64);
const RIGHT_SHA = "2".repeat(64);

describe("combined replay persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readCanonicalReplayMock.mockImplementation(async (replayId: string) => sourceResponse(replayId));
    storeImmutableArtifactMock.mockResolvedValue(canonicalArtifact());
    combineCanonicalReplaysMock.mockImplementation((input: { replayId: string }) => combinedCanonical(input.replayId));
  });

  it("derives an order-independent deterministic capture identity", () => {
    const leftFirst = deterministicCombinedCaptureId([
      { replayId: LEFT_ID, canonicalSha256: LEFT_SHA },
      { replayId: RIGHT_ID, canonicalSha256: RIGHT_SHA },
    ]);
    const rightFirst = deterministicCombinedCaptureId([
      { replayId: RIGHT_ID, canonicalSha256: RIGHT_SHA },
      { replayId: LEFT_ID, canonicalSha256: LEFT_SHA },
    ]);

    expect(leftFirst).toBe(rightFirst);
    expect(leftFirst).toMatch(/^combine-v2-[a-f0-9]{64}$/);
    expect(deterministicCombinedCaptureId([
      { replayId: LEFT_ID, canonicalSha256: LEFT_SHA },
      { replayId: RIGHT_ID, canonicalSha256: "3".repeat(64) },
    ])).not.toBe(leftFirst);
  });

  it("builds a ready unlisted record with immutable provenance and no raw artifact", () => {
    const canonical = combinedCanonical(`rl2_${"c".repeat(32)}`);
    const sources = loadedSources();
    const fingerprints = sourceFingerprints();
    const createdAt = Timestamp.fromMillis(Date.UTC(2026, 6, 11, 16));
    const record = buildCombinedReplayRecord({
      ownerUid: "owner-1",
      replayId: canonical.id,
      captureId: "combine-v2-test",
      canonical,
      canonicalArtifact: canonicalArtifact(),
      fingerprints,
      sources,
      createdAt,
    });

    expect(record.visibility).toBe("unlisted");
    expect(record.status).toBe("ready");
    expect(record.rawArtifact).toBeUndefined();
    expect(record.canonicalArtifact).toEqual(canonicalArtifact());
    expect(record.expectedRaw.bytes).toBe(0);
    expect(record.combination).toMatchObject({
      schema: REPLAY_COMBINATION_SCHEMA,
      version: 2,
      sourceReplayIds: [LEFT_ID, RIGHT_ID],
      sourceCanonicalSha256s: [LEFT_SHA, RIGHT_SHA],
      permissionConfirmed: true,
    });
  });

  it("stores the ready replay and its owner-library summary once", async () => {
    const fake = fakeReplayDb();
    getFirestoreAdminMock.mockReturnValue(fake.db);

    const result = await createCombinedReplay("owner-1", RIGHT_ID, LEFT_ID);

    expect(result.created).toBe(true);
    expect(storeImmutableArtifactMock).toHaveBeenCalledOnce();
    expect(fake.transaction.create).toHaveBeenCalledOnce();
    const created = fake.transaction.create.mock.calls[0]?.[1] as CombinedReplayRecord;
    expect(created.visibility).toBe("unlisted");
    expect(created.status).toBe("ready");
    expect(created.rawArtifact).toBeUndefined();
    expect(fake.transaction.set).toHaveBeenCalledOnce();
    expect(fake.transaction.set.mock.calls[0]?.[0]?.path).toBe(
      `replayV2Owners/owner-1/items/${created.replayId}`,
    );
  });

  it("returns an existing deterministic result without storing another artifact", async () => {
    const firstFake = fakeReplayDb();
    getFirestoreAdminMock.mockReturnValue(firstFake.db);
    const first = await createCombinedReplay("owner-1", LEFT_ID, RIGHT_ID);
    const existing = firstFake.transaction.create.mock.calls[0]?.[1] as CombinedReplayRecord;

    vi.clearAllMocks();
    readCanonicalReplayMock.mockImplementation(async (replayId: string) => sourceResponse(replayId));
    combineCanonicalReplaysMock.mockImplementation((input: { replayId: string }) => combinedCanonical(input.replayId));
    const retryFake = fakeReplayDb(existing);
    getFirestoreAdminMock.mockReturnValue(retryFake.db);

    const retried = await createCombinedReplay("owner-1", RIGHT_ID, LEFT_ID);

    expect(retried.created).toBe(false);
    expect(retried.record.replayId).toBe(first.record.replayId);
    expect(storeImmutableArtifactMock).not.toHaveBeenCalled();
    expect(retryFake.db.runTransaction).not.toHaveBeenCalled();
  });

  it("rejects deterministic ID reuse with mismatched source provenance", () => {
    const fingerprints = sourceFingerprints();
    const captureId = deterministicCombinedCaptureId(fingerprints);
    const replayId = deterministicReplayId("owner-1", captureId);
    const record = buildCombinedReplayRecord({
      ownerUid: "owner-1",
      replayId,
      captureId,
      canonical: combinedCanonical(replayId),
      canonicalArtifact: canonicalArtifact(),
      fingerprints,
      sources: loadedSources(),
      createdAt: Timestamp.now(),
    });
    const corrupted = {
      ...record,
      combination: {
        ...record.combination,
        sourceCanonicalSha256s: [LEFT_SHA, "f".repeat(64)],
      },
    };

    expect(() =>
      assertExistingCombinedReplay(
        corrupted,
        "owner-1",
        replayId,
        captureId,
        fingerprints,
      ),
    ).toThrow("conflicts with different source provenance");
  });
});

function sourceResponse(replayId: string) {
  const source = replayId === LEFT_ID ? loadedSources()[0] : loadedSources()[1];
  return {
    record: source.record,
    bytes: gzipSync(Buffer.from(JSON.stringify(source.replay), "utf8")),
  };
}

function loadedSources() {
  const leftReplay = sourceCanonical(LEFT_ID, "player-left");
  const rightReplay = sourceCanonical(RIGHT_ID, "player-right");
  return [
    {
      replayId: LEFT_ID,
      record: sourceRecord(LEFT_ID, LEFT_SHA, Timestamp.fromMillis(1_784_000_000_000)),
      canonicalSha256: LEFT_SHA,
      replay: leftReplay,
    },
    {
      replayId: RIGHT_ID,
      record: sourceRecord(RIGHT_ID, RIGHT_SHA, Timestamp.fromMillis(1_784_000_001_000)),
      canonicalSha256: RIGHT_SHA,
      replay: rightReplay,
    },
  ] as const;
}

function sourceFingerprints() {
  return [
    { replayId: LEFT_ID, canonicalSha256: LEFT_SHA },
    { replayId: RIGHT_ID, canonicalSha256: RIGHT_SHA },
  ] as const;
}

function sourceRecord(replayId: string, sha256: string, capturedAt: Timestamp): ReplayRecord {
  return {
    schema: "riftlite-replay-record",
    version: 2,
    replayId,
    ownerUid: replayId === LEFT_ID ? "owner-1" : "owner-2",
    captureId: `capture-${replayId}`,
    visibility: replayId === LEFT_ID ? "private" : "unlisted",
    status: "ready",
    title: "Atlas replay",
    platform: "atlas",
    localReplayId: "",
    matchId: "match-1",
    seriesId: "series-1",
    roomCode: "ROOM1",
    messageCount: 20,
    expectedRaw: { sha256, bytes: 100 },
    canonicalArtifact: sourceArtifact(replayId, sha256),
    failure: null,
    capturedAt,
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
}

function sourceArtifact(replayId: string, sha256: string): ReplayArtifactPointer {
  return {
    provider: "vercel-blob",
    kind: "canonical",
    generation: `canonical_${replayId.slice(4)}`,
    pathname: `replay-v2/canonical/${replayId}/canonical_${replayId.slice(4)}-${sha256}.json.gz`,
    sha256,
    bytes: 100,
    contentType: "application/gzip",
  };
}

function canonicalArtifact(): ReplayArtifactPointer {
  const replayId = `rl2_${"c".repeat(32)}`;
  const sha256 = "9".repeat(64);
  return sourceArtifact(replayId, sha256);
}

function sourceCanonical(replayId: string, perspectivePlayerId: string): CanonicalReplayV2 {
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: replayId,
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: "",
      roomCode: "",
      startedAt: 1_784_000_000_000,
      endedAt: 1_784_000_060_000,
      messageCount: 20,
    },
    series: {
      id: "series-1",
      perspectivePlayerId,
      format: "bo1",
      bestOf: 1,
      roomCode: "",
      startedAt: 1_784_000_000_000,
      endedAt: 1_784_000_060_000,
      participants: [
        { id: "player-left", name: "Left", isPerspective: perspectivePlayerId === "player-left", fields: {} },
        { id: "player-right", name: "Right", isPerspective: perspectivePlayerId === "player-right", fields: {} },
      ],
      games: [],
    },
    events: [],
    unknownEvents: [],
    diagnostics: [],
    checkpoints: [],
  };
}

function combinedCanonical(replayId: string): CanonicalReplayV2 {
  const replay = sourceCanonical(replayId, "player-left");
  return {
    ...replay,
    source: { ...replay.source, messageCount: 40 },
    collaboration: {
      schema: "riftlite-dual-perspective",
      version: 1,
      mode: "dual-perspective",
      sourceReplayIds: [LEFT_ID, RIGHT_ID],
      sourceCanonicalSha256s: [LEFT_SHA, RIGHT_SHA],
      perspectivePlayerIds: ["player-left", "player-right"],
      informationPolicy: "consented_full_information",
      confidence: "exact",
      diagnostics: {
        primarySourceReplayId: LEFT_ID,
        pairedSnapshotEvents: 4,
        pairedActionEvents: 10,
        unpairedPrimaryEvents: 0,
        unpairedSecondaryEvents: 0,
        enrichedCards: 7,
        enrichedFields: 12,
        coveragePercent: 100,
        warningCodes: [],
      },
    },
  };
}

function fakeReplayDb(existing?: CombinedReplayRecord) {
  const initialSnapshot = snapshot(existing);
  const transaction = {
    get: vi.fn(async () => snapshot()),
    create: vi.fn(),
    set: vi.fn(),
  };
  const db = {
    collection: (name: string) => collectionReference(name, initialSnapshot),
    runTransaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
  };
  return { db, transaction };
}

function snapshot(value?: CombinedReplayRecord) {
  return {
    exists: Boolean(value),
    data: () => value,
  };
}

function collectionReference(path: string, initialSnapshot: ReturnType<typeof snapshot>) {
  return {
    path,
    doc: (id: string) => documentReference(`${path}/${id}`, initialSnapshot),
  };
}

function documentReference(path: string, initialSnapshot: ReturnType<typeof snapshot>) {
  return {
    path,
    get: vi.fn(async () => initialSnapshot),
    collection: (name: string) => collectionReference(`${path}/${name}`, initialSnapshot),
  };
}
