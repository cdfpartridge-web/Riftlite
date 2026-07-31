import { buildReplayCheckpoints } from "@/lib/replay-v2/checkpoints";
import { isRecord, toJsonObject } from "@/lib/replay-v2/json";
import { stableDigest, stableId } from "@/lib/replay-v2/stable-id";
import type {
  CanonicalReplayV2,
  JsonObject,
  JsonValue,
  ReplayActionEvent,
  ReplayCardState,
  ReplayChainEntry,
  ReplayEvent,
  ReplayGameBoundaryEvent,
  ReplayLogEvent,
  ReplayLogEntry,
  ReplayParticipant,
  ReplayPhase,
  ReplayPhaseEvent,
  ReplayPhaseSegment,
  ReplayPlayerState,
  ReplaySnapshot,
  ReplaySnapshotEvent,
} from "@/lib/replay-v2/types";
import type {
  NormalizeTcgaReplayOptions,
  TcgaReplayRawCaptureV1,
  TcgaReplayRawMessageV1,
} from "@/lib/replay-v2/tcga/types";
import { parseTcgaReplayRawCaptureV1 } from "@/lib/replay-v2/tcga/validation";

const STATE_MESSAGE_TYPES = new Set(["GAME_DATA", "PLAYER_DATA", "NEWCOMMER_GAMEDATA", "NEWCOMER_GAMEDATA"]);
const STANDARD_ZONES = [
  "base",
  "battlefieldA",
  "battlefieldB",
  "banished",
  "champion",
  "deck",
  "discard",
  "hand",
  "legend",
  "removed",
  "runeArea",
  "runeDeck",
  "sideboard",
  "unknown",
] as const;
const POSITIONED_VISIBLE_ZONES = [
  "base",
  "battlefieldA",
  "battlefieldB",
  "banished",
  "champion",
  "discard",
  "hand",
  "legend",
  "runeArea",
  "sideboard",
] as const;
const PHASE_RANK: Record<ReplayPhase, number> = {
  unknown: -1,
  lobby: 0,
  matchup: 1,
  battlefield_pick: 2,
  initiative_roll: 3,
  first_player_choice: 4,
  mulligan: 5,
  sideboarding: 6,
  in_game: 7,
  game_end: 8,
  series_end: 9,
};

type MutableProviderState = {
  players: Map<string, JsonObject>;
  general: JsonObject;
  currentLogs: ReplayLogEntry[];
  seenHistoryIds: Set<string>;
  lastZoneByCardId: Map<string, string>;
  participantCards: Map<string, { legend?: ReplayCardState; champion?: ReplayCardState }>;
  sawMulligan: boolean;
  perspectiveMulligan?: PerspectiveMulliganEvidence;
};

type PerspectiveMulliganEvidence = {
  actionEmitted: boolean;
  finalBaseHand?: JsonObject[];
  originalHand?: JsonObject[];
  preDeck: JsonObject[];
  redrawCount: number;
  replacements?: JsonObject[];
  selected?: JsonObject[];
  startingHandSize: number;
};

type EventClock = {
  at: number;
  atMs: number;
};

type SnapshotBuildResult = {
  snapshot: ReplaySnapshot;
  rawPlayerIds: string[];
  selectedBattlefields: Map<string, ReplayCardState>;
};

export function normalizeTcgaReplayRawCaptureV1(
  input: unknown,
  options: NormalizeTcgaReplayOptions = {},
): CanonicalReplayV2 {
  const capture = parseTcgaReplayRawCaptureV1(input);
  return normalizeParsedTcgaReplayRawCaptureV1(capture, options);
}

export function normalizeParsedTcgaReplayRawCaptureV1(
  capture: TcgaReplayRawCaptureV1,
  options: NormalizeTcgaReplayOptions = {},
): CanonicalReplayV2 {
  const messages = orderedMessages(capture.messages);
  const origin = messages.find(isStateBearingMessage)?.ts ?? messages[0].ts;
  const lastMessageAt = messages.reduce((latest, message) => Math.max(latest, message.ts), origin);
  const replayId = options.replayId || stableId("tcga-replay", capture.capture.captureSessionId);
  const seriesId = stableId("tcga-series", capture.capture.captureSessionId);
  const gameId = stableId("tcga-game", capture.capture.captureSessionId, 1);
  const perspectiveRawId = capture.capture.identity.perspectivePlayerId;
  const state: MutableProviderState = {
    players: new Map(),
    general: {},
    currentLogs: [],
    seenHistoryIds: new Set(),
    lastZoneByCardId: new Map(),
    participantCards: new Map(),
    sawMulligan: false,
  };
  const events: ReplayEvent[] = [];
  let currentPhase: ReplayPhase = "matchup";
  let lastEventAt = origin;
  let lastSnapshotHash = "";
  let lastSnapshotResult: SnapshotBuildResult | undefined;

  const append = <TEvent extends ReplayEvent>(event: Omit<TEvent, "index">): TEvent => {
    const next = { ...event, index: events.length } as TEvent;
    events.push(next);
    lastEventAt = Math.max(lastEventAt, next.at);
    return next;
  };
  append<ReplayGameBoundaryEvent>({
    id: stableId("event", replayId, "game-start"),
    kind: "game_boundary",
    boundary: "start",
    gameOrdinal: 1,
    gameNumber: 1,
    reason: "series_start",
    at: origin,
    atMs: 0,
    sourceMessageId: stableId("tcga-message", capture.capture.captureSessionId, "start"),
    gameId,
  });
  append<ReplayPhaseEvent>({
    id: stableId("event", replayId, "phase", currentPhase),
    kind: "phase",
    phase: currentPhase,
    rawPhase: "tcga:setup",
    gameNumber: 1,
    at: origin,
    atMs: 0,
    sourceMessageId: stableId("tcga-message", capture.capture.captureSessionId, "start"),
    gameId,
  });

  for (const message of messages) {
    const clock = eventClock(message.ts, origin, lastEventAt);
    const payload = jsonObject(message.parsed.payload);
    const histories = historyValues(payload?.newToHistory);
    if (histories.some((history) => /mulligan/i.test(textValue(history.text)))) {
      state.sawMulligan = true;
    }
    const mulliganEvidenceChanged = capturePerspectiveMulliganEvidence(capture, state, histories);
    const changed = applyProviderMessage(state, message, payload);
    if (changed) inferPerspectiveMulliganFromDeckDelta(capture, state);
    const inferredPhase = inferPhase(state);
    if (PHASE_RANK[inferredPhase] > PHASE_RANK[currentPhase]) {
      currentPhase = inferredPhase;
      append<ReplayPhaseEvent>({
        id: stableId("event", replayId, "phase", currentPhase, message.completedTransportSequence),
        kind: "phase",
        phase: currentPhase,
        rawPhase: `tcga:${currentPhase}`,
        gameNumber: 1,
        ...clock,
        sourceMessageId: sourceMessageId(capture, message),
        gameId,
      });
    }

    const exactMulliganAction = changed
      ? buildPerspectiveMulliganAction(capture, state, message, gameId, clock)
      : undefined;
    if (exactMulliganAction) append<ReplayActionEvent>(exactMulliganAction);

    if ((changed || mulliganEvidenceChanged) && state.players.size >= 2) {
      const result = buildSnapshot({
        capture,
        gameId,
        phase: currentPhase,
        state,
      });
      const publicStateHash = stableDigest({
        room: result.snapshot.room,
        players: result.snapshot.players,
        chain: result.snapshot.chain,
      });
      if (publicStateHash !== lastSnapshotHash) {
        append<ReplaySnapshotEvent>({
          id: stableId("event", replayId, "snapshot", message.completedTransportSequence, publicStateHash),
          kind: "snapshot",
          sequence: message.completedTransportSequence,
          snapshot: result.snapshot,
          ...clock,
          sourceMessageId: sourceMessageId(capture, message),
          gameId,
        });
        lastSnapshotHash = publicStateHash;
        lastSnapshotResult = result;
      }
    }

    for (const history of histories) {
      const log = normalizeHistoryEntry({ capture, history, message, state });
      if (!log || state.seenHistoryIds.has(log.id)) continue;
      state.seenHistoryIds.add(log.id);
      state.currentLogs.push(log);
      append<ReplayLogEvent>({
        id: stableId("event", replayId, "log", log.id),
        kind: "log",
        mode: "append",
        entries: [log],
        ...clock,
        sourceMessageId: sourceMessageId(capture, message),
        gameId,
      });
    }
  }

  if (!lastSnapshotResult || lastSnapshotResult.rawPlayerIds.length !== 2) {
    throw new Error("TCGA capture did not produce one complete two-player state.");
  }
  if (currentPhase !== "in_game") {
    throw new Error("TCGA capture ended before both players reached gameplay.");
  }

  const perspectivePlayerId = opaquePlayerId(capture, perspectiveRawId);
  const opponentRawId = lastSnapshotResult.rawPlayerIds.find((playerId) => playerId !== perspectiveRawId);
  if (!opponentRawId) {
    throw new Error("TCGA capture did not identify the opponent player.");
  }
  const opponentPlayerId = opaquePlayerId(capture, opponentRawId);
  const match = capture.capture.match;
  const resolvedOutcome = match?.result === "incomplete" ? undefined : match?.result;
  const resultEventId = match && resolvedOutcome
    ? stableId(
      "tcga-result",
      capture.capture.captureSessionId,
      resolvedOutcome,
      match.perspectivePoints,
      match.opponentPoints,
    )
    : undefined;
  if (resolvedOutcome && resultEventId) {
    const clock = eventClock(lastMessageAt, origin, lastEventAt);
    const sourceId = stableId(
      "tcga-message",
      capture.capture.captureSessionId,
      "desktop-match-metadata",
    );
    currentPhase = "game_end";
    append<ReplayPhaseEvent>({
      id: resultEventId,
      kind: "phase",
      phase: currentPhase,
      rawPhase: "tcga:desktop_match_metadata",
      gameNumber: 1,
      ...clock,
      sourceMessageId: sourceId,
      gameId,
    });
    append<ReplayGameBoundaryEvent>({
      id: stableId("event", replayId, "game-end", resultEventId),
      kind: "game_boundary",
      boundary: "end",
      gameOrdinal: 1,
      gameNumber: 1,
      reason: "explicit_result",
      ...clock,
      sourceMessageId: sourceId,
      gameId,
    });
  }

  const participants = buildParticipants(
    capture,
    state,
    lastSnapshotResult.rawPlayerIds,
    lastSnapshotResult.selectedBattlefields,
  );
  const phases = buildPhaseSegments(events);
  const gameFinalScores = match?.perspectivePoints !== undefined &&
    match.opponentPoints !== undefined
    ? {
      [perspectivePlayerId]: match.perspectivePoints,
      [opponentPlayerId]: match.opponentPoints,
    }
    : undefined;
  const seriesFinalScores = resolvedOutcome
    ? {
      [perspectivePlayerId]: resolvedOutcome === "win" ? 1 : 0,
      [opponentPlayerId]: resolvedOutcome === "loss" ? 1 : 0,
    }
    : undefined;
  const playerOutcome = resolvedOutcome === "win"
    ? { winnerPlayerId: perspectivePlayerId, loserPlayerId: opponentPlayerId }
    : resolvedOutcome === "loss"
      ? { winnerPlayerId: opponentPlayerId, loserPlayerId: perspectivePlayerId }
      : {};
  const gameEndIndex = events.length - 1;
  const canonical: CanonicalReplayV2 = {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: replayId,
    source: {
      schema: "riftlite-tcga-raw-capture",
      version: 1,
      captureSessionId: "",
      roomCode: "",
      startedAt: origin,
      endedAt: lastMessageAt,
      messageCount: messages.length,
    },
    series: {
      id: seriesId,
      perspectivePlayerId,
      format: "bo1",
      bestOf: 1,
      roomCode: "",
      startedAt: origin,
      endedAt: lastMessageAt,
      participants,
      games: [{
        id: gameId,
        ordinal: 1,
        gameNumber: 1,
        sourceIdentity: {
          explicitGameNumber: false,
          gameInstanceIds: [],
          ...(resultEventId ? { resultEventId } : {}),
        },
        startedAt: origin,
        endedAt: lastMessageAt,
        startedAtMs: 0,
        endedAtMs: Math.max(0, lastMessageAt - origin),
        eventStartIndex: 0,
        eventEndIndex: gameEndIndex,
        phases,
        ...(resultEventId ? {
          result: {
            resultEventId,
            ...playerOutcome,
            ...(gameFinalScores ? { finalScores: gameFinalScores } : {}),
          },
        } : {}),
      }],
      ...(resolvedOutcome && resultEventId ? {
        result: {
          resultEventId,
          source: "desktop_match_metadata",
          outcome: resolvedOutcome,
          ...playerOutcome,
          finalScores: seriesFinalScores ?? {},
        },
      } : {}),
    },
    events,
    unknownEvents: [],
    diagnostics: [{
      id: stableId("diagnostic", replayId, "tcga-provider"),
      severity: "info",
      code: "tcga_provider_v1",
      message: "Replay normalized from a privacy-projected TCGA state timeline.",
    }, ...(resolvedOutcome ? [{
      id: stableId("diagnostic", replayId, "desktop-match-result-applied"),
      severity: "info" as const,
      code: "desktop_match_result_applied",
      message: "The terminal result was restored from desktop match metadata.",
    }] : [{
      id: stableId("diagnostic", replayId, "terminal-result-unknown"),
      severity: "warning" as const,
      code: "terminal_result_unknown",
      message: "The capture ended without authoritative winner evidence; the replay result is unresolved.",
    }])],
    checkpoints: [],
  };
  canonical.checkpoints = buildReplayCheckpoints(canonical, {
    everyEvents: options.checkpoints?.everyEvents ?? 40,
    includePhaseBoundaries: options.checkpoints?.includePhaseBoundaries ?? true,
    includeSnapshots: options.checkpoints?.includeSnapshots ?? false,
  });
  return canonical;
}

function orderedMessages(messages: TcgaReplayRawMessageV1[]): TcgaReplayRawMessageV1[] {
  return messages
    .map((message, sourceIndex) => ({ message, sourceIndex }))
    .sort((left, right) => (
      left.message.completedTransportSequence - right.message.completedTransportSequence ||
      left.message.firstTransportSequence - right.message.firstTransportSequence ||
      left.message.seq - right.message.seq ||
      left.sourceIndex - right.sourceIndex
    ))
    .map(({ message }) => message);
}

function isStateBearingMessage(message: TcgaReplayRawMessageV1): boolean {
  return STATE_MESSAGE_TYPES.has(message.parsed.type);
}

function applyProviderMessage(
  state: MutableProviderState,
  message: TcgaReplayRawMessageV1,
  payload: JsonObject | null,
): boolean {
  if (!payload) return false;
  switch (message.parsed.type) {
    case "NEWCOMMER_GAMEDATA":
    case "NEWCOMER_GAMEDATA": {
      const players = jsonObject(payload.players);
      for (const [playerId, player] of Object.entries(players ?? {})) {
        const value = jsonObject(player);
        if (value) mergePlayer(state, playerId, value);
      }
      const general = jsonObject(payload.general);
      if (general) state.general = mergeJson(state.general, general);
      return Boolean(players || general);
    }
    case "PLAYER_DATA": {
      const playerId = message.parsed.gameId ?? "";
      if (!playerId) return false;
      mergePlayer(state, playerId, payload);
      return true;
    }
    case "GAME_DATA": {
      let changed = false;
      const playerData = jsonObject(payload.playerData);
      if (playerData && message.parsed.gameId) {
        mergePlayer(state, message.parsed.gameId, playerData);
        changed = true;
      }
      const generalDelta: JsonObject = {};
      for (const key of [
        "cardsLinks",
        "currentPlayer",
        "endTurnInfo",
        "gameOptions",
        "stackOrder",
        "turnCount",
        "turnOrder",
      ]) {
        if (payload[key] !== undefined) generalDelta[key] = payload[key];
      }
      if (Object.keys(generalDelta).length) {
        state.general = mergeJson(state.general, generalDelta);
        changed = true;
      }
      return changed;
    }
    default:
      return false;
  }
}

function capturePerspectiveMulliganEvidence(
  capture: TcgaReplayRawCaptureV1,
  state: MutableProviderState,
  histories: JsonObject[],
): boolean {
  if (state.perspectiveMulligan) return false;
  const perspectiveRawId = capture.capture.identity.perspectivePlayerId;
  const redrawHistory = histories.find((history) => (
    textValue(history.playerId) === perspectiveRawId &&
    /mulligan\.drawAgainX/i.test(textValue(history.text))
  ));
  if (!redrawHistory) return false;
  const redrawCount = positiveInteger(jsonObject(redrawHistory.params)?.count);
  const startingHandSize = tcgaStartingHandSize(state.general);
  const preDeck = jsonCards(state.players.get(perspectiveRawId)?.deck);
  if (
    redrawCount === undefined ||
    startingHandSize === undefined ||
    redrawCount > startingHandSize ||
    preDeck.length < startingHandSize * 2 ||
    !hasUniqueRawCardIds(preDeck)
  ) return false;
  state.perspectiveMulligan = {
    actionEmitted: false,
    preDeck,
    redrawCount,
    startingHandSize,
  };
  return true;
}

function inferPerspectiveMulliganFromDeckDelta(
  capture: TcgaReplayRawCaptureV1,
  state: MutableProviderState,
): void {
  const evidence = state.perspectiveMulligan;
  if (!evidence || evidence.originalHand) return;
  const perspectiveRawId = capture.capture.identity.perspectivePlayerId;
  const player = state.players.get(perspectiveRawId);
  if (!player) return;
  const currentDeck = jsonCards(player.deck);
  const visibleCards = jsonCards(player.visibleCards);
  if (!hasUniqueRawCardIds(currentDeck) || !hasUniqueRawCardIds(visibleCards)) return;
  const currentDeckIds = new Set(currentDeck.map(rawCardId));
  const drawn = visibleCards.filter((card) => (
    cardSection(card).toLowerCase() === "deck" && !currentDeckIds.has(rawCardId(card))
  ));
  if (drawn.length !== evidence.startingHandSize || !hasUniqueRawCardIds(drawn)) return;
  const drawnIds = new Set(drawn.map(rawCardId));
  const removedFromDeck = evidence.preDeck.filter((card) => !currentDeckIds.has(rawCardId(card)));
  if (!sameRawCardIdSet(removedFromDeck, drawn)) return;

  const candidates = [
    { original: evidence.preDeck.slice(0, evidence.startingHandSize), selectedBoundary: "end" as const },
    { original: evidence.preDeck.slice(-evidence.startingHandSize), selectedBoundary: "start" as const },
  ].flatMap(({ original, selectedBoundary }) => {
    const originalIds = new Set(original.map(rawCardId));
    const selected = original.filter((card) => !drawnIds.has(rawCardId(card)));
    const replacements = drawn.filter((card) => !originalIds.has(rawCardId(card)));
    const keptCount = original.filter((card) => drawnIds.has(rawCardId(card))).length;
    if (
      selected.length !== evidence.redrawCount ||
      replacements.length !== evidence.redrawCount ||
      keptCount !== evidence.startingHandSize - evidence.redrawCount
    ) return [];
    const boundary = evidence.redrawCount === 0
      ? []
      : selectedBoundary === "start"
        ? currentDeck.slice(0, evidence.redrawCount)
        : currentDeck.slice(-evidence.redrawCount);
    // TCGA may push multiple returned cards onto the deck in reverse order.
    // Their identities and boundary placement are authoritative; their order
    // at that boundary is not the order shown in the mulligan dialog.
    if (!sameRawCardIdSet(boundary, selected)) return [];
    return [{ original, replacements, selected }];
  });
  if (candidates.length !== 1) return;
  evidence.originalHand = candidates[0].original;
  evidence.finalBaseHand = drawn;
  evidence.replacements = candidates[0].replacements;
  evidence.selected = candidates[0].selected;
}

function buildPerspectiveMulliganAction(
  capture: TcgaReplayRawCaptureV1,
  state: MutableProviderState,
  message: TcgaReplayRawMessageV1,
  gameId: string,
  clock: EventClock,
): Omit<ReplayActionEvent, "index"> | undefined {
  const evidence = state.perspectiveMulligan;
  const perspectiveRawId = capture.capture.identity.perspectivePlayerId;
  if (
    !evidence ||
    evidence.actionEmitted ||
    !evidence.originalHand ||
    !evidence.finalBaseHand ||
    !evidence.replacements ||
    !evidence.selected ||
    message.dir !== "out" ||
    message.parsed.gameId !== perspectiveRawId
  ) return undefined;
  const player = state.players.get(perspectiveRawId);
  if (!player) return undefined;
  const hand = jsonCards(player.visibleCards)
    .filter((card) => cardSection(card).toLowerCase() === "hand")
    .slice(0, evidence.startingHandSize);
  if (
    hand.length !== evidence.startingHandSize ||
    !hasUniqueRawCardIds(hand) ||
    !sameRawCardIdOrder(hand, evidence.finalBaseHand)
  ) return undefined;

  const original = evidence.originalHand.map((card, index) => (
    normalizeCard(capture, perspectiveVisibleRawCard(card, perspectiveRawId), perspectiveRawId, "hand", index, false)
  ));
  const finalHand = hand.map((card, index) => (
    normalizeCard(capture, card, perspectiveRawId, "hand", index, false)
  ));
  const selectedIds = evidence.selected.map((card, index) => (
    opaqueCardId(capture, providerCardId(card, perspectiveRawId, "hand", index))
  ));
  const replacementIds = evidence.replacements.map((card, index) => (
    opaqueCardId(capture, providerCardId(card, perspectiveRawId, "hand", index))
  ));
  const actorPlayerId = opaquePlayerId(capture, perspectiveRawId);
  const sourceId = sourceMessageId(capture, message);
  evidence.actionEmitted = true;
  return {
    id: stableId("event", capture.capture.captureSessionId, "tcga-mulligan", message.completedTransportSequence),
    kind: "action",
    actionType: "submit_mulligan",
    actorPlayerId,
    action: { type: "submit_mulligan", cardIds: selectedIds },
    confirmation: {
      status: "confirmed",
      authority: "authoritative_patch_commit",
      correlation: "intent_not_observed",
      commitMessageId: sourceId,
    },
    patch: {
      sequence: message.completedTransportSequence,
      operations: [
        {
          id: stableId("operation", sourceId, "mulligan-playback"),
          op: "set_room_fields",
          fields: {
            mulliganPlaybackByPlayerId: {
              [actorPlayerId]: {
                redrawCount: evidence.redrawCount,
                draws: replacementIds.map((cardId) => ({ kind: "refill", cardId })),
              },
            },
          },
        },
        {
          id: stableId("operation", sourceId, "mulligan-remove"),
          op: "zone_remove",
          playerId: actorPlayerId,
          zone: "hand",
          cardIds: original.map((card) => card.id),
        },
        {
          id: stableId("operation", sourceId, "mulligan-insert"),
          op: "zone_insert",
          playerId: actorPlayerId,
          zone: "hand",
          index: 0,
          cards: finalHand,
        },
      ],
    },
    ...clock,
    sourceMessageId: sourceId,
    gameId,
  };
}

function tcgaStartingHandSize(general: JsonObject): number | undefined {
  const gameOptions = jsonObject(general.gameOptions);
  const format = jsonObject(gameOptions?.format);
  const mulligan = jsonObject(format?.mulligan);
  const size = positiveInteger(mulligan?.startingHandSize);
  return size !== undefined && size > 0 && size <= 12 ? size : undefined;
}

function jsonCards(value: JsonValue | undefined): JsonObject[] {
  return arrayValue(value).flatMap((entry) => {
    const card = jsonObject(entry);
    return card ? [card] : [];
  });
}

function rawCardId(card: JsonObject): string {
  return textValue(card.id);
}

function perspectiveVisibleRawCard(card: JsonObject, perspectiveRawId: string): JsonObject {
  const hiddenTo = jsonObject(card.hiddenTo);
  return hiddenTo
    ? { ...card, hiddenTo: { ...hiddenTo, [perspectiveRawId]: false } }
    : card;
}

function hasUniqueRawCardIds(cards: JsonObject[]): boolean {
  const ids = cards.map(rawCardId);
  return ids.every(Boolean) && new Set(ids).size === ids.length;
}

function sameRawCardIdOrder(left: JsonObject[], right: JsonObject[]): boolean {
  return left.length === right.length && left.every((card, index) => rawCardId(card) === rawCardId(right[index]));
}

function sameRawCardIdSet(left: JsonObject[], right: JsonObject[]): boolean {
  if (left.length !== right.length || !hasUniqueRawCardIds(left) || !hasUniqueRawCardIds(right)) return false;
  const rightIds = new Set(right.map(rawCardId));
  return left.every((card) => rightIds.has(rawCardId(card)));
}

function mergePlayer(state: MutableProviderState, playerId: string, value: JsonObject): void {
  state.players.set(playerId, mergeJson(state.players.get(playerId) ?? {}, value));
}

function mergeJson(left: JsonObject, right: JsonObject): JsonObject {
  return { ...left, ...right };
}

function inferPhase(state: MutableProviderState): ReplayPhase {
  const players = [...state.players.values()];
  if (players.length >= 2 && players.every((player) => integerValue(player.setupStep) >= 10)) {
    return "in_game";
  }
  const setupSteps = players.map((player) => integerValue(player.setupStep)).filter((value) => value >= 0);
  const maximumSetup = setupSteps.length ? Math.max(...setupSteps) : 0;
  if (state.sawMulligan || maximumSetup >= 4) return "mulligan";
  const bothBattlefieldsSelected = players.length >= 2 && players.every(hasSelectedBattlefield);
  const startingPlayer = jsonObject(jsonObject(state.general.gameOptions)?.startingPlayer);
  if (
    bothBattlefieldsSelected &&
    (maximumSetup >= 3 || textValue(state.general.currentPlayer) || textValue(startingPlayer?.randomId))
  ) {
    return "first_player_choice";
  }
  if (maximumSetup > 0 || players.some(hasSelectedBattlefield)) return "battlefield_pick";
  return "matchup";
}

function buildSnapshot(input: {
  capture: TcgaReplayRawCaptureV1;
  gameId: string;
  phase: ReplayPhase;
  state: MutableProviderState;
}): SnapshotBuildResult {
  const rawPlayerIds = orderedRawPlayerIds(input.capture, input.state);
  const selectedBattlefields = new Map<string, ReplayCardState>();
  const players: Record<string, ReplayPlayerState> = {};
  const stackCards = new Map<string, ReplayCardState>();
  for (const [boardSeat, rawPlayerId] of rawPlayerIds.entries()) {
    const rawPlayer = input.state.players.get(rawPlayerId) ?? {};
    const player = normalizePlayerState(
      input.capture,
      rawPlayerId,
      rawPlayer,
      boardSeat,
      input.state.lastZoneByCardId,
      input.state.participantCards,
      selectedBattlefields,
      stackCards,
      input.state.perspectiveMulligan,
    );
    players[player.id] = player;
  }

  const activeTurnPlayerId = canonicalPlayerReference(input.capture, input.state.general.currentPlayer);
  const firstPlayerRawId = textValue(jsonObject(jsonObject(input.state.general.gameOptions)?.startingPlayer)?.randomId);
  const firstPlayerId = firstPlayerRawId ? opaquePlayerId(input.capture, firstPlayerRawId) : undefined;
  const providerTurnCount = positiveInteger(input.state.general.turnCount);
  // TCGA increments `turnCount` for each player's turn. RiftLite presents the
  // shared round number, matching the TCGA client: provider turns 1/2 are
  // round 1, 3/4 are round 2, and so on.
  const turnNumber = providerTurnCount === undefined
    ? undefined
    : Math.ceil(providerTurnCount / 2);
  const chain = normalizeChain(input.capture, input.state.general.stackOrder, stackCards);
  const setupStepByPlayerId = Object.fromEntries(rawPlayerIds.map((rawPlayerId) => [
    opaquePlayerId(input.capture, rawPlayerId),
    Math.max(0, integerValue(input.state.players.get(rawPlayerId)?.setupStep)),
  ]));
  return {
    rawPlayerIds,
    selectedBattlefields,
    snapshot: {
      room: {
        phase: input.phase,
        rawPhase: `tcga:${input.phase}`,
        gameNumber: 1,
        ...(activeTurnPlayerId ? { activeTurnPlayerId } : {}),
        ...(firstPlayerId ? { firstPlayerId } : {}),
        ...(turnNumber !== undefined ? { turnNumber } : {}),
        fields: {
          provider: "tcga",
          ...(providerTurnCount !== undefined ? { providerTurnCount } : {}),
          setupStepByPlayerId,
        },
      },
      players,
      chain,
      log: input.state.currentLogs.map(cloneLog),
    },
  };
}

function normalizePlayerState(
  capture: TcgaReplayRawCaptureV1,
  rawPlayerId: string,
  rawPlayer: JsonObject,
  boardSeat: number,
  lastZoneByCardId: Map<string, string>,
  participantCards: Map<string, { legend?: ReplayCardState; champion?: ReplayCardState }>,
  selectedBattlefields: Map<string, ReplayCardState>,
  stackCards: Map<string, ReplayCardState>,
  perspectiveMulligan?: PerspectiveMulliganEvidence,
): ReplayPlayerState {
  const id = opaquePlayerId(capture, rawPlayerId);
  const zones = Object.fromEntries(STANDARD_ZONES.map((zone) => [zone, [] as ReplayCardState[]]));
  const seenCardIds = new Set<string>();
  const visibleCards = arrayValue(rawPlayer.visibleCards).flatMap((value, index) => {
    const card = jsonObject(value);
    return card ? [{ card, index, rawCardId: providerCardId(card, rawPlayerId, "visible", index) }] : [];
  });
  const zoneByCardId = resolveVisibleCardZones(visibleCards, lastZoneByCardId);
  visibleCards.forEach(({ card: rawCard, index, rawCardId }) => {
    if (seenCardIds.has(rawCardId)) return;
    seenCardIds.add(rawCardId);
    const zone = zoneByCardId.get(rawCardId) ?? "unknown";
    const remotePrivateZone = rawPlayerId !== capture.capture.identity.perspectivePlayerId &&
      (zone === "hand" || zone === "sideboard");
    const alwaysHiddenZone = zone === "deck" || zone === "runeDeck" || zone === "removed" || zone === "unknown";
    const card = normalizeCard(
      capture,
      rawCard,
      rawPlayerId,
      zone,
      index,
      remotePrivateZone || alwaysHiddenZone,
    );
    if (!card.isPlaceholder && (zone === "legend" || zone === "champion")) {
      const identities = participantCards.get(rawPlayerId) ?? {};
      participantCards.set(rawPlayerId, { ...identities, [zone]: card });
    }
    if (zone === "selectedBattlefield") {
      if (!card.isPlaceholder) selectedBattlefields.set(rawPlayerId, card);
    } else if (zone === "stack") {
      stackCards.set(rawCardId, card);
    } else {
      (zones[zone] ??= []).push(card);
    }
  });
  // TCGA's visibleCards collection is transport/update order, not visual board
  // order. The explicit position index is the authority for public, positioned
  // zones. Sorting here keeps every renderer and state transition consistent.
  POSITIONED_VISIBLE_ZONES.forEach((zone) => {
    zones[zone].sort((left, right) => (
      positionedCardIndex(left) - positionedCardIndex(right)
    ));
  });
  arrayValue(rawPlayer.deck).forEach((value, index) => {
    const rawCard = jsonObject(value);
    if (!rawCard) return;
    const rawCardId = providerCardId(rawCard, rawPlayerId, "deck", index);
    if (seenCardIds.has(rawCardId)) return;
    seenCardIds.add(rawCardId);
    zones.deck.push(normalizeCard(capture, rawCard, rawPlayerId, "deck", index, true));
    lastZoneByCardId.set(rawCardId, "deck");
  });
  if (
    rawPlayerId === capture.capture.identity.perspectivePlayerId &&
    perspectiveMulligan?.originalHand &&
    !perspectiveMulligan.actionEmitted &&
    zones.hand.length === 0
  ) {
    const originalIds = new Set(perspectiveMulligan.originalHand.map((card, index) => (
      opaqueCardId(capture, providerCardId(card, rawPlayerId, "hand", index))
    )));
    const stagedHandIds = new Set([
      ...originalIds,
      ...(perspectiveMulligan.finalBaseHand ?? []).map((card, index) => (
        opaqueCardId(capture, providerCardId(card, rawPlayerId, "hand", index))
      )),
    ]);
    STANDARD_ZONES.forEach((zone) => {
      if (zone !== "deck" && zone !== "hand") {
        zones[zone] = zones[zone].filter((card) => !stagedHandIds.has(card.id));
      }
    });
    // The provider reports the final post-mulligan deck by this point. Rebuild
    // the opening-hand deck count from the captured pre-draw deck, otherwise
    // returned selections are removed twice and the prelude under-counts it.
    zones.deck = perspectiveMulligan.preDeck
      .map((card, index) => normalizeCard(capture, card, rawPlayerId, "deck", index, true))
      .filter((card) => !originalIds.has(card.id));
    zones.hand = perspectiveMulligan.originalHand.map((card, index) => (
      normalizeCard(
        capture,
        perspectiveVisibleRawCard(card, rawPlayerId),
        rawPlayerId,
        "hand",
        index,
        false,
      )
    ));
  }

  const selected = selectedBattlefields.get(rawPlayerId);
  const setupStep = Math.max(0, integerValue(rawPlayer.setupStep));
  const fields: JsonObject = {
    provider: "tcga",
    setupStep,
    ...(selected ? { selectedBattlefield: publicCardReference(selected) } : {}),
  };
  const boardFields: JsonObject = {
    ...(selected ? { selectedBattlefield: publicCardReference(selected) } : {}),
  };
  const score = playerScore(rawPlayer);
  const turnOrderPosition = integerOrText(rawPlayer.turnOrderPosition);
  return {
    id,
    name: playerDisplayName(rawPlayer, rawPlayerId === capture.capture.identity.perspectivePlayerId),
    // `turnOrderPosition` is initiative order, not a physical board seat. The
    // canonical seat is capture layout only; TCGA B1/B2 remain owner-relative
    // and the replay board projects them onto each selected battlefield.
    seat: boardSeat,
    ...(score !== undefined ? { score } : {}),
    fields: {
      ...fields,
      ...(turnOrderPosition !== undefined ? { turnOrderPosition } : {}),
    },
    boardFields,
    zones,
  };
}

function normalizeCard(
  capture: TcgaReplayRawCaptureV1,
  rawCard: JsonObject,
  fallbackOwnerRawId: string,
  zone: string,
  index: number,
  forceHidden: boolean,
): ReplayCardState {
  const rawId = providerCardId(rawCard, fallbackOwnerRawId, zone, index);
  const id = opaqueCardId(capture, rawId);
  const rawOwnerId = textValue(rawCard.owner) || fallbackOwnerRawId;
  const ownerPlayerId = opaquePlayerId(capture, rawOwnerId);
  const hiddenTo = jsonObject(rawCard.hiddenTo);
  const hidden = forceHidden || hiddenTo?.[capture.capture.identity.perspectivePlayerId] === true;
  if (hidden) {
    return {
      id,
      name: "",
      ownerPlayerId,
      source: zone,
      isPlaceholder: true,
      fields: { ownerPlayerId, source: zone, isPlaceholder: true },
    };
  }

  const cardData = jsonObject(rawCard.cardData) ?? {};
  const name = localizedName(cardData.name);
  const cardCode = publicCardCode(cardData.id);
  const exhausted = rawCard.isTapped === true;
  const position = jsonObject(rawCard.position);
  const fields: JsonObject = {
    ...(name ? { name } : {}),
    ...(cardCode ? { cardCode } : {}),
    ownerPlayerId,
    source: zone,
    exhausted,
    isPlaceholder: false,
    ...(rawCard.isFlipped === true ? { isFlipped: true } : {}),
    ...(rawCard.isHorizontal === true ? { isHorizontal: true } : {}),
    ...(rawCard.isSpun === true ? { isSpun: true } : {}),
    ...(integerValue(position?.index) >= 0 ? { positionIndex: integerValue(position?.index) } : {}),
    ...cardCounterFields(rawCard.counters),
  };
  const attachedRawId = textValue(rawCard.grouppedToId);
  if (attachedRawId) fields.attachedToCardId = opaqueCardId(capture, attachedRawId);
  return {
    id,
    name,
    ...(cardCode ? { cardCode } : {}),
    ownerPlayerId,
    source: zone,
    exhausted,
    isPlaceholder: false,
    fields,
  };
}

function normalizeChain(
  capture: TcgaReplayRawCaptureV1,
  rawOrder: JsonValue | undefined,
  cards: Map<string, ReplayCardState>,
): ReplayChainEntry[] {
  const orderedIds = arrayValue(rawOrder).map((value) => (
    typeof value === "string" ? value : textValue(jsonObject(value)?.id)
  )).filter(Boolean);
  const seen = new Set<string>();
  const result: ReplayChainEntry[] = [];
  for (const rawId of [...orderedIds, ...cards.keys()]) {
    if (seen.has(rawId)) continue;
    seen.add(rawId);
    const card = cards.get(rawId);
    if (!card) continue;
    result.push({
      id: stableId("tcga-chain", capture.capture.captureSessionId, rawId),
      fields: { card: toJsonObject(card) },
    });
  }
  return result;
}

function buildParticipants(
  capture: TcgaReplayRawCaptureV1,
  state: MutableProviderState,
  rawPlayerIds: string[],
  selectedBattlefields: Map<string, ReplayCardState>,
): ReplayParticipant[] {
  return rawPlayerIds.map((rawPlayerId, boardSeat) => {
    const rawPlayer = state.players.get(rawPlayerId) ?? {};
    const selected = selectedBattlefields.get(rawPlayerId);
    const identities = state.participantCards.get(rawPlayerId) ?? {};
    const turnOrderPosition = integerOrText(rawPlayer.turnOrderPosition);
    return {
      id: opaquePlayerId(capture, rawPlayerId),
      name: playerDisplayName(rawPlayer, rawPlayerId === capture.capture.identity.perspectivePlayerId),
      isPerspective: rawPlayerId === capture.capture.identity.perspectivePlayerId,
      seat: boardSeat,
      role: rawPlayerId === capture.capture.identity.perspectivePlayerId ? "viewer" : "opponent",
      fields: {
        provider: "tcga",
        ...(turnOrderPosition !== undefined ? { turnOrderPosition } : {}),
        ...(identities.legend ? { legend: publicCardReference(identities.legend, "legend") } : {}),
        ...(identities.champion ? { champion: publicCardReference(identities.champion, "champion") } : {}),
        ...(selected ? { selectedBattlefield: publicCardReference(selected) } : {}),
      },
    };
  });
}

function buildPhaseSegments(events: ReplayEvent[]): ReplayPhaseSegment[] {
  const phaseEvents = events.filter((event) => event.kind === "phase");
  return phaseEvents.map((event, index) => {
    if (event.kind !== "phase") throw new Error("Unexpected phase event");
    const next = phaseEvents[index + 1];
    const endEventIndex = Math.max(event.index, (next?.index ?? events.length) - 1);
    const endEvent = events[endEventIndex] ?? event;
    return {
      phase: event.phase,
      rawPhase: event.rawPhase,
      startEventIndex: event.index,
      endEventIndex,
      startedAtMs: event.atMs,
      endedAtMs: endEvent.atMs,
    };
  });
}

function normalizeHistoryEntry(input: {
  capture: TcgaReplayRawCaptureV1;
  history: JsonObject;
  message: TcgaReplayRawMessageV1;
  state: MutableProviderState;
}): ReplayLogEntry | undefined {
  const key = textValue(input.history.text);
  if (!/^play\.logs\.(?:game|player|card|deck|counter)/i.test(key)) return undefined;
  if (/(?:chat|emoji)/i.test(key)) return undefined;
  const rawAuthorId = textValue(input.history.playerId);
  const authorPlayerId = rawAuthorId ? opaquePlayerId(input.capture, rawAuthorId) : undefined;
  const authorName = rawAuthorId
    ? playerDisplayName(input.state.players.get(rawAuthorId) ?? {}, rawAuthorId === input.capture.capture.identity.perspectivePlayerId)
    : "A player";
  const historyParams = jsonObject(input.history.params);
  const mulliganRedrawCount = /mulligan\.drawAgainX/i.test(key)
    ? positiveInteger(historyParams?.count)
    : undefined;
  const mulliganCompleted = /mulligan\.complete/i.test(key);
  const text = safeHistoryLabel(key, authorName, input.state.general.turnCount, mulliganRedrawCount);
  const rawHistoryId = textValue(input.history.id);
  const id = stableId(
    "tcga-log",
    input.capture.capture.captureSessionId,
    rawHistoryId || input.message.completedTransportSequence,
    key,
  );
  return {
    id,
    at: input.message.ts,
    text,
    ...(authorPlayerId ? { authorPlayerId } : {}),
    fields: {
      provider: "tcga",
      ...(mulliganRedrawCount !== undefined ? { mulliganRedrawCount } : {}),
      ...(mulliganCompleted ? { mulliganCompleted: true } : {}),
    },
  };
}

function safeHistoryLabel(
  key: string,
  authorName: string,
  rawTurn: JsonValue | undefined,
  mulliganRedrawCount?: number,
): string {
  if (/turnStarted/i.test(key)) {
    const turn = positiveInteger(rawTurn);
    return turn === undefined ? "Turn started" : `Turn ${turn} started`;
  }
  if (mulliganRedrawCount !== undefined) {
    return `${authorName} replaced ${mulliganRedrawCount} ${mulliganRedrawCount === 1 ? "card" : "cards"}`;
  }
  if (/mulligan/i.test(key)) return `${authorName} completed a mulligan`;
  if (/player\.draw/i.test(key)) return `${authorName} drew a card`;
  if (/cardMove/i.test(key)) return `${authorName} moved a card`;
  if (/deck\.toBottom/i.test(key)) return `${authorName} moved a card to the bottom of their deck`;
  if (/card\.reveal/i.test(key)) return `${authorName} revealed a card`;
  if (/card\.hide/i.test(key)) return `${authorName} concealed a card`;
  if (/counterIncrease/i.test(key)) return `${authorName} increased a counter`;
  return key.replace(/^play\.logs\./i, "").replace(/[._-]+/g, " ").trim().slice(0, 160) || "Game update";
}

function historyValues(value: JsonValue | undefined): JsonObject[] {
  if (Array.isArray(value)) {
    const result: JsonObject[] = [];
    for (const entry of value) {
      const record = jsonObject(entry);
      if (record) result.push(record);
    }
    return result;
  }
  const record = jsonObject(value);
  return record ? [record] : [];
}

function orderedRawPlayerIds(capture: TcgaReplayRawCaptureV1, state: MutableProviderState): string[] {
  const perspective = capture.capture.identity.perspectivePlayerId;
  return [...state.players.keys()].sort((left, right) => {
    if (left === perspective) return -1;
    if (right === perspective) return 1;
    const leftSeat = integerValue(state.players.get(left)?.turnOrderPosition);
    const rightSeat = integerValue(state.players.get(right)?.turnOrderPosition);
    return leftSeat - rightSeat || left.localeCompare(right);
  });
}

function hasSelectedBattlefield(player: JsonObject): boolean {
  return arrayValue(player.visibleCards).some((value) => cardSection(jsonObject(value) ?? {}) === "Battlefields");
}

function cardSection(card: JsonObject): string {
  const section = jsonObject(card.position)?.section;
  if (section === false) return "false";
  return textValue(section);
}

function tcgaZone(section: string, previous: string | undefined): string {
  if (!section || section === "false") return previous || "unknown";
  switch (section.toLowerCase()) {
    case "b1": return "battlefieldA";
    case "b2": return "battlefieldB";
    case "base": return "base";
    case "battlefields": return "selectedBattlefield";
    case "banish":
    case "banished":
    case "exile":
    case "exiled": return "banished";
    case "chosen_champion": return "champion";
    case "discard": return "discard";
    case "exilehidden": return "removed";
    case "hand": return "hand";
    case "legend": return "legend";
    case "mana": return "runeArea";
    case "runes": return "runeDeck";
    case "sideboard": return "sideboard";
    case "stack": return "stack";
    default: return "unknown";
  }
}

type VisibleTcgaCard = {
  card: JsonObject;
  index: number;
  rawCardId: string;
};

function resolveVisibleCardZones(
  cards: VisibleTcgaCard[],
  lastZoneByCardId: Map<string, string>,
): Map<string, string> {
  const cardsById = new Map(cards.map((card) => [card.rawCardId, card]));
  const resolved = new Map<string, string>();
  const resolving = new Set<string>();

  const resolve = (entry: VisibleTcgaCard): string => {
    const existing = resolved.get(entry.rawCardId);
    if (existing) return existing;

    const section = cardSection(entry.card);
    const fallback = tcgaZone(section, lastZoneByCardId.get(entry.rawCardId));
    if (resolving.has(entry.rawCardId)) return fallback;
    resolving.add(entry.rawCardId);

    let zone = fallback;
    const parentRawId = textValue(entry.card.grouppedToId);
    const parent = parentRawId ? cardsById.get(parentRawId) : undefined;
    if ((!section || section === "false") && parent && parent.rawCardId !== entry.rawCardId) {
      const parentZone = resolve(parent);
      if (parentZone !== "unknown") zone = parentZone;
    }

    resolving.delete(entry.rawCardId);
    resolved.set(entry.rawCardId, zone);
    if (zone !== "unknown") lastZoneByCardId.set(entry.rawCardId, zone);
    return zone;
  };

  cards.forEach(resolve);
  return resolved;
}

function opaquePlayerId(capture: TcgaReplayRawCaptureV1, rawPlayerId: string): string {
  return stableId("tcga-player", capture.capture.captureSessionId, rawPlayerId);
}

function opaqueCardId(capture: TcgaReplayRawCaptureV1, rawCardId: string): string {
  return stableId("tcga-card", capture.capture.captureSessionId, rawCardId);
}

function providerCardId(card: JsonObject, ownerId: string, zone: string, index: number): string {
  return textValue(card.id) || stableId("provider-card", ownerId, zone, index, publicCardCode(jsonObject(card.cardData)?.id));
}

function canonicalPlayerReference(capture: TcgaReplayRawCaptureV1, value: JsonValue | undefined): string | undefined {
  if (typeof value === "string" && value) return opaquePlayerId(capture, value);
  const record = jsonObject(value);
  const rawId = textValue(record?.randomId) || textValue(record?.gameId);
  return rawId ? opaquePlayerId(capture, rawId) : undefined;
}

function playerScore(player: JsonObject): number | undefined {
  const firstCounter = jsonObject(arrayValue(player.playerCounters)[0]);
  const value = finiteNumber(firstCounter?.value);
  return value !== undefined ? value : undefined;
}

function playerDisplayName(player: JsonObject, perspective: boolean): string {
  const profile = jsonObject(player.profileData);
  const candidates = [
    profile?.pseudo,
    profile?.username,
    profile?.userName,
    profile?.displayName,
    profile?.playerName,
    jsonObject(profile?.preferences)?.pseudo,
    jsonObject(profile?.preferences)?.username,
    player.pseudo,
    player.username,
    player.playerName,
  ];
  const name = candidates.map(textValue).find(Boolean);
  return name?.slice(0, 80) || (perspective ? "You" : "Opponent");
}

function publicCardReference(card: ReplayCardState, source = "battlefield"): JsonObject {
  return {
    name: card.name,
    ...(card.cardCode ? { cardCode: card.cardCode } : {}),
    source,
  };
}

function publicCardCode(value: JsonValue | undefined): string {
  const code = textValue(value).toUpperCase();
  return /^[A-Z0-9]{2,8}-(?:R?\d{1,4})[A-Z]?$/.test(code) ? code : "";
}

function localizedName(value: JsonValue | undefined): string {
  if (typeof value === "string") return value.trim().slice(0, 120);
  const record = jsonObject(value);
  for (const key of ["en", "en_US", "en-GB", "fr"]) {
    const name = textValue(record?.[key]);
    if (name) return name.slice(0, 120);
  }
  return "";
}

function cardCounterFields(value: JsonValue | undefined): JsonObject {
  const result: JsonObject = {};
  const record = jsonObject(value);
  if (record) {
    const white = finiteNumber(record.white ?? record.whiteCounter);
    const red = finiteNumber(record.red ?? record.redCounter);
    if (white !== undefined) result.whiteCounter = white;
    if (red !== undefined) result.redCounter = red;
  }
  arrayValue(value).forEach((entry, index) => {
    const counter = jsonObject(entry);
    const label = textValue(counter?.name ?? counter?.label ?? counter?.color).toLowerCase();
    const count = finiteNumber(counter?.value ?? counter?.count);
    if (count === undefined) return;
    if (label.includes("white")) {
      result.whiteCounter = count;
      return;
    }
    if (label.includes("red")) {
      result.redCounter = count;
      return;
    }
    // TCGA's Riftbound format exposes its two UI counter slots positionally,
    // without labels or colours. Preserve that stable slot order in the two
    // canonical counter fields already rendered by the shared replay player.
    if (index === 0) result.whiteCounter = count;
    if (index === 1) result.redCounter = count;
  });
  return result;
}

function sourceMessageId(capture: TcgaReplayRawCaptureV1, message: TcgaReplayRawMessageV1): string {
  return stableId(
    "tcga-message",
    capture.capture.captureSessionId,
    message.completedTransportSequence,
    message.firstTransportSequence,
    message.seq,
  );
}

function eventClock(timestamp: number, origin: number, previousAt: number): EventClock {
  const at = Math.max(previousAt, timestamp > 0 ? timestamp : previousAt);
  return { at, atMs: Math.max(0, at - origin) };
}

function cloneLog(log: ReplayLogEntry): ReplayLogEntry {
  return { ...log, fields: { ...log.fields } };
}

function jsonObject(value: unknown): JsonObject | null {
  return isRecord(value) ? toJsonObject(value) : null;
}

function arrayValue(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integerValue(value: unknown): number {
  const number = finiteNumber(value);
  return number === undefined ? -1 : Math.trunc(number);
}

function positionedCardIndex(card: ReplayCardState): number {
  const index = integerValue(card.fields.positionIndex);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function positiveInteger(value: unknown): number | undefined {
  const number = integerValue(value);
  return number >= 0 ? number : undefined;
}

function integerOrText(value: JsonValue | undefined): number | string | undefined {
  const integer = integerValue(value);
  if (integer >= 0) return integer;
  const text = textValue(value);
  return text || undefined;
}
