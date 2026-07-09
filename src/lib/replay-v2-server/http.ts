import { ReplayV2Error } from "@/lib/replay-v2-server/errors";

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readBoundedBytes(request, maxBytes);
  if (!bytes.length) {
    throw new ReplayV2Error(400, "empty_body", "A JSON request body is required.");
  }
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new ReplayV2Error(400, "invalid_json", "Request body must be valid JSON.");
  }
}

export async function readBoundedBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new ReplayV2Error(400, "invalid_content_length", "Content-Length is invalid.");
    }
    if (parsedLength > maxBytes) {
      throw new ReplayV2Error(413, "body_too_large", "Request body is too large.");
    }
  }

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ReplayV2Error(413, "body_too_large", "Request body is too large.");
    }
    chunks.push(value);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function requireGzipContentType(request: Request): void {
  const contentType = (request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/gzip" && contentType !== "application/octet-stream") {
    throw new ReplayV2Error(415, "unsupported_media_type", "Replay uploads must be gzip binary data.");
  }
  const contentEncoding = (request.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
  if (contentEncoding !== "identity") {
    throw new ReplayV2Error(
      415,
      "unsupported_content_encoding",
      "Send the gzip file as the request body without HTTP content encoding.",
    );
  }
}

export function requiredUploadDeclaration(request: Request): { sha256: string; bytes: number } {
  const sha256 = (request.headers.get("x-replay-sha256") ?? "").trim().toLowerCase();
  const bytes = Number(request.headers.get("x-replay-bytes") ?? "");
  if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(bytes) || bytes < 1) {
    throw new ReplayV2Error(
      400,
      "missing_upload_declaration",
      "X-Replay-SHA256 and X-Replay-Bytes headers are required.",
    );
  }
  return { sha256, bytes };
}
