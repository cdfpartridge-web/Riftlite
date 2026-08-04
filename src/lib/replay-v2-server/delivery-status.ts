import { REPLAY_PROCESSING_RETRY_AFTER_SECONDS } from "@/lib/replay-v2-server/constants";
import { replayProcessingClaimIsActive } from "@/lib/replay-v2-server/completion-claim";
import {
  normalizeStoredReplayFailure,
  type ReplayFailureDetails,
  type ReplayRecommendedAction,
} from "@/lib/replay-v2-server/errors";
import type { ReplayPublicationWarning, ReplayRecord } from "@/lib/replay-v2-server/model";

export type ReplayDeliveryStage =
  | "failed"
  | "processing"
  | "processing-required"
  | "ready"
  | "source-upload-required";

export type ReplayOwnerDeliveryStatus = {
  schema: "riftlite-replay-delivery-status";
  version: 1;
  replayId: string;
  status: ReplayRecord["status"];
  stage: ReplayDeliveryStage;
  updatedAt: string;
  retryable: boolean;
  recommendedAction: ReplayRecommendedAction;
  retryAfterMs?: number;
  failure?: ReplayFailureDetails;
  warnings: ReplayPublicationWarning[];
};

export function replayOwnerDeliveryStatus(record: ReplayRecord): ReplayOwnerDeliveryStatus {
  const base = {
    schema: "riftlite-replay-delivery-status" as const,
    version: 1 as const,
    replayId: record.replayId,
    status: record.status,
    updatedAt: timestampIso(record.updatedAt),
    warnings: safeWarnings(record.warnings),
  };

  if (record.status === "ready") {
    return { ...base, stage: "ready", retryable: false, recommendedAction: "none" };
  }
  if (record.status === "processing") {
    if (!replayProcessingClaimIsActive(record)) {
      return {
        ...base,
        stage: "processing-required",
        retryable: true,
        recommendedAction: "retry-processing",
      };
    }
    return {
      ...base,
      stage: "processing",
      retryable: true,
      recommendedAction: "wait",
      retryAfterMs: REPLAY_PROCESSING_RETRY_AFTER_SECONDS * 1_000,
    };
  }
  if (record.status === "uploading") {
    return record.rawArtifact
      ? { ...base, stage: "processing-required", retryable: true, recommendedAction: "retry-processing" }
      : { ...base, stage: "source-upload-required", retryable: true, recommendedAction: "upload-source" };
  }

  const failure = normalizeStoredReplayFailure(record.failure);
  return {
    ...base,
    stage: "failed",
    retryable: failure.retryable,
    recommendedAction: failure.recommendedAction,
    failure,
  };
}

function safeWarnings(value: ReplayRecord["warnings"]): ReplayPublicationWarning[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((warning) => {
    const code = typeof warning?.code === "string" ? warning.code.slice(0, 80) : "";
    const message = typeof warning?.message === "string" ? warning.message.slice(0, 300) : "";
    return code && message ? [{ code, message }] : [];
  });
}

function timestampIso(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.valueOf())) return value.toISOString();
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate();
    if (date instanceof Date && Number.isFinite(date.valueOf())) return date.toISOString();
  }
  return "";
}
