import { type NextRequest } from "next/server";

import { requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CLOUD_SYNC_DOC_ID = "default";
const CLOUD_SYNC_FORMAT = "riftlite.cloud-sync";
const CHUNK_SIZE = 700_000;
const MAX_ENCODED_BYTES = 12_000_000;
const MAX_CHUNKS = 24;

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const includePayload = req.nextUrl.searchParams.get("includePayload") === "1";
  const ref = auth.db.collection("users").doc(auth.decoded.uid).collection("cloudSync").doc(CLOUD_SYNC_DOC_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    return socialJson({ ok: true, exists: false });
  }

  const data = snap.data() ?? {};
  const summary = manifestSummary(data);
  if (!includePayload) {
    return socialJson({ ok: true, exists: true, summary });
  }

  const chunksSnap = await ref.collection("chunks").orderBy("index", "asc").get();
  const encoded = chunksSnap.docs.map((doc) => String(doc.get("encoded") ?? "")).join("");
  if (!encoded) {
    return socialJson({ error: "Cloud sync payload is missing." }, 500);
  }
  return socialJson({ ok: true, exists: true, summary, encoded });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const body = await readBody(req);
  if (body.format !== CLOUD_SYNC_FORMAT || Number(body.version) !== 1) {
    return socialJson({ error: "Unsupported cloud sync format." }, 400);
  }

  const encoded = String(body.encoded ?? "").trim();
  if (!encoded) {
    return socialJson({ error: "Missing cloud sync payload." }, 400);
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(encoded)) {
    return socialJson({ error: "Cloud sync payload must be base64 encoded." }, 400);
  }
  if (encoded.length > MAX_ENCODED_BYTES) {
    return socialJson({ error: "Cloud sync backup is too large. Export a manual backup instead." }, 413);
  }

  const chunks = chunkString(encoded, CHUNK_SIZE);
  if (chunks.length > MAX_CHUNKS) {
    return socialJson({ error: "Cloud sync backup needs too many chunks. Export a manual backup instead." }, 413);
  }

  const summary = safeSummary(body.summary);
  const now = Date.now();
  const ref = auth.db.collection("users").doc(auth.decoded.uid).collection("cloudSync").doc(CLOUD_SYNC_DOC_ID);
  const oldChunks = await ref.collection("chunks").listDocuments();
  const batch = auth.db.batch();
  oldChunks.forEach((doc) => batch.delete(doc));
  chunks.forEach((chunk, index) => {
    batch.set(ref.collection("chunks").doc(String(index).padStart(3, "0")), {
      index,
      encoded: chunk,
      updatedAt: now,
    });
  });
  batch.set(ref, {
    format: CLOUD_SYNC_FORMAT,
    version: 1,
    ownerUid: auth.decoded.uid,
    updatedAt: summary.updatedAt || new Date(now).toISOString(),
    appVersion: summary.appVersion,
    deviceLabel: summary.deviceLabel,
    matches: summary.matches,
    deletedMatches: summary.deletedMatches,
    decks: summary.decks,
    notebooks: summary.notebooks,
    settingsIncluded: summary.settingsIncluded,
    encodedBytes: encoded.length,
    chunkCount: chunks.length,
    serverUpdatedAt: now,
  }, { merge: true });
  await batch.commit();

  return socialJson({
    ok: true,
    exists: true,
    summary: {
      ...summary,
      encodedBytes: encoded.length,
      chunkCount: chunks.length,
    },
  });
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function manifestSummary(data: Record<string, unknown>) {
  return {
    updatedAt: String(data.updatedAt ?? ""),
    appVersion: String(data.appVersion ?? ""),
    deviceLabel: String(data.deviceLabel ?? ""),
    matches: readInt(data.matches),
    deletedMatches: readInt(data.deletedMatches),
    decks: readInt(data.decks),
    notebooks: readInt(data.notebooks),
    settingsIncluded: Boolean(data.settingsIncluded),
    encodedBytes: readInt(data.encodedBytes),
    chunkCount: readInt(data.chunkCount),
  };
}

function safeSummary(value: unknown) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()).slice(0, 40),
    appVersion: String(raw.appVersion ?? "").slice(0, 32),
    deviceLabel: String(raw.deviceLabel ?? "RiftLite desktop").slice(0, 80),
    matches: readInt(raw.matches),
    deletedMatches: readInt(raw.deletedMatches),
    decks: readInt(raw.decks),
    notebooks: readInt(raw.notebooks),
    settingsIncluded: Boolean(raw.settingsIncluded),
  };
}

function readInt(value: unknown): number {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? Math.floor(next) : 0;
}

function chunkString(value: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}
