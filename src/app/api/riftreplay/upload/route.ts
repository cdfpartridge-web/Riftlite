import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { replayApiError, requireReplayUser } from "@/lib/replay-v2-server";
import { storeCompressedPayload } from "@/lib/riftreplay-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_COMPRESSED_BYTES = 4 * 1024 * 1024;
const MAX_RAW_BYTES = 14 * 1024 * 1024;

const VisibilitySchema = z.enum(["private", "unlisted", "public"]).default("unlisted");

const UploadSchema = z.object({
  payloadGzipBase64: z.string().trim().min(20).max(Math.ceil(MAX_COMPRESSED_BYTES * 1.38)),
  visibility: VisibilitySchema.optional(),
  metadata: z
    .object({
      localReplayId: z.string().trim().max(160).optional(),
      title: z.string().trim().max(180).optional(),
      platform: z.string().trim().max(40).optional(),
      matchId: z.string().trim().max(160).optional(),
      roomCode: z.string().trim().max(80).optional(),
      captureSessionId: z.string().trim().max(160).optional(),
      messageCount: z.number().int().min(0).max(200_000).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  let ownerUid = "";
  try {
    ownerUid = await requireReplayUser(request);
  } catch (error) {
    return replayApiError(error);
  }

  const db = getFirestoreAdmin();
  if (!db) {
    return NextResponse.json({ error: "Firebase admin is not configured." }, { status: 503 });
  }

  const parsed = UploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Replay upload payload is invalid." }, { status: 400 });
  }

  const compressed = Buffer.from(parsed.data.payloadGzipBase64, "base64");
  if (!compressed.length || compressed.length > MAX_COMPRESSED_BYTES) {
    return NextResponse.json({ error: "Replay upload is too large." }, { status: 413 });
  }

  let rawText = "";
  let payload: unknown = null;
  try {
    rawText = gunzipSync(compressed).toString("utf8");
    if (Buffer.byteLength(rawText, "utf8") > MAX_RAW_BYTES) {
      return NextResponse.json({ error: "Replay raw payload is too large." }, { status: 413 });
    }
    payload = JSON.parse(rawText) as unknown;
  } catch {
    return NextResponse.json({ error: "Replay upload must be gzipped JSON." }, { status: 400 });
  }

  const root = isRecord(payload) ? payload : {};
  const replayId = `rlr_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const visibility = parsed.data.visibility ?? "unlisted";
  const metadata = parsed.data.metadata ?? {};
  const messageCount = metadata.messageCount ?? (Array.isArray(root.messages) ? root.messages.length : 0);
  const capture = isRecord(root.capture) ? root.capture : {};
  const identity = isRecord(capture.identity) ? capture.identity : {};

  const storage = await storeCompressedPayload(replayId, compressed, parsed.data.payloadGzipBase64);
  const docRef = db.collection("riftReplays").doc(replayId);
  const batch = db.batch();
  batch.set(docRef, {
    replayId,
    ownerUid,
    visibility,
    title: metadata.title || titleFromPayload(root) || "RiftLite Atlas replay",
    platform: metadata.platform || "atlas",
    localReplayId: metadata.localReplayId || "",
    matchId: metadata.matchId || "",
    roomCode: metadata.roomCode || stringValue(identity.roomCode),
    captureSessionId: metadata.captureSessionId || stringValue(capture.captureSessionId),
    messageCount,
    storageProvider: storage.provider,
    blobUrl: storage.blobUrl,
    blobPath: storage.blobPath,
    chunkCount: storage.chunks.length,
    compressedBytes: compressed.length,
    rawBytes: Buffer.byteLength(rawText, "utf8"),
    schema: stringValue(root.schema),
    version: numberValue(root.version) ?? null,
    canonicalPath: `/replay/${replayId}`,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  storage.chunks.forEach((chunk, index) => {
    batch.set(docRef.collection("chunks").doc(index.toString().padStart(4, "0")), {
      index,
      data: chunk,
    });
  });
  await batch.commit();

  const origin = request.headers.get("origin") || "https://www.riftlite.com";
  return NextResponse.json(
    {
      replayId,
      visibility,
      url: `${origin.replace(/\/$/, "")}/replay/${encodeURIComponent(replayId)}`,
      libraryUrl: `${origin.replace(/\/$/, "")}/replays`,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function titleFromPayload(root: Record<string, unknown>) {
  const title = stringValue(root.title);
  if (title) return title;
  const capture = isRecord(root.capture) ? root.capture : {};
  const identity = isRecord(capture.identity) ? capture.identity : {};
  const roomCode = stringValue(identity.roomCode);
  return roomCode ? `Room ${roomCode}` : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
