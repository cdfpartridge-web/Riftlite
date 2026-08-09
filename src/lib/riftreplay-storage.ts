import { get, put } from "@vercel/blob";
import type { DocumentData, DocumentReference } from "firebase-admin/firestore";

const CHUNK_CHAR_SIZE = 650_000;

export async function readCompressedPayload(
  docRef: DocumentReference<DocumentData>,
  metadata: Record<string, unknown>,
) {
  const blobUrl = String(metadata.blobUrl ?? "");
  const blobPath = String(metadata.blobPath ?? "");
  if (metadata.storageProvider === "vercel-blob-private" && blobPath) {
    const result = await get(blobPath, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new Error("Private replay blob could not be read.");
    }
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  if (metadata.storageProvider === "vercel-blob" && blobUrl) {
    const response = await fetch(blobUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Replay blob fetch failed: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  const chunkSnap = await docRef.collection("chunks").orderBy("index", "asc").get();
  const base64 = chunkSnap.docs.map((chunk) => String(chunk.data().data ?? "")).join("");
  return base64 ? Buffer.from(base64, "base64") : Buffer.alloc(0);
}

export async function storeCompressedPayload(
  replayId: string,
  compressed: Buffer,
  payloadGzipBase64: string,
) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blob = await put(`replays/${replayId}.json.gz`, compressed, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/gzip",
      });
      return {
        provider: "vercel-blob-private",
        blobUrl: "",
        blobPath: "pathname" in blob ? String(blob.pathname) : `replays/${replayId}.json.gz`,
        chunks: [] as string[],
      };
    } catch {
      // Firestore chunks remain the safe fallback when Blob is not available on an environment.
    }
  }
  return {
    provider: "firestore-chunks",
    blobUrl: "",
    blobPath: "",
    chunks: splitIntoChunks(payloadGzipBase64, CHUNK_CHAR_SIZE),
  };
}

function splitIntoChunks(value: string, size: number) {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}
