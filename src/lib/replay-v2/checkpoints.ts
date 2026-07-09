import { cloneReplayState, createInitialReplayState, reduceReplayEvent } from "@/lib/replay-v2/project-state";
import { stableDigest, stableId } from "@/lib/replay-v2/stable-id";
import type { CanonicalReplayV2, ReplayCheckpoint, ReplayState } from "@/lib/replay-v2/types";

export type ReplayCheckpointOptions = {
  everyEvents?: number;
  includePhaseBoundaries?: boolean;
  includeSnapshots?: boolean;
};

export function buildReplayCheckpoints(
  replay: Pick<CanonicalReplayV2, "id" | "series" | "events">,
  options: ReplayCheckpointOptions = {},
): ReplayCheckpoint[] {
  const everyEvents = Math.max(1, Math.trunc(options.everyEvents ?? 40));
  const includePhaseBoundaries = options.includePhaseBoundaries ?? true;
  const includeSnapshots = options.includeSnapshots ?? true;
  const checkpoints: ReplayCheckpoint[] = [];
  let state = createInitialReplayState(replay.series);
  checkpoints.push(checkpointFromState(replay.id, -1, 0, state));

  replay.events.forEach((event, index) => {
    state = reduceReplayEvent(state, event);
    const cadence = (index + 1) % everyEvents === 0;
    const boundary = includePhaseBoundaries && (event.kind === "phase" || event.kind === "game_boundary");
    const snapshot = includeSnapshots && event.kind === "snapshot";
    const last = index === replay.events.length - 1;
    if (cadence || boundary || snapshot || last) {
      const existing = checkpoints.at(-1);
      if (existing?.eventIndex === index) {
        existing.atMs = event.atMs;
        existing.state = cloneReplayState(state);
        existing.stateHash = stableDigest(existing.state);
      } else {
        checkpoints.push(checkpointFromState(replay.id, index, event.atMs, state));
      }
    }
  });

  return checkpoints;
}

function checkpointFromState(
  replayId: string,
  eventIndex: number,
  atMs: number,
  state: ReplayState,
): ReplayCheckpoint {
  const cloned = cloneReplayState(state);
  return {
    id: stableId("checkpoint", replayId, eventIndex, atMs),
    eventIndex,
    atMs,
    stateHash: stableDigest(cloned),
    state: cloned,
  };
}
