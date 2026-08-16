import type { Firestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { delMock } = vi.hoisted(() => ({ delMock: vi.fn() }));

vi.mock("@vercel/blob", () => ({
  del: delMock,
  get: vi.fn(),
  put: vi.fn(),
}));

import { deleteImmutableArtifact } from "@/lib/replay-v2-server/artifacts";

const REPLAY_ID = `rl2_${"a".repeat(32)}`;
const GENERATION = `canonical_${"b".repeat(32)}`;
const SHA256 = "c".repeat(64);

describe("immutable replay artifact deletion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes only the validated private Blob path", async () => {
    await deleteImmutableArtifact({} as Firestore, {
      provider: "vercel-blob",
      kind: "canonical",
      generation: GENERATION,
      pathname: `replay-v2/canonical/${REPLAY_ID}/${GENERATION}-${SHA256}.json.gz`,
      sha256: SHA256,
      bytes: 1_024,
      contentType: "application/gzip",
    });

    expect(delMock).toHaveBeenCalledWith(
      `replay-v2/canonical/${REPLAY_ID}/${GENERATION}-${SHA256}.json.gz`,
    );
  });

  it("rejects a path outside the replay namespace before deleting", async () => {
    await expect(deleteImmutableArtifact({} as Firestore, {
      provider: "vercel-blob",
      kind: "canonical",
      generation: GENERATION,
      pathname: "other/private-object.json.gz",
      sha256: SHA256,
      bytes: 1_024,
      contentType: "application/gzip",
    })).rejects.toMatchObject({ code: "artifact_delete_failed" });

    expect(delMock).not.toHaveBeenCalled();
  });

  it("recursively removes a Firestore fallback artifact and its chunks", async () => {
    const artifactRef = { path: `replayV2Artifacts/${REPLAY_ID}_${GENERATION}` };
    const recursiveDelete = vi.fn(async () => undefined);
    const db = {
      collection: vi.fn(() => ({ doc: vi.fn(() => artifactRef) })),
      recursiveDelete,
    } as unknown as Firestore;

    await deleteImmutableArtifact(db, {
      provider: "firestore-chunks",
      kind: "canonical",
      generation: GENERATION,
      artifactId: `${REPLAY_ID}_${GENERATION}`,
      chunkCount: 2,
      sha256: SHA256,
      bytes: 1_024,
      contentType: "application/gzip",
    });

    expect(recursiveDelete).toHaveBeenCalledWith(artifactRef);
  });
});
