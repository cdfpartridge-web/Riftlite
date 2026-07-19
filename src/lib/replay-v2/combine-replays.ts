import { buildReplayCheckpoints, type ReplayCheckpointOptions } from "@/lib/replay-v2/checkpoints";
import { canonicalStringify } from "@/lib/replay-v2/json";
import { createInitialReplayState, reduceReplayEvent } from "@/lib/replay-v2/project-state";
import { stableId } from "@/lib/replay-v2/stable-id";
import type {
  CanonicalReplayV2,
  JsonObject,
  JsonValue,
  ReplayActionEvent,
  ReplayCardState,
  ReplayCollaboration,
  ReplayCollaborationDiagnostics,
  ReplayEvent,
  ReplayGame,
  ReplayParticipant,
  ReplayPatchOperation,
  ReplayPlayerState,
  ReplaySnapshot,
  ReplaySnapshotEvent,
} from "@/lib/replay-v2/types";

export type ReplayCombinePrivateIdentity = {
  seriesId?: string;
  matchId?: string;
  roomCode?: string;
  capturedAt?: number;
};

export type ReplayCombineSource = {
  replayId: string;
  canonicalSha256: string;
  replay: CanonicalReplayV2;
  /** Server-only match evidence. These values are never copied into the combined artifact. */
  identity?: ReplayCombinePrivateIdentity;
};

export type CombineCanonicalReplaysInput = {
  replayId: string;
  sources: readonly [ReplayCombineSource, ReplayCombineSource];
  checkpoints?: ReplayCheckpointOptions;
};

export type ReplayCombinationErrorCode =
  | "invalid_source"
  | "same_source"
  | "participant_mismatch"
  | "perspective_mismatch"
  | "game_structure_mismatch"
  | "identity_mismatch"
  | "identity_insufficient"
  | "material_conflict";

export class ReplayCombinationError extends Error {
  readonly code: ReplayCombinationErrorCode;
  readonly details: JsonObject;

  constructor(code: ReplayCombinationErrorCode, message: string, details: JsonObject = {}) {
    super(message);
    this.name = "ReplayCombinationError";
    this.code = code;
    this.details = details;
  }
}

type MergeContext = {
  primary: ReplayCombineSource;
  secondary: ReplayCombineSource;
  enrichedCards: number;
  enrichedFields: number;
  pairedSnapshotEvents: number;
  pairedActionEvents: number;
  warningCodes: Set<string>;
};

type AlignmentEvidence = {
  commonEvents: number;
  commonActions: number;
  primaryEvents: number;
  secondaryEvents: number;
  coverage: number;
};

const HIDDEN_ZONES = new Set(["deck", "hand", "runedeck", "sideboard"]);
const MAX_BO1_SHARED_ROOM_CAPTURE_DISTANCE_MS = 90 * 60 * 1_000;
const MAX_BO3_SHARED_ROOM_CAPTURE_DISTANCE_MS = 4 * 60 * 60 * 1_000;

/**
 * Combines two consented, opposite-perspective canonical artifacts without
 * replaying the same authoritative event twice. The more complete source is
 * used as one deterministic timeline and matching snapshots/commits only
 * enrich fields that perspective normalization removed.
 */
export function combineCanonicalReplays(input: CombineCanonicalReplaysInput): CanonicalReplayV2 {
  const outputReplayId = input.replayId.trim();
  if (!outputReplayId) {
    throw new ReplayCombinationError("invalid_source", "A combined replay ID is required.");
  }
  input.sources.forEach(validateSource);
  if (input.sources[0].replayId === input.sources[1].replayId) {
    throw new ReplayCombinationError("same_source", "Two distinct source replays are required.");
  }

  validateParticipants(input.sources[0], input.sources[1]);
  validatePerspectives(input.sources[0], input.sources[1]);
  validateGameStructure(input.sources[0], input.sources[1]);

  const [primary, secondary] = choosePrimarySource(input.sources);
  const alignment = measureAlignment(primary.replay, secondary.replay);
  const { confidence, warningCodes } = validateMatchIdentity(primary, secondary, alignment);
  const context: MergeContext = {
    primary,
    secondary,
    enrichedCards: 0,
    enrichedFields: 0,
    pairedSnapshotEvents: 0,
    pairedActionEvents: 0,
    warningCodes,
  };

  let events = cloneValue(primary.replay.events);
  const secondaryEventsByKey = indexMergeableEvents(secondary.replay);
  const pairedSecondaryEventIds = new Set<string>();
  for (let index = 0; index < events.length; index += 1) {
    const primaryEvent = events[index];
    const key = mergeableEventKey(primary.replay, primaryEvent);
    if (!key) continue;
    const candidates = secondaryEventsByKey.get(key);
    const secondaryEvent = candidates?.shift();
    if (!secondaryEvent) continue;
    pairedSecondaryEventIds.add(secondaryEvent.id);
    if (primaryEvent.kind === "snapshot" && secondaryEvent.kind === "snapshot") {
      events[index] = mergeSnapshotEvent(primaryEvent, secondaryEvent, context);
      context.pairedSnapshotEvents += 1;
    } else if (primaryEvent.kind === "action" && secondaryEvent.kind === "action") {
      events[index] = mergeActionEvent(primaryEvent, secondaryEvent, context);
      context.pairedActionEvents += 1;
    }
  }
  events = preserveKnownHiddenStateAcrossSnapshots(primary.replay.series, events, context);

  const primaryMergeableEvents = primary.replay.events.filter((event) => mergeableEventKey(primary.replay, event));
  const secondaryMergeableEvents = secondary.replay.events.filter((event) => mergeableEventKey(secondary.replay, event));
  const pairedEvents = context.pairedSnapshotEvents + context.pairedActionEvents;
  const unpairedPrimaryEvents = Math.max(0, primaryMergeableEvents.length - pairedEvents);
  const unpairedSecondaryEvents = Math.max(0, secondaryMergeableEvents.length - pairedSecondaryEventIds.size);
  if (unpairedPrimaryEvents) context.warningCodes.add("unpaired_primary_events");
  if (unpairedSecondaryEvents) context.warningCodes.add("unpaired_secondary_events");

  const sortedSources = [...input.sources].sort((left, right) => left.replayId.localeCompare(right.replayId));
  const coverageDenominator = primaryMergeableEvents.length + secondaryMergeableEvents.length;
  const diagnostics: ReplayCollaborationDiagnostics = {
    primarySourceReplayId: primary.replayId,
    pairedSnapshotEvents: context.pairedSnapshotEvents,
    pairedActionEvents: context.pairedActionEvents,
    unpairedPrimaryEvents,
    unpairedSecondaryEvents,
    enrichedCards: context.enrichedCards,
    enrichedFields: context.enrichedFields,
    coveragePercent: coverageDenominator
      ? Math.round(((pairedEvents * 2) / coverageDenominator) * 10_000) / 100
      : 0,
    warningCodes: [...context.warningCodes].sort(),
  };
  const collaboration: ReplayCollaboration = {
    schema: "riftlite-dual-perspective",
    version: 1,
    mode: "dual-perspective",
    sourceReplayIds: [sortedSources[0].replayId, sortedSources[1].replayId],
    sourceCanonicalSha256s: [sortedSources[0].canonicalSha256, sortedSources[1].canonicalSha256],
    perspectivePlayerIds: [
      requiredPerspective(sortedSources[0]),
      requiredPerspective(sortedSources[1]),
    ],
    informationPolicy: "consented_full_information",
    confidence,
    diagnostics,
  };

  const replay: CanonicalReplayV2 = {
    ...cloneValue(primary.replay),
    id: outputReplayId,
    source: {
      ...cloneValue(primary.replay.source),
      captureSessionId: stableId("combined_capture", ...collaboration.sourceReplayIds, ...collaboration.sourceCanonicalSha256s),
      roomCode: "",
      startedAt: Math.min(input.sources[0].replay.source.startedAt, input.sources[1].replay.source.startedAt),
      endedAt: Math.max(input.sources[0].replay.source.endedAt, input.sources[1].replay.source.endedAt),
      messageCount: input.sources[0].replay.source.messageCount + input.sources[1].replay.source.messageCount,
    },
    series: mergeSeries(primary, secondary, context),
    events,
    unknownEvents: cloneValue(primary.replay.unknownEvents),
    diagnostics: [
      ...cloneValue(primary.replay.diagnostics),
      {
        id: stableId("diagnostic", outputReplayId, "dual_perspective_combined", collaboration.sourceReplayIds),
        severity: "info",
        code: "dual_perspective_combined",
        message: "Two consented player perspectives were combined on one authoritative timeline.",
      },
      ...(diagnostics.warningCodes.length
        ? [{
            id: stableId("diagnostic", outputReplayId, "dual_perspective_partial_coverage", diagnostics.warningCodes),
            severity: "warning" as const,
            code: "dual_perspective_partial_coverage",
            message: "Some source events could not be paired and were preserved diagnostically without being applied twice.",
          }]
        : []),
    ],
    checkpoints: [],
    collaboration,
  };
  replay.series.roomCode = "";
  replay.checkpoints = buildReplayCheckpoints(replay, input.checkpoints);
  return replay;
}

function preserveKnownHiddenStateAcrossSnapshots(
  series: CanonicalReplayV2["series"],
  events: ReplayEvent[],
  context: MergeContext,
): ReplayEvent[] {
  let state = createInitialReplayState(series);
  return events.map((event) => {
    let next = event;
    if (event.kind === "snapshot") {
      const snapshot = cloneValue(event.snapshot);
      for (const [playerId, player] of Object.entries(snapshot.players)) {
        const previousPlayer = state.players[playerId];
        if (!previousPlayer) continue;
        for (const [zone, cards] of Object.entries(player.zones)) {
          if (!isHiddenZone(zone)) continue;
          const previousCards = previousPlayer.zones[zone] ?? [];
          if (cards.length !== previousCards.length) continue;
          player.zones[zone] = cards.map((card, index) => {
            const previous = previousCards[index];
            if (card.isPlaceholder !== true || !previous || previous.isPlaceholder === true) return card;
            context.enrichedCards += 1;
            context.enrichedFields += Object.keys(previous.fields).length;
            context.warningCodes.add("preserved_hidden_state_across_snapshot");
            return cloneValue(previous);
          });
        }
      }
      next = { ...event, snapshot };
    }
    state = reduceReplayEvent(state, next);
    return next;
  });
}

function validateSource(source: ReplayCombineSource): void {
  if (!source.replayId.trim() || !source.canonicalSha256.trim()) {
    throw new ReplayCombinationError(
      "invalid_source",
      "Each source needs a replay ID and canonical artifact checksum.",
    );
  }
  if (source.replay.schema !== "riftlite-canonical-replay" || source.replay.version !== 2) {
    throw new ReplayCombinationError("invalid_source", "Only canonical Replay V2 artifacts can be combined.");
  }
}

function validateParticipants(left: ReplayCombineSource, right: ReplayCombineSource): void {
  const leftIds = participantIds(left.replay);
  const rightIds = participantIds(right.replay);
  if (leftIds.length !== 2 || rightIds.length !== 2 || canonicalStringify(leftIds) !== canonicalStringify(rightIds)) {
    throw new ReplayCombinationError(
      "participant_mismatch",
      "The replay sources do not contain the same two Atlas player IDs.",
      { leftParticipantCount: leftIds.length, rightParticipantCount: rightIds.length },
    );
  }
}

function validatePerspectives(left: ReplayCombineSource, right: ReplayCombineSource): void {
  const leftPerspective = requiredPerspective(left);
  const rightPerspective = requiredPerspective(right);
  const participants = new Set(participantIds(left.replay));
  if (
    leftPerspective === rightPerspective ||
    !participants.has(leftPerspective) ||
    !participants.has(rightPerspective)
  ) {
    throw new ReplayCombinationError(
      "perspective_mismatch",
      "The sources must be captures from opposite players in the same match.",
    );
  }
}

function validateGameStructure(left: ReplayCombineSource, right: ReplayCombineSource): void {
  const leftSeries = left.replay.series;
  const rightSeries = right.replay.series;
  if (
    leftSeries.format !== rightSeries.format ||
    leftSeries.bestOf !== rightSeries.bestOf ||
    leftSeries.games.length !== rightSeries.games.length
  ) {
    throwGameStructureMismatch();
  }
  for (let index = 0; index < leftSeries.games.length; index += 1) {
    const leftGame = leftSeries.games[index];
    const rightGame = rightSeries.games[index];
    if (leftGame.ordinal !== rightGame.ordinal || leftGame.gameNumber !== rightGame.gameNumber) {
      throwGameStructureMismatch();
    }
    validateGameResult(leftGame, rightGame, index);
  }
}

function validateGameResult(left: ReplayGame, right: ReplayGame, index: number): void {
  const leftResult = left.result;
  const rightResult = right.result;
  if (!leftResult || !rightResult) return;
  for (const field of ["winnerPlayerId", "loserPlayerId"] as const) {
    if (leftResult[field] && rightResult[field] && leftResult[field] !== rightResult[field]) {
      throw new ReplayCombinationError(
        "game_structure_mismatch",
        "The sources disagree about a game result.",
        { gameIndex: index, field },
      );
    }
  }
  const playerIds = new Set([
    ...Object.keys(leftResult.finalScores ?? {}),
    ...Object.keys(rightResult.finalScores ?? {}),
  ]);
  for (const playerId of playerIds) {
    const leftScore = leftResult.finalScores?.[playerId];
    const rightScore = rightResult.finalScores?.[playerId];
    if (leftScore !== undefined && rightScore !== undefined && leftScore !== rightScore) {
      throw new ReplayCombinationError(
        "game_structure_mismatch",
        "The sources disagree about a final game score.",
        { gameIndex: index, field: "finalScores" },
      );
    }
  }
}

function throwGameStructureMismatch(): never {
  throw new ReplayCombinationError(
    "game_structure_mismatch",
    "The replay sources have incompatible game or series structure.",
  );
}

function choosePrimarySource(
  sources: readonly [ReplayCombineSource, ReplayCombineSource],
): [ReplayCombineSource, ReplayCombineSource] {
  const sorted = [...sources].sort((left, right) => {
    const comparison = compareCompleteness(right.replay, left.replay);
    return comparison || left.replayId.localeCompare(right.replayId);
  });
  return [sorted[0], sorted[1]];
}

function compareCompleteness(left: CanonicalReplayV2, right: CanonicalReplayV2): number {
  const leftScore = completenessScore(left);
  const rightScore = completenessScore(right);
  for (let index = 0; index < leftScore.length; index += 1) {
    if (leftScore[index] !== rightScore[index]) return leftScore[index] - rightScore[index];
  }
  return 0;
}

function completenessScore(replay: CanonicalReplayV2): number[] {
  return [
    replay.events.length,
    replay.events.filter((event) => event.kind === "action").length,
    replay.events.filter((event) => event.kind === "snapshot" && event.sequence !== undefined).length,
    -replay.unknownEvents.length,
  ];
}

function validateMatchIdentity(
  primary: ReplayCombineSource,
  secondary: ReplayCombineSource,
  alignment: AlignmentEvidence,
): { confidence: ReplayCollaboration["confidence"]; warningCodes: Set<string> } {
  const warningCodes = new Set<string>();
  const left = primary.identity ?? {};
  const right = secondary.identity ?? {};
  const sameSeries = equalNonEmpty(left.seriesId, right.seriesId);
  const sameMatch = equalNonEmpty(left.matchId, right.matchId);
  const sameRoom = equalNonEmpty(left.roomCode, right.roomCode);
  if (left.seriesId && right.seriesId && left.seriesId !== right.seriesId) warningCodes.add("source_series_id_differs");
  if (left.matchId && right.matchId && left.matchId !== right.matchId) warningCodes.add("source_match_id_differs");
  if (left.roomCode && right.roomCode && left.roomCode !== right.roomCode) warningCodes.add("source_room_id_differs");

  if (sameSeries || sameMatch) {
    return { confidence: "exact", warningCodes };
  }
  if (sameRoom) {
    const hasCompatibleCaptureWindow = captureTimesCompatible(
      left.capturedAt,
      right.capturedAt,
      primary.replay.series.format,
    );
    const hasBasicEventAlignment = basicEventAlignment(alignment);
    const hasStrongEventAlignment = strongEventAlignment(alignment);
    if (!(hasCompatibleCaptureWindow && hasBasicEventAlignment) && !hasStrongEventAlignment) {
      throw new ReplayCombinationError(
        "identity_mismatch",
        "The shared room identity lacks a compatible capture window or strong event alignment.",
      );
    }
    if (!hasCompatibleCaptureWindow) warningCodes.add("shared_room_confirmed_by_event_fingerprint");
    return { confidence: "strong", warningCodes };
  }
  if (
    primary.replay.series.id &&
    primary.replay.series.id === secondary.replay.series.id &&
    primary.replay.series.id !== "unknown"
  ) {
    warningCodes.add("matched_by_canonical_series");
    return { confidence: "strong", warningCodes };
  }
  if (strongEventAlignment(alignment)) {
    warningCodes.add("matched_by_event_fingerprint");
    return { confidence: "review", warningCodes };
  }

  const hasComparablePrivateIdentity = Boolean(
    (left.seriesId && right.seriesId) ||
    (left.matchId && right.matchId) ||
    (left.roomCode && right.roomCode),
  );
  throw new ReplayCombinationError(
    hasComparablePrivateIdentity ? "identity_mismatch" : "identity_insufficient",
    hasComparablePrivateIdentity
      ? "The private match identities do not establish that these sources are the same match."
      : "The sources need a shared series, match, or room identity, or a strong authoritative event fingerprint.",
    {
      commonEvents: alignment.commonEvents,
      commonActions: alignment.commonActions,
      coveragePercent: Math.round(alignment.coverage * 10_000) / 100,
    },
  );
}

function captureTimesCompatible(
  left: number | undefined,
  right: number | undefined,
  format: CanonicalReplayV2["series"]["format"],
): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const maximumDistance = format === "bo3"
    ? MAX_BO3_SHARED_ROOM_CAPTURE_DISTANCE_MS
    : MAX_BO1_SHARED_ROOM_CAPTURE_DISTANCE_MS;
  return Math.abs((left as number) - (right as number)) <= maximumDistance;
}

function basicEventAlignment(alignment: AlignmentEvidence): boolean {
  return alignment.commonEvents >= 2 && alignment.commonActions >= 1 && alignment.coverage >= 0.5;
}

function strongEventAlignment(alignment: AlignmentEvidence): boolean {
  return alignment.commonEvents >= 4 && alignment.commonActions >= 2 && alignment.coverage >= 0.85;
}

function equalNonEmpty(left?: string, right?: string): boolean {
  return Boolean(left?.trim() && right?.trim() && left.trim() === right.trim());
}

function measureAlignment(left: CanonicalReplayV2, right: CanonicalReplayV2): AlignmentEvidence {
  const leftKeys = mergeableKeyCounts(left);
  const rightKeys = mergeableKeyCounts(right);
  let commonEvents = 0;
  let commonActions = 0;
  for (const [key, count] of leftKeys.entries()) {
    const common = Math.min(count, rightKeys.get(key) ?? 0);
    commonEvents += common;
    if (key.startsWith("action|")) commonActions += common;
  }
  const primaryEvents = [...leftKeys.values()].reduce((sum, count) => sum + count, 0);
  const secondaryEvents = [...rightKeys.values()].reduce((sum, count) => sum + count, 0);
  return {
    commonEvents,
    commonActions,
    primaryEvents,
    secondaryEvents,
    coverage: Math.max(primaryEvents, secondaryEvents)
      ? commonEvents / Math.max(primaryEvents, secondaryEvents)
      : 0,
  };
}

function mergeableKeyCounts(replay: CanonicalReplayV2): Map<string, number> {
  const counts = new Map<string, number>();
  replay.events.forEach((event) => {
    const key = identityFingerprintKey(replay, event);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
}

function identityFingerprintKey(replay: CanonicalReplayV2, event: ReplayEvent): string {
  return mergeableEventKey(replay, event);
}

function indexMergeableEvents(replay: CanonicalReplayV2): Map<string, ReplayEvent[]> {
  const result = new Map<string, ReplayEvent[]>();
  replay.events.forEach((event) => {
    const key = mergeableEventKey(replay, event);
    if (!key) return;
    const bucket = result.get(key) ?? [];
    bucket.push(event);
    result.set(key, bucket);
  });
  return result;
}

function mergeableEventKey(replay: CanonicalReplayV2, event: ReplayEvent): string {
  const gameOrdinal = eventGameOrdinal(replay, event);
  if (event.kind === "snapshot" && event.sequence !== undefined) {
    return `snapshot|${gameOrdinal}|${event.sequence}`;
  }
  if (event.kind === "action") {
    const sequence = event.patch.sequence;
    const clientActionId = event.confirmation.clientActionId;
    if (sequence === undefined && !clientActionId) return "";
    const authority = sequence !== undefined ? `sequence:${sequence}` : `client:${clientActionId}`;
    return `action|${gameOrdinal}|${authority}|${normalizeKey(event.actionType)}`;
  }
  return "";
}

function eventGameOrdinal(replay: CanonicalReplayV2, event: ReplayEvent): number {
  const exact = replay.series.games.find((game) => game.id === event.gameId);
  if (exact) return exact.ordinal;
  const byIndex = replay.series.games.find((game) => event.index >= game.eventStartIndex && event.index <= game.eventEndIndex);
  return byIndex?.ordinal ?? 0;
}

function mergeSnapshotEvent(
  primary: ReplaySnapshotEvent,
  secondary: ReplaySnapshotEvent,
  context: MergeContext,
): ReplaySnapshotEvent {
  return {
    ...primary,
    snapshot: mergeSnapshot(primary.snapshot, secondary.snapshot, context, `event.${primary.index}.snapshot`),
  };
}

function mergeSnapshot(
  primary: ReplaySnapshot,
  secondary: ReplaySnapshot,
  context: MergeContext,
  path: string,
): ReplaySnapshot {
  if (
    primary.room.phase !== secondary.room.phase ||
    primary.room.rawPhase !== secondary.room.rawPhase ||
    primary.room.gameNumber !== secondary.room.gameNumber ||
    primary.room.activeTurnPlayerId !== secondary.room.activeTurnPlayerId ||
    primary.room.firstPlayerId !== secondary.room.firstPlayerId ||
    primary.room.turnNumber !== secondary.room.turnNumber
  ) {
    materialConflict(`${path}.room`, context);
  }
  const room = {
    ...cloneValue(primary.room),
    fields: mergeJsonObjects(primary.room.fields, secondary.room.fields, `${path}.room.fields`, context),
  };
  if (
    canonicalStringify(primary.chain.map((entry) => entry.fields)) !==
    canonicalStringify(secondary.chain.map((entry) => entry.fields))
  ) {
    materialConflict(`${path}.chain`, context);
  }
  if (
    canonicalStringify(primary.log.map(withoutEntryId)) !==
    canonicalStringify(secondary.log.map(withoutEntryId))
  ) {
    materialConflict(`${path}.log`, context);
  }
  const chain = cloneValue(primary.chain);
  const log = cloneValue(primary.log);
  const players: Record<string, ReplayPlayerState> = {};
  const playerIds = new Set([...Object.keys(primary.players), ...Object.keys(secondary.players)]);
  for (const playerId of playerIds) {
    const primaryPlayer = primary.players[playerId];
    const secondaryPlayer = secondary.players[playerId];
    if (!primaryPlayer && secondaryPlayer) {
      players[playerId] = cloneValue(secondaryPlayer);
      context.enrichedFields += 1;
      continue;
    }
    if (primaryPlayer && !secondaryPlayer) {
      players[playerId] = cloneValue(primaryPlayer);
      context.warningCodes.add("secondary_snapshot_missing_player");
      continue;
    }
    if (!primaryPlayer || !secondaryPlayer) continue;
    players[playerId] = mergePlayer(
      primaryPlayer,
      secondaryPlayer,
      playerId === requiredPerspective(context.secondary),
      context,
      `${path}.players.${playerId}`,
    );
  }
  return { room, players, chain, log };
}

function mergePlayer(
  primary: ReplayPlayerState,
  secondary: ReplayPlayerState,
  secondaryOwnsHiddenState: boolean,
  context: MergeContext,
  path: string,
): ReplayPlayerState {
  if (primary.id !== secondary.id) materialConflict(`${path}.id`, context);
  const zones: Record<string, ReplayCardState[]> = {};
  const zoneNames = new Set([...Object.keys(primary.zones), ...Object.keys(secondary.zones)]);
  for (const zone of zoneNames) {
    const primaryCards = primary.zones[zone];
    const secondaryCards = secondary.zones[zone];
    if (!primaryCards && secondaryCards) {
      zones[zone] = cloneValue(secondaryCards);
      context.enrichedCards += secondaryCards.filter((card) => !card.isPlaceholder).length;
      continue;
    }
    if (primaryCards && !secondaryCards) {
      zones[zone] = cloneValue(primaryCards);
      continue;
    }
    zones[zone] = mergeCardArray(
      primaryCards ?? [],
      secondaryCards ?? [],
      secondaryOwnsHiddenState && isHiddenZone(zone),
      context,
      `${path}.zones.${zone}`,
    );
  }
  const fields = mergeJsonObjects(primary.fields, secondary.fields, `${path}.fields`, context);
  const boardFields = mergeJsonObjects(primary.boardFields, secondary.boardFields, `${path}.boardFields`, context);
  if (primary.score !== undefined && secondary.score !== undefined && primary.score !== secondary.score) {
    materialConflict(`${path}.score`, context);
  }
  return {
    ...cloneValue(primary),
    name: primary.name || secondary.name,
    ...(primary.seat !== undefined ? { seat: primary.seat } : secondary.seat !== undefined ? { seat: secondary.seat } : {}),
    ...(primary.score !== undefined ? { score: primary.score } : secondary.score !== undefined ? { score: secondary.score } : {}),
    fields,
    boardFields,
    zones,
  };
}

function mergeActionEvent(
  primary: ReplayActionEvent,
  secondary: ReplayActionEvent,
  context: MergeContext,
): ReplayActionEvent {
  if (normalizeKey(primary.actionType) !== normalizeKey(secondary.actionType)) {
    materialConflict(`event.${primary.index}.actionType`, context);
  }
  if (
    primary.actorPlayerId &&
    secondary.actorPlayerId &&
    primary.actorPlayerId !== secondary.actorPlayerId
  ) {
    materialConflict(`event.${primary.index}.actorPlayerId`, context);
  }
  const actorPlayerId = primary.actorPlayerId || secondary.actorPlayerId;
  if (
    primary.patch.baseSequence !== undefined &&
    secondary.patch.baseSequence !== undefined &&
    primary.patch.baseSequence !== secondary.patch.baseSequence
  ) {
    materialConflict(`event.${primary.index}.patch.baseSequence`, context);
  }
  if (
    primary.patch.sequence !== undefined &&
    secondary.patch.sequence !== undefined &&
    primary.patch.sequence !== secondary.patch.sequence
  ) {
    materialConflict(`event.${primary.index}.patch.sequence`, context);
  }
  const action = mergeJsonObjects(primary.action, secondary.action, `event.${primary.index}.action`, context);
  return {
    ...primary,
    ...(actorPlayerId ? { actorPlayerId } : {}),
    action,
    confirmation: {
      ...primary.confirmation,
      ...(primary.confirmation.clientActionId
        ? {}
        : secondary.confirmation.clientActionId
          ? { clientActionId: secondary.confirmation.clientActionId }
          : {}),
      ...(primary.confirmation.latencyMs !== undefined
        ? {}
        : secondary.confirmation.latencyMs !== undefined
          ? { latencyMs: secondary.confirmation.latencyMs }
          : {}),
      correlation: primary.confirmation.correlation === "matched_intent" || secondary.confirmation.correlation === "matched_intent"
        ? "matched_intent"
        : "intent_not_observed",
    },
    patch: {
      ...(primary.patch.baseSequence !== undefined
        ? { baseSequence: primary.patch.baseSequence }
        : secondary.patch.baseSequence !== undefined
          ? { baseSequence: secondary.patch.baseSequence }
          : {}),
      ...(primary.patch.sequence !== undefined
        ? { sequence: primary.patch.sequence }
        : secondary.patch.sequence !== undefined
          ? { sequence: secondary.patch.sequence }
          : {}),
      operations: mergePatchOperations(primary.patch.operations, secondary.patch.operations, context, primary.index),
    },
  };
}

function mergePatchOperations(
  primary: ReplayPatchOperation[],
  secondary: ReplayPatchOperation[],
  context: MergeContext,
  eventIndex: number,
): ReplayPatchOperation[] {
  type OperationEntry = {
    operation: ReplayPatchOperation;
    matched: boolean;
    removed?: boolean;
  };
  const secondaryEntries: OperationEntry[] = secondary.map((operation) => ({
    operation,
    matched: false,
  }));
  const secondaryByKey = new Map<string, OperationEntry[]>();
  secondaryEntries.forEach((entry) => {
    const operation = entry.operation;
    const key = patchOperationKey(operation);
    const bucket = secondaryByKey.get(key) ?? [];
    bucket.push(entry);
    secondaryByKey.set(key, bucket);
  });
  const merged: OperationEntry[] = primary.map((operation, operationIndex) => {
    const key = patchOperationKey(operation);
    const counterpart = secondaryByKey.get(key)?.shift();
    if (!counterpart) {
      return { operation: cloneValue(operation), matched: false };
    }
    counterpart.matched = true;
    return {
      operation: mergePatchOperation(
        operation,
        counterpart.operation,
        context,
        `event.${eventIndex}.patch.operations.${operationIndex}`,
      ),
      matched: true,
    };
  });

  const secondaryPerspective = requiredPerspective(context.secondary);
  for (const entry of secondaryEntries) {
    if (entry.matched) continue;
    if (replaceRedactedZoneMove(merged, entry.operation, secondaryPerspective)) {
      entry.matched = true;
      context.warningCodes.add("merged_perspective_zone_move");
      continue;
    }
    if (shouldAppendSecondaryPrivateOperation(entry.operation, secondaryPerspective)) {
      merged.push({ operation: cloneValue(entry.operation), matched: true });
      entry.matched = true;
      context.warningCodes.add("merged_secondary_private_operation");
      continue;
    }
    context.warningCodes.add("unpaired_secondary_patch_operation");
  }
  if (merged.some((entry) => !entry.matched && !entry.removed)) {
    context.warningCodes.add("unpaired_primary_patch_operation");
  }
  return merged.filter((entry) => !entry.removed).map((entry) => entry.operation);
}

function replaceRedactedZoneMove(
  primary: Array<{ operation: ReplayPatchOperation; matched: boolean; removed?: boolean }>,
  secondary: ReplayPatchOperation,
  secondaryPerspective: string,
): boolean {
  if (
    secondary.op !== "zone_move" ||
    secondary.from.playerId !== secondaryPerspective ||
    secondary.to.playerId !== secondaryPerspective ||
    (!isHiddenZone(secondary.from.zone) && !isHiddenZone(secondary.to.zone))
  ) {
    return false;
  }
  const removeIndex = primary.findIndex((entry) => {
    if (entry.matched || entry.removed || entry.operation.op !== "zone_remove") return false;
    const operation = entry.operation;
    return operation.playerId === secondary.from.playerId &&
      normalizeKey(operation.zone) === normalizeKey(secondary.from.zone) &&
      operation.cardIds.some((cardId) => cardId === secondary.cardId || isHiddenPlaceholderId(cardId));
  });
  const insertIndex = primary.findIndex((entry) => {
    if (entry.matched || entry.removed || entry.operation.op !== "zone_insert") return false;
    const operation = entry.operation;
    return operation.playerId === secondary.to.playerId &&
      normalizeKey(operation.zone) === normalizeKey(secondary.to.zone) &&
      operation.index === secondary.to.index &&
      operation.cards.some((card) => card.id === secondary.cardId || card.isPlaceholder === true);
  });
  if (removeIndex < 0 || insertIndex < 0) return false;

  const replacementIndex = Math.min(removeIndex, insertIndex);
  const removedIndex = Math.max(removeIndex, insertIndex);
  primary[replacementIndex] = {
    operation: cloneValue(secondary),
    matched: true,
  };
  primary[removedIndex].removed = true;
  primary[removedIndex].matched = true;
  return true;
}

function shouldAppendSecondaryPrivateOperation(
  operation: ReplayPatchOperation,
  secondaryPerspective: string,
): boolean {
  switch (operation.op) {
    case "zone_insert":
    case "zone_remove":
    case "patch_card_fields":
    case "unset_card_fields":
      return operation.playerId === secondaryPerspective && isHiddenZone(operation.zone);
    case "zone_move":
      return operation.from.playerId === secondaryPerspective &&
        operation.to.playerId === secondaryPerspective &&
        isHiddenZone(operation.from.zone) &&
        isHiddenZone(operation.to.zone);
    case "set_player_fields":
      return operation.playerId === secondaryPerspective;
    case "set_board_fields":
      return operation.playerId === secondaryPerspective && hasPrivateBoardFields(operation.fields);
    default:
      return false;
  }
}

function hasPrivateBoardFields(fields: JsonObject): boolean {
  return Object.keys(fields).some((key) => /deck|hand|sideboard|mulligan|peek|choice/i.test(key));
}

function isHiddenPlaceholderId(value: string): boolean {
  return /^__hidden_zone__:/i.test(value);
}

function mergePatchOperation(
  primary: ReplayPatchOperation,
  secondary: ReplayPatchOperation,
  context: MergeContext,
  path: string,
): ReplayPatchOperation {
  if (primary.op !== secondary.op) materialConflict(`${path}.op`, context);
  switch (primary.op) {
    case "zone_insert": {
      if (secondary.op !== "zone_insert") return primary;
      return {
        ...primary,
        cards: mergeCardArray(
          primary.cards,
          secondary.cards,
          primary.playerId === requiredPerspective(context.secondary) && isHiddenZone(primary.zone),
          context,
          `${path}.cards`,
        ),
      };
    }
    case "zone_remove": {
      if (secondary.op !== "zone_remove") return primary;
      if (canonicalStringify([...primary.cardIds].sort()) !== canonicalStringify([...secondary.cardIds].sort())) {
        if (isHiddenZone(primary.zone)) {
          if (primary.playerId === requiredPerspective(context.secondary)) return cloneValue(secondary);
          if (primary.playerId === requiredPerspective(context.primary)) return cloneValue(primary);
        }
        materialConflict(`${path}.cardIds`, context);
      }
      return primary;
    }
    case "zone_move": {
      if (secondary.op !== "zone_move") return primary;
      if (!primary.card && secondary.card) {
        context.enrichedCards += secondary.card.isPlaceholder ? 0 : 1;
        return { ...primary, card: cloneValue(secondary.card) };
      }
      if (primary.card && secondary.card) {
        return {
          ...primary,
          card: mergeCard(
            primary.card,
            secondary.card,
            primary.to.playerId === requiredPerspective(context.secondary) && isHiddenZone(primary.to.zone),
            context,
            `${path}.card`,
          ),
        };
      }
      return primary;
    }
    case "patch_card_fields": {
      if (secondary.op !== "patch_card_fields") return primary;
      const secondaryOwnsHidden = primary.playerId === requiredPerspective(context.secondary) && isHiddenZone(primary.zone);
      return {
        ...primary,
        fields: secondaryOwnsHidden
          ? mergeHiddenCardPatchFields(primary.fields, secondary.fields, context, `${path}.fields`)
          : mergePublicValue(primary.fields, secondary.fields, `${path}.fields`, context),
      };
    }
    case "unset_card_fields": {
      if (secondary.op !== "unset_card_fields") return primary;
      if (canonicalStringify([...primary.fields].sort()) !== canonicalStringify([...secondary.fields].sort())) {
        materialConflict(`${path}.fields`, context);
      }
      return primary;
    }
    case "set_room_fields": {
      if (secondary.op !== "set_room_fields") return primary;
      return { ...primary, fields: mergeJsonObjects(primary.fields, secondary.fields, `${path}.fields`, context) };
    }
    case "unset_room_fields": {
      if (secondary.op !== "unset_room_fields") return primary;
      if (canonicalStringify([...primary.fields].sort()) !== canonicalStringify([...secondary.fields].sort())) {
        materialConflict(`${path}.fields`, context);
      }
      return primary;
    }
    case "set_player_fields":
    case "set_board_fields": {
      if (secondary.op !== primary.op) return primary;
      return {
        ...primary,
        fields: mergeJsonObjects(primary.fields, secondary.fields, `${path}.fields`, context),
      };
    }
    case "chain_insert": {
      if (secondary.op !== "chain_insert") return primary;
      if (canonicalStringify(primary.entries.map((entry) => entry.fields)) !== canonicalStringify(secondary.entries.map((entry) => entry.fields))) {
        materialConflict(`${path}.entries`, context);
      }
      return primary;
    }
    case "chain_remove": {
      if (secondary.op !== "chain_remove") return primary;
      if (primary.entryIds.length !== secondary.entryIds.length) materialConflict(`${path}.entryIds`, context);
      return primary;
    }
    case "log_insert": {
      if (secondary.op !== "log_insert") return primary;
      const primaryEntries = primary.entries.map(withoutEntryId);
      const secondaryEntries = secondary.entries.map(withoutEntryId);
      if (canonicalStringify(primaryEntries) !== canonicalStringify(secondaryEntries)) {
        materialConflict(`${path}.entries`, context);
      }
      return primary;
    }
    case "log_remove": {
      if (secondary.op !== "log_remove") return primary;
      if (primary.entryIds.length !== secondary.entryIds.length) materialConflict(`${path}.entryIds`, context);
      return primary;
    }
    case "unknown": {
      if (secondary.op !== "unknown") return primary;
      if (
        normalizeKey(primary.sourceOp) !== normalizeKey(secondary.sourceOp) ||
        canonicalStringify(primary.payload) !== canonicalStringify(secondary.payload)
      ) {
        materialConflict(`${path}.payload`, context);
      }
      return primary;
    }
  }
}

function patchOperationKey(operation: ReplayPatchOperation): string {
  switch (operation.op) {
    case "zone_insert":
      return `${operation.op}|${operation.playerId}|${normalizeKey(operation.zone)}|${operation.index}`;
    case "zone_remove":
      return `${operation.op}|${operation.playerId}|${normalizeKey(operation.zone)}`;
    case "zone_move":
      return `${operation.op}|${operation.cardId}|${operation.from.playerId}|${normalizeKey(operation.from.zone)}|${operation.to.playerId}|${normalizeKey(operation.to.zone)}|${operation.to.index}`;
    case "patch_card_fields":
    case "unset_card_fields":
      return `${operation.op}|${operation.playerId}|${normalizeKey(operation.zone)}|${operation.cardId}`;
    case "set_player_fields":
    case "set_board_fields":
      return `${operation.op}|${operation.playerId}`;
    case "set_room_fields":
    case "unset_room_fields":
      return operation.op;
    case "chain_insert":
    case "log_insert":
      return `${operation.op}|${operation.index}`;
    case "chain_remove":
    case "log_remove":
      return operation.op;
    case "unknown":
      return `${operation.op}|${normalizeKey(operation.sourceOp)}`;
  }
}

function mergeHiddenCardPatchFields(
  primary: JsonObject,
  secondary: JsonObject,
  context: MergeContext,
  path: string,
): JsonObject {
  if (primary.isPlaceholder === true && secondary.isPlaceholder !== true) {
    context.enrichedCards += 1;
    context.enrichedFields += Object.keys(secondary).length;
    const merged = { ...cloneValue(primary), ...cloneValue(secondary), isPlaceholder: false };
    return merged;
  }
  return mergeJsonObjects(primary, secondary, path, context);
}

function mergeCardArray(
  primary: ReplayCardState[],
  secondary: ReplayCardState[],
  secondaryOwnsHiddenState: boolean,
  context: MergeContext,
  path: string,
): ReplayCardState[] {
  if (primary.length !== secondary.length) materialConflict(`${path}.length`, context);
  const secondaryById = new Map(secondary.map((card) => [card.id, card]));
  const used = new Set<ReplayCardState>();
  return primary.map((card, index) => {
    const explicitMatch = secondaryById.get(card.id);
    const counterpart = explicitMatch && !used.has(explicitMatch) ? explicitMatch : secondary[index];
    if (!counterpart || used.has(counterpart)) materialConflict(`${path}.${index}`, context);
    used.add(counterpart);
    return mergeCard(card, counterpart, secondaryOwnsHiddenState, context, `${path}.${index}`);
  });
}

function mergeCard(
  primary: ReplayCardState,
  secondary: ReplayCardState,
  secondaryOwnsHiddenState: boolean,
  context: MergeContext,
  path: string,
): ReplayCardState {
  if (secondaryOwnsHiddenState && primary.isPlaceholder && !secondary.isPlaceholder) {
    context.enrichedCards += 1;
    context.enrichedFields += Object.keys(secondary.fields).length;
    return {
      ...cloneValue(secondary),
      ownerPlayerId: secondary.ownerPlayerId ?? primary.ownerPlayerId,
      isPlaceholder: false,
      fields: {
        ...cloneValue(secondary.fields),
        isPlaceholder: false,
      },
    };
  }
  if (!primary.isPlaceholder && secondary.isPlaceholder) return cloneValue(primary);
  if (primary.isPlaceholder && secondary.isPlaceholder) return cloneValue(primary);
  if (!primary.isPlaceholder && !secondary.isPlaceholder) {
    for (const field of ["name", "cardCode", "ownerPlayerId"] as const) {
      if (primary[field] && secondary[field] && primary[field] !== secondary[field]) {
        materialConflict(`${path}.${field}`, context);
      }
    }
  }
  return {
    ...cloneValue(primary),
    name: primary.name || secondary.name,
    ...(primary.cardCode ? { cardCode: primary.cardCode } : secondary.cardCode ? { cardCode: secondary.cardCode } : {}),
    ...(primary.ownerPlayerId
      ? { ownerPlayerId: primary.ownerPlayerId }
      : secondary.ownerPlayerId
        ? { ownerPlayerId: secondary.ownerPlayerId }
        : {}),
    ...(primary.source ? { source: primary.source } : secondary.source ? { source: secondary.source } : {}),
    ...(primary.exhausted !== undefined
      ? { exhausted: primary.exhausted }
      : secondary.exhausted !== undefined
        ? { exhausted: secondary.exhausted }
        : {}),
    ...(primary.isPlaceholder !== undefined
      ? { isPlaceholder: primary.isPlaceholder }
      : secondary.isPlaceholder !== undefined
        ? { isPlaceholder: secondary.isPlaceholder }
        : {}),
    fields: secondaryOwnsHiddenState
      ? mergeJsonObjects(primary.fields, secondary.fields, `${path}.fields`, context)
      : mergePublicValue(primary.fields, secondary.fields, `${path}.fields`, context),
  };
}

function mergeSeries(
  primary: ReplayCombineSource,
  secondary: ReplayCombineSource,
  context: MergeContext,
): CanonicalReplayV2["series"] {
  const result = cloneValue(primary.replay.series);
  result.roomCode = "";
  result.participants = result.participants.map((participant) => {
    const counterpart = secondary.replay.series.participants.find((entry) => entry.id === participant.id);
    if (!counterpart) return participant;
    return mergeParticipant(participant, counterpart, context);
  });
  return result;
}

function mergeParticipant(
  primary: ReplayParticipant,
  secondary: ReplayParticipant,
  context: MergeContext,
): ReplayParticipant {
  return {
    ...cloneValue(primary),
    name: primary.name || secondary.name,
    ...(primary.seat !== undefined ? { seat: primary.seat } : secondary.seat !== undefined ? { seat: secondary.seat } : {}),
    ...(primary.role ? { role: primary.role } : secondary.role ? { role: secondary.role } : {}),
    fields: mergeJsonObjects(primary.fields, secondary.fields, `series.participants.${primary.id}.fields`, context),
  };
}

function mergeJsonObjects(
  primary: JsonObject,
  secondary: JsonObject,
  path: string,
  context: MergeContext,
): JsonObject {
  const result = cloneValue(primary);
  for (const [key, secondaryValue] of Object.entries(secondary)) {
    if (!(key in result)) {
      result[key] = cloneValue(secondaryValue);
      context.enrichedFields += 1;
      continue;
    }
    result[key] = mergeJsonValue(result[key], secondaryValue, `${path}.${key}`, context);
  }
  return result;
}

function mergeJsonValue(
  primary: JsonValue,
  secondary: JsonValue,
  path: string,
  context: MergeContext,
): JsonValue {
  if (isJsonObject(primary) && isJsonObject(secondary)) {
    return mergeJsonObjects(primary, secondary, path, context);
  }
  if (canonicalStringify(primary) !== canonicalStringify(secondary)) materialConflict(path, context);
  return cloneValue(primary);
}

function mergePublicValue<T>(primary: T, secondary: T, path: string, context: MergeContext): T {
  if (canonicalStringify(primary) !== canonicalStringify(secondary)) materialConflict(path, context);
  return cloneValue(primary);
}

function materialConflict(path: string, context: MergeContext): never {
  throw new ReplayCombinationError(
    "material_conflict",
    "The source replays disagree on authoritative public state, so they were not combined.",
    {
      path,
      primarySourceReplayId: context.primary.replayId,
      secondarySourceReplayId: context.secondary.replayId,
    },
  );
}

function participantIds(replay: CanonicalReplayV2): string[] {
  return replay.series.participants.map((participant) => participant.id).filter(Boolean).sort();
}

function requiredPerspective(source: ReplayCombineSource): string {
  const perspective = source.replay.series.perspectivePlayerId?.trim();
  if (!perspective) {
    throw new ReplayCombinationError(
      "perspective_mismatch",
      "Each source must identify its capture perspective player.",
    );
  }
  return perspective;
}

function isHiddenZone(zone: string): boolean {
  return HIDDEN_ZONES.has(normalizeKey(zone));
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function withoutEntryId<T extends { id: string }>(entry: T): Omit<T, "id"> {
  return Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "id")) as Omit<T, "id">;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
