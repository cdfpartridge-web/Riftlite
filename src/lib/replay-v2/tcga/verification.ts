import { canonicalStringify, isRecord, stringValue } from "@/lib/replay-v2/json";
import { createInitialReplayState, reduceReplayEvent } from "@/lib/replay-v2/project-state";
import { stableDigest } from "@/lib/replay-v2/stable-id";
import type {
  CanonicalReplayV2,
  JsonObject,
  ReplayCardState,
  ReplayGameBoundaryEvent,
  ReplayState,
} from "@/lib/replay-v2/types";
import type { TcgaReplayRawCaptureV1 } from "@/lib/replay-v2/tcga/types";

const ALWAYS_PRIVATE_ZONE_KEYS = new Set(["deck", "removed", "runedeck", "unknown"]);
const OPPONENT_PRIVATE_ZONE_KEYS = new Set(["hand", "sideboard"]);
const FORBIDDEN_RAW_KEYS = new Set([
  "avatarurl",
  "carddata",
  "decklist",
  "decktopcardhiddento",
  "gameoptions",
  "grouppedtoid",
  "hiddento",
  "isreconnecting",
  "joinasspectator",
  "lobby",
  "notes",
  "playernotes",
  "profiledata",
  "pseudo",
  "randomid",
]);
const PLACEHOLDER_IDENTITY_KEYS = new Set([
  "arturl",
  "cardcode",
  "carddata",
  "cardname",
  "code",
  "face",
  "image",
  "imageurl",
  "name",
  "title",
]);

export type TcgaCanonicalVerification = {
  integrityIssues: string[];
  privacyIssues: string[];
};

/**
 * Verifies the provider boundary after TCGA normalization and before a
 * canonical artifact can be persisted. The checks deliberately operate on
 * the raw and canonical values together so a future adapter change cannot
 * copy transport identities or hidden-card data into a served replay.
 */
export function inspectTcgaCanonicalReplay(
  raw: TcgaReplayRawCaptureV1,
  replay: CanonicalReplayV2,
): TcgaCanonicalVerification {
  return {
    integrityIssues: verifyTimelineAndCheckpoints(raw, replay),
    privacyIssues: verifyCanonicalPrivacy(raw, replay),
  };
}

export function assertTcgaCanonicalReplaySafe(
  raw: TcgaReplayRawCaptureV1,
  replay: CanonicalReplayV2,
): void {
  const verification = inspectTcgaCanonicalReplay(raw, replay);
  const issues = [...verification.integrityIssues, ...verification.privacyIssues];
  if (issues.length) {
    throw new Error(`TCGA canonical replay verification failed: ${issues.join(", ")}.`);
  }
}

function verifyTimelineAndCheckpoints(
  raw: TcgaReplayRawCaptureV1,
  replay: CanonicalReplayV2,
): string[] {
  const issues = new Set<string>();
  if (
    replay.schema !== "riftlite-canonical-replay" ||
    replay.version !== 2 ||
    replay.source.schema !== "riftlite-tcga-raw-capture"
  ) {
    issues.add("invalid_tcga_canonical_envelope");
  }
  if (!replay.events.length) issues.add("missing_events");
  if (
    !replay.series.perspectivePlayerId ||
    !replay.series.participants.some((participant) => (
      participant.id === replay.series.perspectivePlayerId && participant.isPerspective
    ))
  ) {
    issues.add("invalid_perspective");
  }

  const eventIds = new Set<string>();
  let previousAt = replay.series.startedAt;
  let previousAtMs = 0;
  replay.events.forEach((event, index) => {
    if (event.index !== index) issues.add("non_sequential_event_index");
    if (!event.id || eventIds.has(event.id)) issues.add("invalid_event_id");
    eventIds.add(event.id);
    if (!Number.isFinite(event.at) || event.at < previousAt) {
      issues.add("non_monotonic_event_time");
    }
    if (
      !Number.isFinite(event.atMs) ||
      event.atMs < previousAtMs ||
      event.atMs !== Math.max(0, event.at - replay.series.startedAt)
    ) {
      issues.add("non_monotonic_event_time");
    }
    previousAt = Math.max(previousAt, event.at);
    previousAtMs = Math.max(previousAtMs, event.atMs);
  });

  for (const game of replay.series.games) {
    if (
      game.eventStartIndex < 0 ||
      game.eventEndIndex < game.eventStartIndex ||
      game.eventEndIndex >= replay.events.length ||
      game.endedAtMs < game.startedAtMs
    ) {
      issues.add("invalid_game_range");
    }
  }
  verifyMatchProjection(raw, replay, issues);

  let previousCheckpointIndex = -2;
  for (const checkpoint of replay.checkpoints) {
    if (
      checkpoint.eventIndex <= previousCheckpointIndex ||
      checkpoint.eventIndex < -1 ||
      checkpoint.eventIndex >= replay.events.length ||
      checkpoint.stateHash !== stableDigest(checkpoint.state)
    ) {
      issues.add("invalid_checkpoint");
    }
    previousCheckpointIndex = checkpoint.eventIndex;
  }
  if (!replay.checkpoints.length || replay.checkpoints[0]?.eventIndex !== -1) {
    issues.add("missing_initial_checkpoint");
  }
  if (
    replay.events.length &&
    replay.checkpoints.at(-1)?.eventIndex !== replay.events.length - 1
  ) {
    issues.add("missing_final_checkpoint");
  }

  try {
    const checkpointsByIndex = new Map(
      replay.checkpoints.map((checkpoint) => [checkpoint.eventIndex, checkpoint]),
    );
    let projected = createInitialReplayState(replay.series);
    if (checkpointsByIndex.get(-1)?.stateHash !== stableDigest(projected)) {
      issues.add("checkpoint_projection_mismatch");
    }
    for (const event of replay.events) {
      projected = reduceReplayEvent(projected, event);
      const checkpoint = checkpointsByIndex.get(event.index);
      if (checkpoint && checkpoint.stateHash !== stableDigest(projected)) {
        issues.add("checkpoint_projection_mismatch");
      }
    }
  } catch {
    issues.add("checkpoint_projection_failed");
  }
  return [...issues].sort();
}

function verifyMatchProjection(
  raw: TcgaReplayRawCaptureV1,
  replay: CanonicalReplayV2,
  issues: Set<string>,
): void {
  const match = raw.capture.match;
  const resolvedOutcome = match?.result === "incomplete" ? undefined : match?.result;
  const terminalPhases = replay.events.filter((event) => event.kind === "phase" && event.phase === "game_end");
  const endBoundaries = replay.events.filter((event): event is ReplayGameBoundaryEvent => (
    event.kind === "game_boundary" && event.boundary === "end"
  ));
  const game = replay.series.games.at(-1);
  if (!resolvedOutcome) {
    if (
      replay.series.result ||
      replay.series.games.some((entry) => entry.result) ||
      terminalPhases.length ||
      endBoundaries.length
    ) {
      issues.add("unexpected_terminal_result");
    }
    return;
  }

  const perspectivePlayerId = replay.series.perspectivePlayerId;
  const opponentPlayerId = replay.series.participants.find((participant) => !participant.isPerspective)?.id;
  const seriesResult = replay.series.result;
  const gameResult = game?.result;
  if (
    !perspectivePlayerId ||
    !opponentPlayerId ||
    !game ||
    !seriesResult ||
    !gameResult ||
    !game.sourceIdentity.resultEventId ||
    game.sourceIdentity.resultEventId !== gameResult.resultEventId ||
    gameResult.resultEventId !== seriesResult.resultEventId ||
    seriesResult.source !== "desktop_match_metadata" ||
    seriesResult.outcome !== resolvedOutcome ||
    terminalPhases.length !== 1 ||
    terminalPhases[0]?.id !== seriesResult.resultEventId ||
    endBoundaries.length !== 1 ||
    endBoundaries[0]?.reason !== "explicit_result"
  ) {
    issues.add("invalid_match_result_projection");
    return;
  }

  const expectedWinner = resolvedOutcome === "win"
    ? perspectivePlayerId
    : resolvedOutcome === "loss"
      ? opponentPlayerId
      : undefined;
  const expectedLoser = resolvedOutcome === "win"
    ? opponentPlayerId
    : resolvedOutcome === "loss"
      ? perspectivePlayerId
      : undefined;
  if (
    seriesResult.winnerPlayerId !== expectedWinner ||
    seriesResult.loserPlayerId !== expectedLoser ||
    gameResult.winnerPlayerId !== expectedWinner ||
    gameResult.loserPlayerId !== expectedLoser
  ) {
    issues.add("invalid_match_result_projection");
  }

  const expectedPerspectiveWins = resolvedOutcome === "win" ? 1 : 0;
  const expectedOpponentWins = resolvedOutcome === "loss" ? 1 : 0;
  if (
    seriesResult.finalScores[perspectivePlayerId] !== expectedPerspectiveWins ||
    seriesResult.finalScores[opponentPlayerId] !== expectedOpponentWins ||
    Object.keys(seriesResult.finalScores).length !== 2
  ) {
    issues.add("invalid_match_score_projection");
  }

  const hasScores = match?.perspectivePoints !== undefined && match.opponentPoints !== undefined;
  if (hasScores) {
    if (
      gameResult.finalScores?.[perspectivePlayerId] !== match.perspectivePoints ||
      gameResult.finalScores?.[opponentPlayerId] !== match.opponentPoints
    ) {
      issues.add("invalid_match_score_projection");
    }
  } else if (gameResult.finalScores !== undefined) {
    issues.add("invalid_match_score_projection");
  }
}

function verifyCanonicalPrivacy(
  raw: TcgaReplayRawCaptureV1,
  replay: CanonicalReplayV2,
): string[] {
  const issues = new Set<string>();
  const serialized = canonicalStringify(replay);
  const rawPlayerIds = new Set(rawPlayerIdentifiers(raw));
  for (const identifier of rawSensitiveIdentifiers(raw)) {
    if (!serialized.includes(JSON.stringify(identifier))) continue;
    issues.add(rawPlayerIds.has(identifier) ? "raw_player_identifier" : "raw_source_identifier");
  }

  walkJson(replay, (value) => {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_RAW_KEYS.has(normalizeKey(key))) issues.add("raw_protocol_field");
    }
    if (placeholderLike(value) && placeholderCarriesIdentity(value)) {
      issues.add("placeholder_identity");
    }
  });

  const perspectivePlayerId = replay.series.perspectivePlayerId;
  if (!perspectivePlayerId) {
    issues.add("missing_perspective");
    return [...issues].sort();
  }
  const opponentIds = new Set(
    replay.series.participants
      .filter((participant) => participant.id !== perspectivePlayerId)
      .map((participant) => participant.id),
  );
  if (opponentIds.size !== 1) issues.add("ambiguous_opponent");

  try {
    let state: ReplayState = createInitialReplayState(replay.series);
    inspectPrivateZones(state, opponentIds, issues);
    for (const event of replay.events) {
      state = reduceReplayEvent(state, event);
      inspectPrivateZones(state, opponentIds, issues);
    }
  } catch {
    issues.add("privacy_projection_failed");
  }
  return [...issues].sort();
}

function inspectPrivateZones(
  state: ReplayState,
  opponentIds: ReadonlySet<string>,
  issues: Set<string>,
): void {
  for (const [playerId, player] of Object.entries(state.players)) {
    for (const [zone, cards] of Object.entries(player.zones)) {
      const normalizedZone = normalizeKey(zone);
      const alwaysPrivate = ALWAYS_PRIVATE_ZONE_KEYS.has(normalizedZone);
      const opponentPrivate = opponentIds.has(playerId) && OPPONENT_PRIVATE_ZONE_KEYS.has(normalizedZone);
      if (!alwaysPrivate && !opponentPrivate) continue;
      if (!cards.some((card) => !cardIsIdentityFreePlaceholder(card))) continue;
      issues.add(alwaysPrivate ? "private_zone_identity" : "opponent_private_zone_identity");
    }
  }
}

function cardIsIdentityFreePlaceholder(card: ReplayCardState): boolean {
  return placeholderLike(card as unknown as JsonObject) &&
    !card.name &&
    !card.cardCode &&
    !placeholderCarriesIdentity(card as unknown as JsonObject);
}

function placeholderLike(value: JsonObject): boolean {
  const fields = isRecord(value.fields) ? value.fields : {};
  return value.isPlaceholder === true || fields.isPlaceholder === true;
}

function placeholderCarriesIdentity(value: JsonObject): boolean {
  if (stringValue(value.name) || stringValue(value.cardCode)) return true;
  const fields = isRecord(value.fields) ? value.fields : {};
  return Object.entries(fields).some(([key, entry]) => (
    PLACEHOLDER_IDENTITY_KEYS.has(normalizeKey(key)) && identityValuePresent(entry)
  ));
}

function identityValuePresent(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === "object" && Object.keys(value).length);
}

function rawSensitiveIdentifiers(raw: TcgaReplayRawCaptureV1): string[] {
  const identifiers = new Set([
    ...rawPlayerIdentifiers(raw),
    raw.capture.captureSessionId,
    raw.capture.lifecycle.channelKey,
    raw.capture.source.sha256,
  ]);
  const add = (value: unknown) => {
    const candidate = stringValue(value);
    if (candidate.length >= 8) identifiers.add(candidate);
  };
  for (const message of raw.messages) {
    const payload = isRecord(message.parsed.payload) ? message.parsed.payload : {};
    collectGeneralIdentifiers(payload, add);
    const general = isRecord(payload.general) ? payload.general : {};
    collectGeneralIdentifiers(general, add);
    const players = isRecord(payload.players) ? payload.players : {};
    for (const player of Object.values(players)) collectPlayerIdentifiers(player, add);
    collectPlayerIdentifiers(payload.playerData, add);
    collectHistoryIdentifiers(payload.newToHistory, add);
  }
  return [...identifiers].filter((value) => value.length >= 8);
}

function rawPlayerIdentifiers(raw: TcgaReplayRawCaptureV1): string[] {
  const identifiers = new Set<string>();
  const add = (value: unknown) => {
    const candidate = stringValue(value);
    if (candidate.length >= 8) identifiers.add(candidate);
  };
  add(raw.capture.identity.perspectivePlayerId);
  for (const message of raw.messages) {
    add(message.parsed.gameId);
    const payload = isRecord(message.parsed.payload) ? message.parsed.payload : {};
    collectGeneralIdentifiers(payload, add);
    collectGeneralIdentifiers(isRecord(payload.general) ? payload.general : {}, add);
    const players = isRecord(payload.players) ? payload.players : {};
    Object.keys(players).forEach(add);
    for (const player of Object.values(players)) collectPlayerProfileIdentifiers(player, add);
    collectPlayerProfileIdentifiers(payload.playerData, add);
    collectHistoryPlayerIdentifiers(payload.newToHistory, add);
  }
  return [...identifiers];
}

function collectGeneralIdentifiers(value: unknown, add: (value: unknown) => void): void {
  const general = isRecord(value) ? value : {};
  add(general.currentPlayer);
  if (Array.isArray(general.playerTurnOrder)) general.playerTurnOrder.forEach(add);
  const gameOptions = isRecord(general.gameOptions) ? general.gameOptions : {};
  const startingPlayer = isRecord(gameOptions.startingPlayer) ? gameOptions.startingPlayer : {};
  add(startingPlayer.randomId);
  add(startingPlayer.gameId);
  add(startingPlayer.id);
  if (Array.isArray(general.stackOrder)) {
    for (const entry of general.stackOrder) {
      if (typeof entry === "string") add(entry);
      else if (isRecord(entry)) add(entry.id ?? entry.cardId);
    }
  }
}

function collectPlayerProfileIdentifiers(value: unknown, add: (value: unknown) => void): void {
  const player = isRecord(value) ? value : {};
  const profile = isRecord(player.profileData) ? player.profileData : {};
  add(profile.playerId);
  add(profile.randomId);
  add(player.playerId);
  add(player.randomId);
}

function collectPlayerIdentifiers(value: unknown, add: (value: unknown) => void): void {
  const player = isRecord(value) ? value : {};
  collectPlayerProfileIdentifiers(player, add);
  for (const collection of [player.visibleCards, player.deck]) {
    if (!Array.isArray(collection)) continue;
    for (const entry of collection) {
      const card = isRecord(entry) ? entry : {};
      add(card.id);
      add(card.grouppedToId);
    }
  }
}

function collectHistoryIdentifiers(value: unknown, add: (value: unknown) => void): void {
  for (const history of Array.isArray(value) ? value : [value]) {
    const entry = isRecord(history) ? history : {};
    add(entry.id);
    add(entry.playerId);
  }
}

function collectHistoryPlayerIdentifiers(value: unknown, add: (value: unknown) => void): void {
  for (const history of Array.isArray(value) ? value : [value]) {
    const entry = isRecord(history) ? history : {};
    add(entry.playerId);
  }
}

function walkJson(value: unknown, visitor: (value: JsonObject) => void): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => walkJson(entry, visitor));
    return;
  }
  if (!isRecord(value)) return;
  visitor(value as JsonObject);
  Object.values(value).forEach((entry) => walkJson(entry, visitor));
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
