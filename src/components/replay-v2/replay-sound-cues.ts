import {
  createInitialReplayState,
  reduceReplayEvent,
  type CanonicalReplayV2,
  type ReplayEvent,
  type ReplayPhase,
} from "@/lib/replay-v2";

import { replayScoreTimelineMarkers } from "./timeline-score-markers";

export type ReplaySoundKind = "turn-start" | "point-scored";

export type ReplaySoundCue = {
  kind: ReplaySoundKind;
  eventIndex: number;
  atMs: number;
};

const OPENING_PHASES = new Set<ReplayPhase>([
  "matchup", "sideboarding", "battlefield_pick", "initiative_roll", "first_player_choice", "mulligan",
]);

/** Precompute authoritative cues; playback decides whether crossing one is audible. */
export function replaySoundCues(
  replay: Pick<CanonicalReplayV2, "events" | "series">,
): ReplaySoundCue[] {
  const cues = new Map<number, ReplaySoundCue>();
  // Share the timeline's handling of initial scores, corrections and repeated commits.
  for (const marker of replayScoreTimelineMarkers(replay)) {
    cues.set(marker.eventIndex, {
      kind: "point-scored",
      eventIndex: marker.eventIndex,
      atMs: marker.atMs,
    });
  }

  // Only room fields matter for turns. Do not repeatedly clone cards and logs.
  const roomSeries = { ...replay.series, participants: [] };
  let state = createInitialReplayState(roomSeries);
  let gameId: string | null = null;
  let highestTurn: number | undefined;
  let sawOpeningSetup = false;
  let gameEnded = false;

  for (const event of replay.events) {
    if (!event.gameId) continue;
    if (event.gameId !== gameId) {
      state = createInitialReplayState(roomSeries);
      gameId = event.gameId;
      highestTurn = undefined;
      sawOpeningSetup = false;
      gameEnded = false;
    }
    if (event.kind === "game_boundary") {
      if (event.boundary === "end") gameEnded = true;
      continue;
    }
    const projectedEvent = roomProjectionEvent(event);
    if (!projectedEvent || gameEnded) continue;
    state = reduceReplayEvent(state, projectedEvent);
    if (state.phase === "game_end" || state.phase === "series_end") {
      gameEnded = true;
      continue;
    }
    if (highestTurn === undefined && OPENING_PHASES.has(state.phase)) sawOpeningSetup = true;
    const turn = state.room.turnNumber;
    if (state.phase !== "in_game" || typeof turn !== "number" || !Number.isInteger(turn) || turn < 1) continue;
    // A partial capture's first gameplay state establishes a silent baseline.
    // Only an observed opening followed by Turn 1 proves the first turn began.
    const startedTurn = highestTurn === undefined
      ? sawOpeningSetup && turn === 1
      : turn > highestTurn;
    highestTurn = Math.max(highestTurn ?? turn, turn);
    if (startedTurn && !cues.has(event.index)) {
      cues.set(event.index, { kind: "turn-start", eventIndex: event.index, atMs: event.atMs });
    }
  }

  return [...cues.values()].sort((left, right) => left.eventIndex - right.eventIndex);
}

/** Return at most one cue when fast playback crosses several events in a frame. */
export function latestReplaySoundCue(
  cues: readonly ReplaySoundCue[],
  fromExclusiveIndex: number,
  toInclusiveIndex: number,
): ReplaySoundCue | null {
  if (!Number.isFinite(fromExclusiveIndex) || !Number.isFinite(toInclusiveIndex) ||
    toInclusiveIndex <= fromExclusiveIndex) return null;
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cues[middle].eventIndex <= toInclusiveIndex) low = middle + 1;
    else high = middle;
  }
  const cue = cues[low - 1];
  return cue && cue.eventIndex > fromExclusiveIndex ? cue : null;
}

function roomProjectionEvent(event: ReplayEvent): ReplayEvent | null {
  if (event.kind === "phase") return event;
  if (event.kind === "snapshot") {
    return { ...event, snapshot: { room: event.snapshot.room, players: {}, chain: [], log: [] } };
  }
  if (event.kind === "action") {
    const operations = event.patch.operations.filter((operation) => (
      operation.op === "set_room_fields" || operation.op === "unset_room_fields"
    ));
    return operations.length ? { ...event, patch: { ...event.patch, operations } } : null;
  }
  return null;
}
