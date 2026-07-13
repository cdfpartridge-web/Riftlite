import { MAX_RAW_CAPTURE_MESSAGES } from "@/lib/replay-v2";

export const MAX_RAW_JSON_BYTES = 32 * 1024 * 1024;
export const MAX_RAW_GZIP_BYTES = 4 * 1024 * 1024;

export type RawCaptureUploadMetadata = {
  captureId: string;
  messageCount: number;
  capturedAt?: string;
};

export type PreparedReplayUpload = RawCaptureUploadMetadata & {
  bytes: Uint8Array;
  sha256: string;
};

const CAPTURE_ID_MAX_LENGTH = 160;

export function isSupportedReplayFileName(fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase();
  return normalized.endsWith(".json") || normalized.endsWith(".json.gz");
}

export function validateRawCaptureEnvelope(value: unknown): RawCaptureUploadMetadata {
  if (!isRecord(value) || value.schema !== "riftreplay-raw-capture" || value.version !== 1) {
    throw new Error("Choose a RiftLite raw-capture version 1 file.");
  }

  if (!isRecord(value.capture)) {
    throw new Error("The raw capture is missing its capture identity.");
  }

  const captureId = value.capture.captureSessionId;
  if (
    typeof captureId !== "string" ||
    !captureId.trim() ||
    captureId.length > CAPTURE_ID_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(captureId)
  ) {
    throw new Error("The raw capture has an invalid capture identity.");
  }

  if (!Array.isArray(value.messages)) {
    throw new Error("The raw capture is missing its message sequence.");
  }
  if (value.messages.length > MAX_RAW_CAPTURE_MESSAGES) {
    throw new Error("The raw capture contains too many messages.");
  }

  const identity = isRecord(value.capture.identity) ? value.capture.identity : {};
  const capturedAt = normalizedCaptureTimestamp(identity.capturedAt ?? identity.firstSeenAt);
  return {
    captureId: captureId.trim(),
    messageCount: value.messages.length,
    ...(capturedAt ? { capturedAt } : {}),
  };
}

export async function prepareReplayUpload(file: File): Promise<PreparedReplayUpload> {
  if (!isSupportedReplayFileName(file.name)) {
    throw new Error("Choose a .json or .json.gz raw capture.");
  }

  const compressedInput = file.name.trim().toLowerCase().endsWith(".json.gz");
  if (compressedInput && file.size > MAX_RAW_GZIP_BYTES) {
    throw new Error("The compressed raw capture is larger than 4 MB.");
  }
  if (!compressedInput && file.size > MAX_RAW_JSON_BYTES) {
    throw new Error("The raw capture is larger than 32 MB.");
  }

  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  let jsonBytes: Uint8Array;
  let uploadBytes: Uint8Array;

  if (compressedInput) {
    if (!isGzip(sourceBytes)) {
      throw new Error("The selected .json.gz file is not valid gzip data.");
    }
    jsonBytes = await transformGzip(sourceBytes, "decompress", MAX_RAW_JSON_BYTES);
    uploadBytes = sourceBytes;
  } else {
    jsonBytes = sourceBytes;
    uploadBytes = await transformGzip(sourceBytes, "compress", MAX_RAW_GZIP_BYTES);
  }

  const metadata = validateRawCaptureEnvelope(parseUtf8Json(jsonBytes));
  return {
    ...metadata,
    bytes: uploadBytes,
    sha256: await sha256Hex(uploadBytes),
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser cannot verify replay uploads securely.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return bytesToHex(new Uint8Array(digest));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseUtf8Json(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The raw capture is not valid UTF-8 JSON.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("The raw capture contains invalid JSON.");
  }
}

async function transformGzip(
  bytes: Uint8Array,
  direction: "compress" | "decompress",
  maxBytes: number,
): Promise<Uint8Array> {
  const StreamConstructor = direction === "compress" ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (!StreamConstructor) {
    throw new Error("This browser cannot prepare compressed replay uploads.");
  }

  const transformed = new Blob([toArrayBuffer(bytes)])
    .stream()
    .pipeThrough(new StreamConstructor("gzip"));
  const reader = transformed.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      total += chunk.byteLength;
      if (total > maxBytes) {
        throw new Error(
          direction === "compress"
            ? "The compressed raw capture is larger than 4 MB."
            : "The raw capture expands beyond the 32 MB safety limit.",
        );
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function normalizedCaptureTimestamp(value: unknown): string {
  let timestamp: number;
  if (typeof value === "number") {
    timestamp = value;
  } else if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    timestamp = Number.isFinite(numeric) ? numeric : Date.parse(value);
  } else {
    return "";
  }
  if (timestamp > 0 && timestamp < 10_000_000_000) {
    timestamp *= 1_000;
  }
  const date = new Date(timestamp);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : "";
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
