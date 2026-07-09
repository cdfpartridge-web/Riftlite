import { cloneReplayState, createInitialReplayState, reduceReplayEvent } from "@/lib/replay-v2/project-state";
import type { CanonicalReplayV2, ReplayCheckpoint, ReplaySeekResult } from "@/lib/replay-v2/types";

export function seekReplay(replay: CanonicalReplayV2, targetMs: number): ReplaySeekResult {
  const normalizedTarget = Number.isFinite(targetMs) ? Math.max(0, targetMs) : 0;
  const eventIndex = eventIndexAtTime(replay, normalizedTarget);
  const result = seekReplayByEventIndex(replay, eventIndex);
  return { ...result, targetMs: normalizedTarget };
}

export function seekReplayByEventIndex(
  replay: CanonicalReplayV2,
  requestedEventIndex: number,
): ReplaySeekResult {
  const eventIndex = Math.min(
    Math.max(-1, Number.isFinite(requestedEventIndex) ? Math.trunc(requestedEventIndex) : -1),
    replay.events.length - 1,
  );
  const checkpoint = checkpointAtOrBefore(replay.checkpoints, eventIndex);
  let state = checkpoint
    ? cloneReplayState(checkpoint.state)
    : createInitialReplayState(replay.series);
  const checkpointEventIndex = checkpoint?.eventIndex ?? -1;
  for (let index = checkpointEventIndex + 1; index <= eventIndex; index += 1) {
    state = reduceReplayEvent(state, replay.events[index]);
  }
  return {
    targetMs: eventIndex >= 0 ? replay.events[eventIndex].atMs : 0,
    eventIndex,
    checkpointEventIndex,
    state,
  };
}

export function seekToGameStart(replay: CanonicalReplayV2, gameOrdinal: number): ReplaySeekResult {
  const game = replay.series.games.find((candidate) => candidate.ordinal === gameOrdinal);
  if (!game) return seekReplayByEventIndex(replay, -1);
  return seekReplayByEventIndex(replay, game.eventStartIndex);
}

export function eventIndexAtTime(
  replay: Pick<CanonicalReplayV2, "events">,
  targetMs: number,
): number {
  let low = 0;
  let high = replay.events.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (replay.events[middle].atMs <= targetMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
function checkpointAtOrBefore(checkpoints: ReplayCheckpoint[], eventIndex: number) {
  let low = 0;
  let high = checkpoints.length - 1;
  let found: ReplayCheckpoint | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const checkpoint = checkpoints[middle];
    if (checkpoint.eventIndex <= eventIndex) {
      found = checkpoint;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
