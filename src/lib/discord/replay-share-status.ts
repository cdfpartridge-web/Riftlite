export type ReplayDiscordConfigShareStatus =
  | "shared"
  | "already-shared"
  | "in-progress"
  | "hub-unavailable"
  | "failed";

export type ReplayDiscordHubShareStatus =
  | "shared"
  | "already-shared"
  | "in-progress"
  | "not-member"
  | "not-configured"
  | "failed";

export function aggregateReplayDiscordConfigResults(
  results: readonly ReplayDiscordConfigShareStatus[],
): ReplayDiscordHubShareStatus {
  if (!results.length) return "not-configured";
  if (results.includes("failed")) return "failed";
  if (results.includes("hub-unavailable")) return "not-member";

  // A hub is delivered only after every configured guild has reached a
  // terminal posted state. A fresh post in one guild must not hide another
  // guild's live claim, otherwise the desktop will stop retrying too early.
  if (results.includes("in-progress")) return "in-progress";
  return results.includes("shared") ? "shared" : "already-shared";
}
