import {
  cloneReplayState,
  createInitialReplayState,
  reduceReplayEvent,
  resetGameScopedBattlefieldSelections,
} from "@/lib/replay-v2/project-state";
import type { CanonicalReplayV2, ReplayCheckpoint, ReplaySeekResult } from "@/lib/replay-v2/types";

const PLAYER_BATTLEFIELD_SELECTION_FIELDS = ["selectedBattlefield", "battlefieldCard", "battlefield"] as const;
const ROOM_BATTLEFIELD_SELECTION_FIELDS = ["selectedBattlefields", "battlefieldCards", "battlefields"] as const;

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
  if (checkpoint && shouldReconcileLegacyCheckpoint(replay, eventIndex, checkpoint, state)) {
    reconcileCheckpointBattlefieldSelections(replay, eventIndex, state);
  }
  return {
    targetMs: eventIndex >= 0 ? replay.events[eventIndex].atMs : 0,
    eventIndex,
    checkpointEventIndex,
    state,
  };
}

function shouldReconcileLegacyCheckpoint(
  replay: CanonicalReplayV2,
  eventIndex: number,
  checkpoint: ReplayCheckpoint,
  state: ReplaySeekResult["state"],
): boolean {
  if (state.phase !== "sideboarding" && state.phase !== "battlefield_pick") return false;
  const game = replay.series.games.find((candidate) => (
    candidate.id === state.gameId || (
      eventIndex >= candidate.eventStartIndex && eventIndex <= candidate.eventEndIndex
    )
  ));
  if (!game || game.ordinal <= 1 || checkpoint.eventIndex < game.eventStartIndex) return false;

  // Current checkpoints clear this game-scoped residue when game two begins.
  // Only old artifacts can carry options or populated battlefield zones into
  // the next setup, so normal seeks avoid the compatibility scan below.
  return Object.values(checkpoint.state.players).some((player) => (
    selectionValuePresent(player.fields.battlefieldOptions) ||
    selectionValuePresent(player.boardFields.battlefieldOptions) ||
    Object.entries(player.zones).some(([zone, cards]) => (
      isBattlefieldZone(zone) && cards.length > 0
    ))
  )) || (
    state.phase === "sideboarding" && (
      Object.values(checkpoint.state.players).some((player) => (
        hasBattlefieldSelection(player.fields) || hasBattlefieldSelection(player.boardFields)
      )) || hasRoomBattlefieldSelection(checkpoint.state.room.fields)
    )
  );
}

function reconcileCheckpointBattlefieldSelections(
  replay: CanonicalReplayV2,
  eventIndex: number,
  state: ReplaySeekResult["state"],
): void {
  const eventGameId = eventIndex >= 0 ? replay.events[eventIndex]?.gameId : null;
  const game = replay.series.games.find((candidate) => (
    candidate.id === eventGameId || candidate.id === state.gameId
  ));
  if (!game) return;

  const selectedPlayerIds = new Set<string>();
  let roomSelectionObserved = false;
  const end = Math.min(eventIndex, game.eventEndIndex, replay.events.length - 1);
  for (let index = game.eventStartIndex; index <= end; index += 1) {
    const event = replay.events[index];
    if (event.kind === "snapshot") {
      // A newly-created BO3 sideboarding room can echo the previous game's
      // selections. They are not current-game evidence until selection starts.
      if (game.ordinal <= 1 || event.snapshot.room.phase !== "sideboarding") {
        for (const [playerId, player] of Object.entries(event.snapshot.players)) {
          if (hasBattlefieldSelection(player.fields) || hasBattlefieldSelection(player.boardFields)) {
            selectedPlayerIds.add(playerId);
          }
        }
        roomSelectionObserved ||= hasRoomBattlefieldSelection(event.snapshot.room.fields);
      }
      continue;
    }
    if (event.kind !== "action") continue;
    for (const operation of event.patch.operations) {
      if (
        (operation.op === "set_player_fields" || operation.op === "set_board_fields") &&
        hasBattlefieldSelection(operation.fields)
      ) {
        selectedPlayerIds.add(operation.playerId);
      } else if (operation.op === "set_room_fields" && hasRoomBattlefieldSelection(operation.fields)) {
        roomSelectionObserved = true;
      } else if (operation.op === "unset_room_fields" && operation.fields.some(isRoomBattlefieldSelectionField)) {
        roomSelectionObserved = false;
      }
    }
  }
  resetGameScopedBattlefieldSelections(
    state,
    selectedPlayerIds,
    roomSelectionObserved,
    game.ordinal > 1 && (state.phase === "sideboarding" || state.phase === "battlefield_pick"),
  );
}

function isBattlefieldZone(zone: string): boolean {
  const normalized = zone.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "battlefielda" || normalized === "battlefieldb" || normalized === "battlefieldtoken";
}

function hasBattlefieldSelection(fields: Record<string, unknown>): boolean {
  return PLAYER_BATTLEFIELD_SELECTION_FIELDS.some((field) => selectionValuePresent(fields[field]));
}

function hasRoomBattlefieldSelection(fields: Record<string, unknown>): boolean {
  return ROOM_BATTLEFIELD_SELECTION_FIELDS.some((field) => selectionValuePresent(fields[field]));
}

function isRoomBattlefieldSelectionField(field: string): boolean {
  return ROOM_BATTLEFIELD_SELECTION_FIELDS.some((candidate) => candidate === field);
}

function selectionValuePresent(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === "object" && Object.keys(value).length);
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
