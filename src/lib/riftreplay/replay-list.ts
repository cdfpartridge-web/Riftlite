import type { DocumentData, Query, QueryDocumentSnapshot } from "firebase-admin/firestore";

import { getFirestoreAdmin } from "@/lib/firebase/admin";

export type RiftReplayListItem = {
  replayId: string;
  title: string;
  platform: string;
  visibility: string;
  roomCode: string;
  localReplayId: string;
  matchId: string;
  messageCount: number;
  compressedBytes: number;
  createdAt: string;
  createdAtMs: number;
  path: string;
};

type ListOptions = {
  limit?: number;
  ownerUid?: string;
};

export async function listRiftLiteReplays(options: ListOptions = {}): Promise<RiftReplayListItem[]> {
  const db = getFirestoreAdmin();
  if (!db) {
    return [];
  }

  const limit = Math.max(1, Math.min(options.limit ?? 96, 200));
  let query: Query<DocumentData> = db.collection("riftReplays");
  if (options.ownerUid) {
    query = query.where("ownerUid", "==", options.ownerUid);
  } else {
    query = query.where("visibility", "==", "public");
  }

  const snapshot = await query.limit(limit).get();
  return snapshot.docs
    .map((doc) => replayListItemFromDoc(doc))
    .filter((item): item is RiftReplayListItem => Boolean(item))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function replayListItemFromDoc(doc: QueryDocumentSnapshot<DocumentData>): RiftReplayListItem | null {
  const data = doc.data() ?? {};
  const replayId = stringValue(data.replayId) || doc.id;
  if (!replayId) {
    return null;
  }
  const created = serializeTimestamp(data.createdAt);
  return {
    replayId,
    title: stringValue(data.title) || "RiftLite Atlas replay",
    platform: stringValue(data.platform) || "atlas",
    visibility: stringValue(data.visibility) || "private",
    roomCode: stringValue(data.roomCode),
    localReplayId: stringValue(data.localReplayId),
    matchId: stringValue(data.matchId),
    messageCount: numberValue(data.messageCount),
    compressedBytes: numberValue(data.compressedBytes),
    createdAt: created.iso,
    createdAtMs: created.ms,
    path: stringValue(data.canonicalPath) || `/replay/${encodeURIComponent(replayId)}`,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function serializeTimestamp(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate() as Date;
    return { iso: date.toISOString(), ms: date.getTime() };
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return { iso: Number.isFinite(ms) ? new Date(ms).toISOString() : "", ms: Number.isFinite(ms) ? ms : 0 };
  }
  return { iso: "", ms: 0 };
}
