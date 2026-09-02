import {
  createInitialReplayState,
  reduceReplayEvent,
  type CanonicalReplayV2,
  type ReplayPlayerState,
  type ReplayState,
} from "@/lib/replay-v2";

export const REPLAY_SCORE_TAGS_PREFERENCE_KEY = "riftlite:replay-score-tags:v1";

export type ReplayScoreMarkerSide = "player" | "opponent" | "neutral";

export type ReplayScoreTimelineMarker = {
  atMs: number;
  eventIndex: number;
  gameId: string;
  id: string;
  kind: "score";
  opponentScore?: number;
  playerId: string;
  playerName: string;
  playerScore?: number;
  score: number;
  scoreLabel: string;
  side: ReplayScoreMarkerSide;
};

export type ReplayGameStartTimelineMarker = {
  atMs: number;
  eventIndex: number;
  gameId: string;
  gameNumber: number;
  id: string;
  kind: "game-start";
  tagLabel: string;
};

export type ReplayScoreTimelineTag = ReplayScoreTimelineMarker | ReplayGameStartTimelineMarker;

/**
 * Adds canonical game starts to the same optional timeline layer as score
 * changes, but only for fully corroborated multi-game replays. Later games need
 * an explicit game-number transition, and every game-table entry must form one
 * valid sequence with its indexed start boundary. Any inconsistency fails the
 * complete game-tag set closed rather than showing a plausible partial series.
 */
export function replayGameStartTimelineMarkers(
  replay: Pick<CanonicalReplayV2, "events" | "series">,
): ReplayGameStartTimelineMarker[] {
  if (replay.series.games.length <= 1) return [];

  const seenGameIds = new Set<string>();
  const seenGameNumbers = new Set<number>();
  const markers: ReplayGameStartTimelineMarker[] = [];
  let previousGame: CanonicalReplayV2["series"]["games"][number] | undefined;

  for (const [gameIndex, game] of replay.series.games.entries()) {
    const event = replay.events[game.eventStartIndex];
    if (
      !event ||
      !Number.isInteger(game.eventStartIndex) ||
      game.eventStartIndex < 0 ||
      !Number.isInteger(game.eventEndIndex) ||
      game.eventEndIndex < game.eventStartIndex ||
      game.eventEndIndex >= replay.events.length ||
      event.index !== game.eventStartIndex ||
      event.kind !== "game_boundary" ||
      event.boundary !== "start" ||
      event.gameId !== game.id ||
      event.gameOrdinal !== game.ordinal ||
      event.gameNumber !== game.gameNumber ||
      !Number.isFinite(event.atMs) ||
      event.atMs < 0 ||
      !Number.isInteger(game.ordinal) ||
      game.ordinal !== gameIndex + 1 ||
      !Number.isInteger(game.gameNumber) ||
      game.gameNumber < 1 ||
      event.at !== game.startedAt ||
      event.atMs !== game.startedAtMs ||
      game.endedAt < game.startedAt ||
      game.endedAtMs < game.startedAtMs ||
      seenGameIds.has(game.id) ||
      seenGameNumbers.has(game.gameNumber) ||
      (gameIndex === 0 && event.reason !== "series_start") ||
      (gameIndex > 0 && (
        event.reason !== "explicit_game_number" ||
        !game.sourceIdentity.explicitGameNumber
      )) ||
      (previousGame && (
        game.gameNumber <= previousGame.gameNumber ||
        game.eventStartIndex <= previousGame.eventEndIndex ||
        game.startedAt < previousGame.endedAt ||
        game.startedAtMs < previousGame.endedAtMs
      ))
    ) return [];

    seenGameIds.add(game.id);
    seenGameNumbers.add(game.gameNumber);
    markers.push({
      atMs: event.atMs,
      eventIndex: event.index,
      gameId: game.id,
      gameNumber: game.gameNumber,
      id: `game-start-${game.id}`,
      kind: "game-start",
      tagLabel: `G${game.gameNumber}`,
    });
    previousGame = game;
  }

  return markers;
}

export function replayScoreTimelineTags(
  replay: Pick<CanonicalReplayV2, "events" | "series">,
): ReplayScoreTimelineTag[] {
  return [
    ...replayScoreTimelineMarkers(replay),
    ...replayGameStartTimelineMarkers(replay),
  ].sort((left, right) => left.atMs - right.atMs || left.eventIndex - right.eventIndex);
}

/**
 * Derives score tags only from authoritative, one-player score increases.
 * Initial snapshots establish a baseline, while resets, corrections, and
 * simultaneous changes update projection state without producing a tag.
 */
export function replayScoreTimelineMarkers(
  replay: Pick<CanonicalReplayV2, "events" | "series">,
): ReplayScoreTimelineMarker[] {
  const perspectivePlayerId = replay.series.perspectivePlayerId ??
    replay.series.participants.find((participant) => participant.isPerspective)?.id;
  const opponentPlayerId = perspectivePlayerId
    ? replay.series.participants.find((participant) => participant.id !== perspectivePlayerId)?.id
    : undefined;
  const markers: ReplayScoreTimelineMarker[] = [];
  let state = createInitialReplayState(replay.series);
  let scoreGameId: string | null = null;

  for (const event of replay.events) {
    const enteringGame = Boolean(event.gameId && event.gameId !== scoreGameId);
    const previous = enteringGame || (event.kind === "game_boundary" && event.boundary === "start")
      ? createInitialReplayState(replay.series)
      : state;
    if (!event.gameId && (event.kind === "action" || event.kind === "snapshot")) continue;
    state = reduceReplayEvent(previous, event);
    if (event.gameId) scoreGameId = event.gameId;
    if (!event.gameId || (event.kind !== "action" && event.kind !== "snapshot")) continue;

    const changedScores = scoreChanges(previous, state);
    if (changedScores.length !== 1) continue;
    const change = changedScores[0];
    if (change.next <= change.previous) continue;

    if (event.kind === "snapshot") {
      const introducedScores = Object.values(state.players).filter((player) => (
        playerScore(player) !== undefined &&
        playerScore(previous.players[player.id]) === undefined
      ));
      if (introducedScores.length) continue;
    } else {
      const scorePlayerIds = new Set(event.patch.operations.flatMap((operation) => (
        operation.op === "set_board_fields" && finiteScore(operation.fields.score) !== undefined
          ? [operation.playerId]
          : []
      )));
      if (scorePlayerIds.size !== 1 || !scorePlayerIds.has(change.playerId)) continue;
    }

    const player = state.players[change.playerId];
    const perspectiveScore = perspectivePlayerId
      ? playerScoreForId(state, perspectivePlayerId)
      : undefined;
    const opponentScore = opponentPlayerId
      ? playerScoreForId(state, opponentPlayerId)
      : undefined;
    const side: ReplayScoreMarkerSide = !perspectivePlayerId
      ? "neutral"
      : change.playerId === perspectivePlayerId
        ? "player"
        : change.playerId === opponentPlayerId
          ? "opponent"
          : "neutral";
    if (
      perspectivePlayerId && opponentPlayerId &&
      (perspectiveScore === undefined || opponentScore === undefined)
    ) continue;

    markers.push({
      atMs: event.atMs,
      eventIndex: event.index,
      gameId: event.gameId,
      id: `score-${event.id}-${change.playerId}`,
      kind: "score",
      ...(opponentScore !== undefined ? { opponentScore } : {}),
      playerId: change.playerId,
      playerName: player?.name || participantName(replay, change.playerId),
      ...(perspectiveScore !== undefined ? { playerScore: perspectiveScore } : {}),
      score: change.next,
      scoreLabel: perspectiveScore !== undefined && opponentScore !== undefined
        ? `${perspectiveScore}\u2013${opponentScore}`
        : String(change.next),
      side,
    });
  }

  return markers;
}

function scoreChanges(previous: ReplayState, next: ReplayState) {
  return Object.values(next.players).flatMap((player) => {
    const previousScore = playerScore(previous.players[player.id]);
    const nextScore = playerScore(player);
    if (previousScore === undefined || nextScore === undefined || previousScore === nextScore) return [];
    return [{ next: nextScore, playerId: player.id, previous: previousScore }];
  });
}

function playerScoreForId(state: ReplayState, playerId: string): number | undefined {
  return playerScore(state.players[playerId]);
}

function playerScore(player: ReplayPlayerState | undefined): number | undefined {
  return finiteScore(player?.score) ??
    finiteScore(player?.boardFields.score) ??
    finiteScore(player?.fields.score);
}

function finiteScore(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function participantName(
  replay: Pick<CanonicalReplayV2, "series">,
  playerId: string,
): string {
  return replay.series.participants.find((participant) => participant.id === playerId)?.name || "Player";
}
