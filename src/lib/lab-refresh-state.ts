import "server-only";

import type { Firestore } from "firebase-admin/firestore";

export const LAB_REFRESH_STATE_VERSION = 1;

export type LabFactCorpusWatermark = {
  documentCount: number;
  latestDocumentId: string | null;
  latestUpdatedAt: string | null;
};

export type LabRefreshState = {
  version: typeof LAB_REFRESH_STATE_VERSION;
  completedOn: string;
  configFingerprint: string;
  factWatermark: LabFactCorpusWatermark;
};

/**
 * A count aggregate plus one newest-document query is a bounded preflight for
 * a fact collection of any size. Daily lab refreshes can therefore prove that
 * the source is unchanged without downloading every fact again.
 */
export async function readLabFactCorpusWatermark(
  db: Firestore,
  collectionName: string,
): Promise<LabFactCorpusWatermark> {
  const collection = db.collection(collectionName);
  const [countSnapshot, latestSnapshot] = await Promise.all([
    collection.count().get(),
    collection.orderBy("updatedAt", "desc").limit(1).get(),
  ]);
  const latest = latestSnapshot.docs[0];
  const count = Number(countSnapshot.data().count);
  return {
    documentCount: Number.isSafeInteger(count) && count >= 0 ? count : 0,
    latestDocumentId: latest?.id ?? null,
    latestUpdatedAt: latest ? timestampFingerprint(latest.data()?.updatedAt) : null,
  };
}

export function labRefreshState(
  completedAt: Date,
  configFingerprint: string,
  factWatermark: LabFactCorpusWatermark,
): LabRefreshState {
  return {
    version: LAB_REFRESH_STATE_VERSION,
    completedOn: utcDay(completedAt),
    configFingerprint,
    factWatermark,
  };
}

export function canSkipLabRefresh(
  value: unknown,
  now: Date,
  configFingerprint: string,
  factWatermark: LabFactCorpusWatermark,
): boolean {
  const state = parseLabRefreshState(value);
  return state !== null &&
    state.completedOn === utcDay(now) &&
    state.configFingerprint === configFingerprint &&
    sameLabFactCorpusWatermark(state.factWatermark, factWatermark);
}

export function sameLabFactCorpusWatermark(
  left: LabFactCorpusWatermark | null,
  right: LabFactCorpusWatermark | null,
): boolean {
  return left !== null && right !== null &&
    left.documentCount === right.documentCount &&
    left.latestDocumentId === right.latestDocumentId &&
    left.latestUpdatedAt === right.latestUpdatedAt;
}

function parseLabRefreshState(value: unknown): LabRefreshState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = value as Partial<LabRefreshState>;
  const watermark = parseWatermark(state.factWatermark);
  if (
    state.version !== LAB_REFRESH_STATE_VERSION ||
    typeof state.completedOn !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(state.completedOn) ||
    typeof state.configFingerprint !== "string" ||
    !state.configFingerprint ||
    !watermark
  ) return null;
  return {
    version: LAB_REFRESH_STATE_VERSION,
    completedOn: state.completedOn,
    configFingerprint: state.configFingerprint,
    factWatermark: watermark,
  };
}

function parseWatermark(value: unknown): LabFactCorpusWatermark | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const watermark = value as Partial<LabFactCorpusWatermark>;
  if (
    !Number.isSafeInteger(watermark.documentCount) ||
    Number(watermark.documentCount) < 0 ||
    (watermark.latestDocumentId !== null && typeof watermark.latestDocumentId !== "string") ||
    (watermark.latestUpdatedAt !== null && typeof watermark.latestUpdatedAt !== "string")
  ) return null;
  return {
    documentCount: Number(watermark.documentCount),
    latestDocumentId: watermark.latestDocumentId ?? null,
    latestUpdatedAt: watermark.latestUpdatedAt ?? null,
  };
}

function timestampFingerprint(value: unknown): string | null {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    return Number.isFinite(milliseconds) ? `ms:${milliseconds}` : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return `ms:${value}`;
  if (typeof value === "string" && value) return `string:${value}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const timestamp = value as {
    seconds?: unknown;
    nanoseconds?: unknown;
    _seconds?: unknown;
    _nanoseconds?: unknown;
    toMillis?: unknown;
  };
  const seconds = Number(timestamp.seconds ?? timestamp._seconds);
  const nanoseconds = Number(timestamp.nanoseconds ?? timestamp._nanoseconds);
  if (Number.isSafeInteger(seconds) && Number.isInteger(nanoseconds)) {
    return `ts:${seconds}:${nanoseconds}`;
  }
  if (typeof timestamp.toMillis === "function") {
    const milliseconds = Number((timestamp.toMillis as () => number)());
    return Number.isFinite(milliseconds) ? `ms:${milliseconds}` : null;
  }
  return null;
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}
