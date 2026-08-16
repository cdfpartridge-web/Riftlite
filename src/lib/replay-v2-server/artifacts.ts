import "server-only";

import { del, get, put } from "@vercel/blob";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import {
  FIRESTORE_ARTIFACT_FALLBACK_ENV,
  FIRESTORE_CHUNK_CHAR_SIZE,
  MAX_CANONICAL_GZIP_BYTES,
  MAX_FIRESTORE_ARTIFACT_CHUNKS,
  MAX_RAW_GZIP_BYTES,
  REPLAY_ARTIFACT_COLLECTION,
} from "@/lib/replay-v2-server/constants";
import { ReplayV2Error } from "@/lib/replay-v2-server/errors";
import { sha256Hex } from "@/lib/replay-v2-server/ids";
import type { ReplayArtifactKind, ReplayArtifactPointer } from "@/lib/replay-v2-server/model";

type StoreArtifactInput = {
  replayId: string;
  kind: ReplayArtifactKind;
  generation: string;
  bytes: Uint8Array;
};

export async function storeImmutableArtifact(
  db: Firestore,
  input: StoreArtifactInput,
): Promise<ReplayArtifactPointer> {
  const bytes = Buffer.from(input.bytes);
  const maxBytes = artifactByteLimit(input.kind);
  if (!bytes.length || bytes.length > maxBytes) {
    throw new ReplayV2Error(413, "artifact_too_large", `${input.kind} replay artifact is too large.`);
  }

  const sha256 = sha256Hex(bytes);
  const pathname = `replay-v2/${input.kind}/${input.replayId}/${input.generation}-${sha256}.json.gz`;
  if (hasBlobCredentials()) {
    try {
      const blob = await put(pathname, bytes, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60,
        contentType: "application/gzip",
        maximumSizeInBytes: maxBytes,
      });
      return {
        provider: "vercel-blob",
        kind: input.kind,
        generation: input.generation,
        pathname: blob.pathname,
        sha256,
        bytes: bytes.length,
        contentType: "application/gzip",
      };
    } catch {
      // A separately enabled fallback may handle environments where private Blob is unavailable.
    }
  }

  if (process.env[FIRESTORE_ARTIFACT_FALLBACK_ENV] !== "enabled") {
    throw new ReplayV2Error(
      503,
      "artifact_storage_unavailable",
      "Private replay artifact storage is unavailable.",
    );
  }
  try {
    return await storeFirestoreArtifact(db, input, bytes, sha256);
  } catch (error) {
    if (error instanceof ReplayV2Error) throw error;
    throw new ReplayV2Error(500, "artifact_store_failed", "Replay artifact could not be stored.");
  }
}

export async function readImmutableArtifact(
  db: Firestore,
  pointer: ReplayArtifactPointer,
): Promise<Buffer> {
  try {
    assertArtifactPointer(pointer);
    const maxBytes = artifactByteLimit(pointer.kind);
    if (pointer.bytes < 1 || pointer.bytes > maxBytes) {
      throw new ReplayV2Error(500, "artifact_metadata_invalid", "Replay artifact metadata is invalid.");
    }

    let bytes: Buffer;
    if (pointer.provider === "vercel-blob") {
      const result = await get(pointer.pathname, { access: "private" });
      if (!result || result.statusCode !== 200 || !result.stream) {
        throw new ReplayV2Error(500, "artifact_missing", "Replay artifact could not be loaded.");
      }
      if (result.blob.size > maxBytes) {
        throw new ReplayV2Error(500, "artifact_too_large", "Stored replay artifact is too large.");
      }
      bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
    } else {
      bytes = await readFirestoreArtifact(db, pointer);
    }

    if (bytes.length !== pointer.bytes || sha256Hex(bytes) !== pointer.sha256) {
      throw new ReplayV2Error(500, "artifact_checksum_mismatch", "Replay artifact checksum verification failed.");
    }
    return bytes;
  } catch (error) {
    if (error instanceof ReplayV2Error) throw error;
    throw new ReplayV2Error(500, "artifact_read_failed", "Replay artifact could not be loaded.");
  }
}

/**
 * Permanently remove an immutable replay artifact after its owning replay has
 * been deleted. Metadata authorization happens in the replay service before
 * this helper is called; the pointer is still validated here so deletion can
 * never escape the replay-v2 namespace.
 */
export async function deleteImmutableArtifact(
  db: Firestore,
  pointer: ReplayArtifactPointer,
): Promise<void> {
  try {
    assertArtifactPointer(pointer);
    if (pointer.provider === "vercel-blob") {
      await del(pointer.pathname);
      return;
    }
    await db.recursiveDelete(
      db.collection(REPLAY_ARTIFACT_COLLECTION).doc(pointer.artifactId),
    );
  } catch {
    throw new ReplayV2Error(500, "artifact_delete_failed", "Replay artifact cleanup could not be completed.");
  }
}

async function storeFirestoreArtifact(
  db: Firestore,
  input: StoreArtifactInput,
  bytes: Buffer,
  sha256: string,
): Promise<ReplayArtifactPointer> {
  const artifactId = `${input.replayId}_${input.generation}`;
  const base64 = bytes.toString("base64");
  const chunks = splitText(base64, FIRESTORE_CHUNK_CHAR_SIZE);
  if (chunks.length > MAX_FIRESTORE_ARTIFACT_CHUNKS) {
    throw new ReplayV2Error(413, "artifact_too_large", "Replay artifact exceeds Firestore fallback limits.");
  }

  const artifactRef = db.collection(REPLAY_ARTIFACT_COLLECTION).doc(artifactId);
  const batch = db.batch();
  batch.create(artifactRef, {
    replayId: input.replayId,
    kind: input.kind,
    generation: input.generation,
    sha256,
    bytes: bytes.length,
    chunkCount: chunks.length,
    contentType: "application/gzip",
    immutable: true,
    createdAt: Timestamp.now(),
  });
  chunks.forEach((data, index) => {
    batch.create(artifactRef.collection("chunks").doc(index.toString().padStart(4, "0")), {
      index,
      data,
    });
  });
  await batch.commit();

  return {
    provider: "firestore-chunks",
    kind: input.kind,
    generation: input.generation,
    artifactId,
    chunkCount: chunks.length,
    sha256,
    bytes: bytes.length,
    contentType: "application/gzip",
  };
}

async function readFirestoreArtifact(
  db: Firestore,
  pointer: Extract<ReplayArtifactPointer, { provider: "firestore-chunks" }>,
): Promise<Buffer> {
  if (pointer.chunkCount < 1 || pointer.chunkCount > MAX_FIRESTORE_ARTIFACT_CHUNKS) {
    throw new ReplayV2Error(500, "artifact_metadata_invalid", "Replay artifact chunk metadata is invalid.");
  }
  const artifactRef = db.collection(REPLAY_ARTIFACT_COLLECTION).doc(pointer.artifactId);
  const artifact = await artifactRef.get();
  if (!artifact.exists) {
    throw new ReplayV2Error(500, "artifact_missing", "Replay artifact is missing.");
  }
  const chunks = await artifactRef.collection("chunks").orderBy("index", "asc").get();
  if (chunks.size !== pointer.chunkCount) {
    throw new ReplayV2Error(500, "artifact_incomplete", "Replay artifact is incomplete.");
  }
  const encoded = chunks.docs
    .map((chunk, index) => {
      const data = chunk.data();
      if (data.index !== index || typeof data.data !== "string" || data.data.length > FIRESTORE_CHUNK_CHAR_SIZE) {
        throw new ReplayV2Error(500, "artifact_chunk_invalid", "Replay artifact contains an invalid chunk.");
      }
      return data.data;
    })
    .join("");
  return Buffer.from(encoded, "base64");
}

function artifactByteLimit(kind: ReplayArtifactKind): number {
  return kind === "raw" ? MAX_RAW_GZIP_BYTES : MAX_CANONICAL_GZIP_BYTES;
}

function assertArtifactPointer(pointer: ReplayArtifactPointer): void {
  if (pointer.kind !== "raw" && pointer.kind !== "canonical") {
    throw new ReplayV2Error(500, "artifact_metadata_invalid", "Replay artifact metadata is invalid.");
  }
  const generationPattern = new RegExp(`^${pointer.kind}_[a-f0-9]{32}$`);
  if (
    !generationPattern.test(pointer.generation) ||
    !/^[a-f0-9]{64}$/.test(pointer.sha256) ||
    !Number.isSafeInteger(pointer.bytes) ||
    pointer.contentType !== "application/gzip"
  ) {
    throw new ReplayV2Error(500, "artifact_metadata_invalid", "Replay artifact metadata is invalid.");
  }
  if (pointer.provider === "vercel-blob") {
    const expected = new RegExp(
      `^replay-v2/${pointer.kind}/rl2_[a-f0-9]{32}/${pointer.generation}-${pointer.sha256}\\.json\\.gz$`,
    );
    if (!expected.test(pointer.pathname)) {
      throw new ReplayV2Error(500, "artifact_metadata_invalid", "Replay artifact path is invalid.");
    }
    return;
  }
  if (
    pointer.provider !== "firestore-chunks" ||
    !new RegExp(`^rl2_[a-f0-9]{32}_${pointer.generation}$`).test(pointer.artifactId) ||
    !Number.isSafeInteger(pointer.chunkCount)
  ) {
    throw new ReplayV2Error(500, "artifact_metadata_invalid", "Replay artifact reference is invalid.");
  }
}

function hasBlobCredentials(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID),
  );
}

function splitText(value: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}
