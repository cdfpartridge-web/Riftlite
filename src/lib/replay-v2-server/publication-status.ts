import type { ReplayPublicationIssue } from "@/lib/replay-v2/replay-quality";
import { REPLAY_CAPTURE_MISSING_MULLIGAN_CODE } from "@/lib/replay-v2-server/constants";
import type { ReplayPublicationWarning } from "@/lib/replay-v2-server/model";

export function replayPublicationFailureCode(issues: ReplayPublicationIssue[]): string {
  return issues.length === 1 && issues[0]?.code === "missing_mulligan"
    ? REPLAY_CAPTURE_MISSING_MULLIGAN_CODE
    : "replay_capture_incomplete";
}

export function replayPublicationWarnings(
  issues: ReplayPublicationIssue[],
): ReplayPublicationWarning[] {
  return issues.map((issue) => ({
    code: issue.code === "missing_mulligan"
      ? REPLAY_CAPTURE_MISSING_MULLIGAN_CODE
      : `replay_capture_${issue.code}`,
    message: issue.message,
  }));
}
