import {
  REPLAY_CAPTURE_MISSING_MULLIGAN_CODE,
  REPLAY_PROCESSING_RETRY_AFTER_SECONDS,
  REPLAY_PROCESSING_RETRY_STATUS,
} from "@/lib/replay-v2-server/constants";

export type ReplayFailureClass =
  | "authentication"
  | "authorization"
  | "capture"
  | "conflict"
  | "processing"
  | "request"
  | "service"
  | "upload";

export type ReplayRecommendedAction =
  | "check-permission"
  | "contact-support"
  | "none"
  | "reconnect-account"
  | "retry-later"
  | "retry-processing"
  | "review-capture"
  | "upload-incomplete"
  | "upload-source"
  | "wait";

export type ReplayFailureDetails = {
  code: string;
  message: string;
  class: ReplayFailureClass;
  retryable: boolean;
  recommendedAction: ReplayRecommendedAction;
};

export type ReplayApiProblem = ReplayFailureDetails & {
  status: number;
  retryAfterMs?: number;
};

const REPLAY_FAILURE_CLASSES = new Set<ReplayFailureClass>([
  "authentication",
  "authorization",
  "capture",
  "conflict",
  "processing",
  "request",
  "service",
  "upload",
]);

const REPLAY_RECOMMENDED_ACTIONS = new Set<ReplayRecommendedAction>([
  "check-permission",
  "contact-support",
  "none",
  "reconnect-account",
  "retry-later",
  "retry-processing",
  "review-capture",
  "upload-incomplete",
  "upload-source",
  "wait",
]);

export class ReplayV2Error extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ReplayV2Error";
    this.status = status;
    this.code = code;
  }
}

export function replayFailure(error: unknown): ReplayFailureDetails {
  if (!(error instanceof ReplayV2Error)) {
    return failureDetails(replayProblemDetails(
      500,
      "processing_failed",
      "Replay processing failed.",
    ));
  }
  const problem = replayApiProblem(error);
  return failureDetails(problem);
}

/**
 * Firestore contains both legacy two-field failures and the structured
 * recovery contract. Preserve validated structured guidance verbatim so a
 * list/status round trip cannot turn a non-retryable failure into a retry
 * loop, while retaining deterministic inference for older records.
 */
export function normalizeStoredReplayFailure(value: unknown): ReplayFailureDetails {
  const failure = isRecord(value) ? value : {};
  const code = boundedString(failure.code, 80) || "processing_failed";
  const message = boundedString(failure.message, 300) || "Replay processing failed.";
  const failureClass = failure.class;
  const retryable = failure.retryable;
  const recommendedAction = failure.recommendedAction;
  if (
    typeof failureClass === "string" &&
    REPLAY_FAILURE_CLASSES.has(failureClass as ReplayFailureClass) &&
    typeof retryable === "boolean" &&
    typeof recommendedAction === "string" &&
    REPLAY_RECOMMENDED_ACTIONS.has(recommendedAction as ReplayRecommendedAction)
  ) {
    return {
      code,
      message,
      class: failureClass as ReplayFailureClass,
      retryable,
      recommendedAction: recommendedAction as ReplayRecommendedAction,
    };
  }
  return failureDetails(replayProblemDetails(legacyFailureStatus(code), code, message));
}

export function replayApiProblem(error: unknown): ReplayApiProblem {
  if (error instanceof ReplayV2Error) {
    return replayProblemDetails(error.status, error.code, error.message);
  }
  return replayProblemDetails(500, "internal_error", "Replay request failed.");
}

export function replayProblemDetails(status: number, code: string, message: string): ReplayApiProblem {
  const safeCode = code.slice(0, 80) || "internal_error";
  const safeMessage = message.slice(0, 300) || "Replay request failed.";

  if (
    status === REPLAY_PROCESSING_RETRY_STATUS ||
    safeCode === "replay_processing" ||
    safeCode === "processing_superseded"
  ) {
    return {
      status,
      code: safeCode,
      message: safeMessage,
      class: "processing",
      retryable: true,
      recommendedAction: "wait",
      retryAfterMs: REPLAY_PROCESSING_RETRY_AFTER_SECONDS * 1_000,
    };
  }
  if (safeCode === "processing_failed") {
    return problem(status, safeCode, safeMessage, "processing", true, "retry-processing");
  }
  if (safeCode === "raw_upload_required") {
    return problem(status, safeCode, safeMessage, "upload", true, "upload-source");
  }
  if (safeCode === REPLAY_CAPTURE_MISSING_MULLIGAN_CODE) {
    return problem(status, safeCode, safeMessage, "capture", false, "upload-incomplete");
  }
  if (
    safeCode.startsWith("replay_capture_") ||
    safeCode.startsWith("raw_capture_") ||
    safeCode === "canonical_too_large" ||
    safeCode === "body_too_large" ||
    safeCode === "upload_checksum_mismatch"
  ) {
    return problem(status, safeCode, safeMessage, "capture", false, "review-capture");
  }
  if (status === 401) {
    return problem(status, safeCode, safeMessage, "authentication", false, "reconnect-account");
  }
  if (status === 403) {
    return problem(status, safeCode, safeMessage, "authorization", false, "check-permission");
  }
  if (safeCode.includes("upload") && status < 500) {
    return problem(status, safeCode, safeMessage, "upload", status === 408 || status === 429, status === 408 || status === 429 ? "retry-later" : "contact-support");
  }
  if (status === 409) {
    return problem(status, safeCode, safeMessage, "conflict", false, "contact-support");
  }
  if (status === 408 || status === 429 || status >= 500) {
    return problem(status, safeCode, safeMessage, "service", true, "retry-later");
  }
  return problem(status, safeCode, safeMessage, "request", false, "contact-support");
}

function problem(
  status: number,
  code: string,
  message: string,
  failureClass: ReplayFailureClass,
  retryable: boolean,
  recommendedAction: ReplayRecommendedAction,
): ReplayApiProblem {
  return { status, code, message, class: failureClass, retryable, recommendedAction };
}

function failureDetails(problemDetails: ReplayApiProblem): ReplayFailureDetails {
  return {
    code: problemDetails.code,
    message: problemDetails.message,
    class: problemDetails.class,
    retryable: problemDetails.retryable,
    recommendedAction: problemDetails.recommendedAction,
  };
}

function legacyFailureStatus(code: string): number {
  if (
    code.startsWith("replay_capture_") ||
    code.startsWith("raw_capture_") ||
    code === "capture_id_mismatch" ||
    code === "normalization_failed" ||
    code === "unsupported_replay_provider" ||
    code === "upload_checksum_mismatch"
  ) return 422;
  if (code === "canonical_too_large" || code === "artifact_too_large") return 413;
  return 500;
}

function boundedString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
