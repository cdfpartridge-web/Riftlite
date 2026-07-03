import { gunzipSync } from "node:zlib";

import { NextRequest, NextResponse } from "next/server";

import { getFirestoreAdmin, verifyFirebaseIdToken } from "@/lib/firebase/admin";

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
    const token = bearerToken(request.headers.get("authorization"));
    const decoded = token ? await verifyFirebaseIdToken(token) : null;
    if (!decoded?.uid || decoded.uid !== metadata.ownerUid) {
      return NextResponse.json({ error: "Replay is private." }, { status: 403 });
    }
  }

  const chunkSnap = await doc.ref.collection("chunks").orderBy("index", "asc").get();
  const base64 = chunkSnap.docs.map((chunk) => String(chunk.data().data ?? "")).join("");
  if (!base64) {
    return NextResponse.json({ error: "Replay payload is missing." }, { status: 404 });
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(gunzipSync(Buffer.from(base64, "base64")).toString("utf8")) as unknown;
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

function bearerToken(value: string | null) {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
  return match?.[1]?.trim() ?? "";
}

function serializeTimestamp(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  return "";
}
