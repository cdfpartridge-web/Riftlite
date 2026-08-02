import { projectReplayState } from "@/lib/replay-v2/project-state";
import { replayLegendName } from "@/lib/replay-v2/replay-listing";
import type { CanonicalReplayV2, JsonObject, JsonValue } from "@/lib/replay-v2/types";

export type ReplayPublicationIssueCode =
  | "missing_players"
  | "missing_player_state"
  | "missing_legend"
  | "missing_battlefield"
  | "missing_game_one"
  | "duplicate_game_number"
  | "missing_mulligan"
  | "missing_gameplay";

export type ReplayPublicationIssue = {
  code: ReplayPublicationIssueCode;
  message: string;
};

export type ReplayPublicationQuality = {
  publishable: boolean;
  issues: ReplayPublicationIssue[];
};

const OVERRIDABLE_PUBLICATION_ISSUES = new Set<ReplayPublicationIssueCode>([
  "missing_mulligan",
]);

export function blockingReplayPublicationIssues(
  issues: ReplayPublicationIssue[],
  allowIncomplete: boolean,
): ReplayPublicationIssue[] {
  if (!allowIncomplete) return [...issues];
  return issues.filter((issue) => !OVERRIDABLE_PUBLICATION_ISSUES.has(issue.code));
}

export function assessReplayPublicationQuality(replay: CanonicalReplayV2): ReplayPublicationQuality {
  const issues: ReplayPublicationIssue[] = [];
  const participants = replay.series.participants;
  if (participants.length !== 2) {
    issues.push({
      code: "missing_players",
      message: "The replay did not capture both players.",
    });
  }

  const games = replay.series.games;
  if (!games.length || games[0]?.gameNumber !== 1) {
    issues.push({
      code: "missing_game_one",
      message: "The replay started after Game 1 had already begun or ended.",
    });
  }
  const gameNumbers = games.map((game) => game.gameNumber);
  if (new Set(gameNumbers).size !== gameNumbers.length) {
    issues.push({
      code: "duplicate_game_number",
      message: "The replay contains an ambiguous duplicate game boundary.",
    });
  }
  const phases = new Set(games.flatMap((game) => game.phases.map((phase) => phase.phase)));
  if (!phases.has("mulligan")) {
    issues.push({
      code: "missing_mulligan",
      message: "The replay did not capture the opening mulligan.",
    });
  }
  if (!phases.has("in_game")) {
    issues.push({
      code: "missing_gameplay",
      message: "The replay ended before gameplay was captured.",
    });
  }

  const finalState = replay.checkpoints.at(-1)?.state ?? projectReplayState(replay);
  for (const participant of participants.slice(0, 2)) {
    const player = finalState.players[participant.id];
    if (!player) {
      issues.push({
        code: "missing_player_state",
        message: `${participant.name || "A player"} has no captured board state.`,
      });
      continue;
    }
    if (!replayLegendName(player, "")) {
      issues.push({
        code: "missing_legend",
        message: `${participant.name || "A player"} has no captured legend card.`,
      });
    }
    if (!selectedBattlefieldName(participant.fields, player.fields, player.boardFields)) {
      issues.push({
        code: "missing_battlefield",
        message: `${participant.name || "A player"} has no captured battlefield selection.`,
      });
    }
  }

  return { publishable: issues.length === 0, issues };
}

function selectedBattlefieldName(...sources: JsonObject[]): string {
  for (const source of sources) {
    for (const key of ["selectedBattlefield", "selectedBattlefieldName", "battlefield", "battlefieldName"]) {
      const label = jsonLabel(source[key]);
      if (label) return label;
    }
  }
  return "";
}

function jsonLabel(value: JsonValue | undefined): string {
  if (typeof value === "string") return value.trim();
  if (!value || Array.isArray(value) || typeof value !== "object") return "";
  for (const key of ["name", "cardName", "title"]) {
    const label = value[key];
    if (typeof label === "string" && label.trim()) return label.trim();
  }
  return "";
}
