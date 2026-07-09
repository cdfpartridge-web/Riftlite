import type { ReplayRecord } from "@/lib/replay-v2-server/model";

export const REPLAY_PROCESSING_LEASE_MS = 90_000;

export function replayProcessingClaimIsActive(
  record: Pick<ReplayRecord, "status" | "processingGeneration" | "updatedAt">,
  nowMs = Date.now(),
): boolean {
  if (record.status !== "processing" || !record.processingGeneration) return false;
  const updatedAtMs = timestampMillis(record.updatedAt);
  if (updatedAtMs === null) return true;
  return nowMs - updatedAtMs < REPLAY_PROCESSING_LEASE_MS;
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.valueOf()) ? value.valueOf() : null;
  if (!value || typeof value !== "object") return null;
  if ("toMillis" in value && typeof value.toMillis === "function") {
    const milliseconds = value.toMillis();
    return typeof milliseconds === "number" && Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if ("toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.valueOf()) ? date.valueOf() : null;
  }
  return null;
}
