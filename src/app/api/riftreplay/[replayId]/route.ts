import { gunzipSync } from "node:zlib";

import { NextRequest, NextResponse } from "next/server";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { canonicalIdentityUid } from "@/lib/identity-server";
import { optionalReplayUser } from "@/lib/replay-v2-server";
import { readCompressedPayload } from "@/lib/riftreplay-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ replayId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { replayId } = await context.params;
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(replayId)) {
    return NextResponse.json({ error: "Invalid replay id." }, { status: 400 });
  }

  const db = getFirestoreAdmin();
  if (!db) {
    return NextResponse.json({ error: "Firebase admin is not configured." }, { status: 503 });
  }

  const doc = await db.collection("riftReplays").doc(replayId).get();
  if (!doc.exists) {
    return NextResponse.json({ error: "Replay not found." }, { status: 404 });
  }

  const metadata = doc.data() ?? {};
  const visibility = String(metadata.visibility ?? "private");
  if (visibility === "private") {
    const [viewerUid, ownerUid] = await Promise.all([
      optionalReplayUser(request),
      canonicalIdentityUid(String(metadata.ownerUid ?? ""), db),
    ]);
    if (!viewerUid || !ownerUid || viewerUid !== ownerUid) {
      return NextResponse.json({ error: "Replay is private." }, { status: 403 });
    }
  }

  let compressed = Buffer.alloc(0);
  try {
    compressed = await readCompressedPayload(doc.ref, metadata);
  } catch {
    return NextResponse.json({ error: "Replay payload could not be loaded." }, { status: 500 });
  }
  if (!compressed.length) {
    return NextResponse.json({ error: "Replay payload is missing." }, { status: 404 });
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(gunzipSync(compressed).toString("utf8")) as unknown;
  } catch {
    return NextResponse.json({ error: "Replay payload could not be decoded." }, { status: 500 });
  }

  return NextResponse.json(
    {
      metadata: publicMetadata(metadata),
      payload,
    },
    {
      headers: {
        "Cache-Control": visibility === "public" ? "public, s-maxage=300, stale-while-revalidate=3600" : "no-store",
      },
    },
  );
}

function publicMetadata(metadata: Record<string, unknown>) {
  return {
    replayId: String(metadata.replayId ?? ""),
    title: String(metadata.title ?? "RiftLite Atlas replay"),
    visibility: String(metadata.visibility ?? "private"),
    platform: String(metadata.platform ?? "atlas"),
    roomCode: String(metadata.roomCode ?? ""),
    captureSessionId: String(metadata.captureSessionId ?? ""),
    messageCount: Number(metadata.messageCount ?? 0),
    createdAt: serializeTimestamp(metadata.createdAt),
  };
}

function serializeTimestamp(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  return "";
}
