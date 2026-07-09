import { integerValue, isRecord, stringValue, toJsonObject } from "@/lib/replay-v2/json";
import {
  collectParticipants,
  normalizeChatEntries,
  normalizePatchOperations,
  normalizeLogEntries,
  normalizeSeriesFormat,
  normalizeSnapshot,
  observeGamePacket,
} from "@/lib/replay-v2/normalization";
import { stableId } from "@/lib/replay-v2/stable-id";
import { inferPerspectivePlayerId, sanitizeActionForPerspective, sanitizeUnknownPayload } from "@/lib/replay-v2/perspective";
import type {
  CanonicalReplayV2,
  JsonObject,
  ParsedRawCapture,
  ParsedReplayPacket,
  ReplayActionEvent,
  ReplayDiagnostic,
  ReplayEvent,
  ReplayGame,
  ReplayGameBoundaryEvent,
  ReplayParticipant,
  ReplayInteractionEvent,
  ReplayChatEvent,
  ReplayLogEvent,
  ReplayPhase,
  ReplayPhaseEvent,
  ReplaySnapshotEvent,
  ReplaySeriesFormat,
  ReplayUnknownEvent,
} from "@/lib/replay-v2/types";

type IntentRecord = {
  packet: ParsedReplayPacket;
  action: JsonObject;
  actionType: string;
  actorPlayerId: string;
  clientActionId: string;
};

type MutableGame = ReplayGame & {
  currentPhase: ReplayPhase;
  seenInGame: boolean;
};

export const RIFTBOUND_TERMINAL_SCORE = 8;

export function deriveCanonicalReplay(parsed: ParsedRawCapture): CanonicalReplayV2 {
  const events: ReplayEvent[] = [];
  const unknownEvents: ReplayUnknownEvent[] = [];
  const diagnostics: ReplayDiagnostic[] = [...parsed.diagnostics];
  const participants = new Map<string, ReplayParticipant>();
  const games: ReplayGame[] = [];
  const format = inferSeriesFormat(parsed);
  const perspectivePlayerId = inferPerspectivePlayerId(parsed);
  const packets = rebasePacketsForTimeline(parsed.packets);
  const intents = collectIntents(packets);
  const correlations = correlateIntents(packets, intents);
  const matchedIntentIds = new Set(correlations.values());
  const compactedPackets = new Map<string, number>();
  let currentGame: MutableGame | null = null;
  let currentScores = new Map<string, number>();
  let lastScoreEventId = "";
  let observedPostgameSignal = false;

  const append = <TEvent extends ReplayEvent>(event: Omit<TEvent, "index">): TEvent => {
    const withIndex = { ...event, index: events.length } as TEvent;
    events.push(withIndex);
    if (withIndex.kind === "unknown") unknownEvents.push(withIndex);
    return withIndex;
  };

  const closePhase = (game: MutableGame, endEventIndex: number, endedAtMs: number) => {
    const phase = game.phases.at(-1);
    if (!phase) return;
    phase.endEventIndex = Math.max(phase.startEventIndex, endEventIndex);
    phase.endedAtMs = Math.max(phase.startedAtMs, endedAtMs);
  };

  const startGame = (
    packet: ParsedReplayPacket,
    explicitGameNumber: number | undefined,
    reason: ReplayGameBoundaryEvent["reason"],
  ) => {
    const ordinal = games.length + 1;
    const gameNumber = explicitGameNumber ?? ordinal;
    const id = stableId("game", parsed.seriesIdentity, ordinal, gameNumber);
    const game: MutableGame = {
      id,
      ordinal,
      gameNumber,
      sourceIdentity: {
        explicitGameNumber: explicitGameNumber !== undefined,
        gameInstanceIds: [],
      },
      startedAt: packet.at,
      endedAt: packet.at,
      startedAtMs: packet.atMs,
      endedAtMs: packet.atMs,
      eventStartIndex: events.length,
      eventEndIndex: events.length,
      phases: [],
      currentPhase: "unknown",
      seenInGame: false,
    };
    games.push(game);
    currentScores = new Map();
    lastScoreEventId = "";
    observedPostgameSignal = false;
    append<ReplayGameBoundaryEvent>({
      id: stableId("event", packet.id, "game_start", ordinal),
      kind: "game_boundary",
      at: packet.at,
      atMs: packet.atMs,
      sourceMessageId: packet.id,
      gameId: id,
      boundary: "start",
      gameOrdinal: ordinal,
      gameNumber,
      reason,
    });
    return game;
  };

  const finishGame = (
    packet: ParsedReplayPacket,
    reason: ReplayGameBoundaryEvent["reason"],
    resultEventId?: string,
    result?: { winnerPlayerId?: string; loserPlayerId?: string; finalScores?: Record<string, number> },
  ) => {
    const game = currentGame;
    if (!game) return null;
    if (resultEventId) {
      game.sourceIdentity.resultEventId = resultEventId;
      game.result = {
        resultEventId,
        ...(result?.winnerPlayerId ? { winnerPlayerId: result.winnerPlayerId } : {}),
        ...(result?.loserPlayerId ? { loserPlayerId: result.loserPlayerId } : {}),
        ...(result?.finalScores ? { finalScores: result.finalScores } : {}),
      };
    }
    const boundary = append<ReplayGameBoundaryEvent>({
      id: stableId("event", packet.id, "game_end", game.ordinal, reason, resultEventId),
      kind: "game_boundary",
      at: packet.at,
      atMs: packet.atMs,
      sourceMessageId: packet.id,
      gameId: game.id,
      boundary: "end",
      gameOrdinal: game.ordinal,
      gameNumber: game.gameNumber,
      reason,
    });
    closePhase(game, boundary.index, boundary.atMs);
    game.endedAt = packet.at;
    game.endedAtMs = packet.atMs;
    game.eventEndIndex = boundary.index;
    deleteMutableFields(game);
    return null;
  };

  for (const packet of packets) {
    collectParticipants(packet, perspectivePlayerId).forEach((participant) => mergeParticipant(participants, participant));
    const observation = observeGamePacket(packet);
    observedPostgameSignal ||= Boolean(
      currentGame &&
      (
        observation.phase === "game_end" ||
        observation.phase === "series_end" ||
        (observation.phase === "lobby" && currentGame.seenInGame) ||
        packet.packetType === "room_shell_leave"
      )
    );
    const isReplayPacket =
      packet.packetType === "authoritative_snapshot" ||
      packet.packetType === "authoritative_patch_commit" ||
      isGamePhase(observation.phase);

    if (currentGame && observation.explicitGameNumber !== undefined && observation.explicitGameNumber !== currentGame.gameNumber) {
      currentGame = finishGame(packet, "explicit_game_number");
    } else if (
      currentGame &&
      observation.phase &&
      startsFollowingGame(observation.phase, currentGame, format)
    ) {
      const priorOrdinal = currentGame.ordinal;
      currentGame = finishGame(packet, "phase_rollover");
      diagnostics.push({
        id: stableId("diagnostic", packet.id, "inferred_game_rollover", priorOrdinal),
        severity: "info",
        code: "inferred_game_rollover",
        message: "A new game was inferred from a post-game setup phase because no explicit game number was present.",
        sourceMessageId: packet.id,
      });
    }

    if (!currentGame && isReplayPacket && observation.phase !== "series_end" && observation.phase !== "game_end") {
      currentGame = startGame(
        packet,
        observation.explicitGameNumber,
        games.length ? (observation.explicitGameNumber !== undefined ? "explicit_game_number" : "phase_rollover") : "series_start",
      );
    }

    if (currentGame && observation.gameInstanceId && !currentGame.sourceIdentity.gameInstanceIds.includes(observation.gameInstanceId)) {
      currentGame.sourceIdentity.gameInstanceIds.push(observation.gameInstanceId);
    }

    let resultEventId = "";
    if (observation.rawPhase && currentGame && observation.phase !== currentGame.currentPhase) {
      const phaseEvent = appendPhaseEvent(packet, observation.phase ?? "unknown", observation.rawPhase, currentGame, append, closePhase);
      resultEventId = phaseEvent.id;
    }

    switch (packet.packetType) {
      case "room_shell_sync":
        break;
      case "authoritative_snapshot": {
        const snapshotPayload = isRecord(packet.payload?.snapshot) ? packet.payload.snapshot : {};
        const snapshot = normalizeSnapshot(
          snapshotPayload,
          packet.id,
          currentGame?.gameNumber ?? observation.explicitGameNumber ?? 1,
          perspectivePlayerId,
        );
        const event = append<ReplaySnapshotEvent>({
          id: stableId("event", packet.id, "snapshot"),
          kind: "snapshot" as const,
          at: packet.at,
          atMs: packet.atMs,
          sourceMessageId: packet.id,
          gameId: currentGame?.id ?? null,
          ...(integerValue(packet.payload?.sequence) !== undefined ? { sequence: integerValue(packet.payload?.sequence) } : {}),
          snapshot,
        });
        Object.values(snapshot.players).forEach((player) => {
          if (player.score !== undefined) currentScores.set(player.id, player.score);
        });
        if (Object.keys(snapshot.players).length) lastScoreEventId = event.id;
        resultEventId ||= event.id;
        break;
      }
      case "authoritative_patch_commit": {
        const actionEvent = appendActionEvent(packet, currentGame, correlations, intents, perspectivePlayerId, append);
        actionEvent.patch.operations.forEach((operation) => {
          if (operation.op !== "set_board_fields") return;
          const score = typeof operation.fields.score === "number" && Number.isFinite(operation.fields.score)
            ? operation.fields.score
            : undefined;
          if (score !== undefined) {
            currentScores.set(operation.playerId, score);
            lastScoreEventId = actionEvent.id;
          }
        });
        resultEventId = actionEvent.id;
        const { unknownOperations } = normalizePatchOperations(packet, perspectivePlayerId);
        unknownOperations.forEach((operation, operationIndex) => {
          const event = appendUnknown(
            packet,
            currentGame?.id ?? null,
            "unknown_patch_operation",
            operation,
            `patch-${operationIndex}`,
            append,
          );
          diagnostics.push({
            id: stableId("diagnostic", event.id, "unknown_patch_operation"),
            severity: "warning",
            code: "unknown_patch_operation",
            message: `Patch operation ${operation.sourceOp} is preserved but is not projected yet.`,
            sourceMessageId: packet.id,
            eventId: event.id,
          });
        });
        break;
      }
      case "action_intent": {
        const intent = intents.get(packet.id);
        if (intent && !matchedIntentIds.has(packet.id)) {
          const event = appendUnknown(
            packet,
            currentGame?.id ?? null,
            "unconfirmed_intent",
            sanitizeUnknownPayload(packet.payload),
            "unconfirmed-intent",
            append,
          );
          diagnostics.push({
            id: stableId("diagnostic", event.id, "unconfirmed_intent"),
            severity: "warning",
            code: "unconfirmed_intent",
            message: `Action intent ${intent.actionType || "unknown"} had no authoritative patch commit and was not applied.`,
            sourceMessageId: packet.id,
            eventId: event.id,
          });
        }
        break;
      }
      case "chat_append": {
        const entries = normalizeChatEntries(packet.payload?.entry ? [packet.payload.entry] : [], packet.id);
        append<ReplayChatEvent>({
          id: stableId("event", packet.id, "chat_append"),
          kind: "chat" as const,
          at: packet.at,
          atMs: packet.atMs,
          sourceMessageId: packet.id,
          gameId: currentGame?.id ?? null,
          mode: "append" as const,
          entries,
        });
        break;
      }
      case "chat_sync": {
        const entries = normalizeChatEntries(packet.payload?.chatEntries, packet.id);
        append<ReplayChatEvent>({
          id: stableId("event", packet.id, "chat_sync"),
          kind: "chat" as const,
          at: packet.at,
          atMs: packet.atMs,
          sourceMessageId: packet.id,
          gameId: currentGame?.id ?? null,
          mode: "replace" as const,
          entries,
        });
        break;
      }
      case "setup_log_sync": {
        append<ReplayLogEvent>({
          id: stableId("event", packet.id, "setup_log_sync"),
          kind: "log" as const,
          at: packet.at,
          atMs: packet.atMs,
          sourceMessageId: packet.id,
          gameId: currentGame?.id ?? null,
          mode: "replace" as const,
          entries: normalizeLogEntries(packet.payload?.log, packet.id),
        });
        break;
      }
      case "presence_event": {
        const presenceEvent = isRecord(packet.payload?.event) ? packet.payload.event : {};
        const interactionType = stringValue(presenceEvent.type);
        if (interactionType === "card_ping" || interactionType === "board_emote") {
          append<ReplayInteractionEvent>({
            id: stableId("event", packet.id, interactionType),
            kind: "interaction",
            at: packet.at,
            atMs: packet.atMs,
            sourceMessageId: packet.id,
            gameId: currentGame?.id ?? null,
            interactionType,
            ...(stringValue(presenceEvent.playerId) ? { actorPlayerId: stringValue(presenceEvent.playerId) } : {}),
            ...(stringValue(presenceEvent.pingedCardId) ? { cardId: stringValue(presenceEvent.pingedCardId) } : {}),
            ...(stringValue(presenceEvent.emoteId) ? { emoteId: stringValue(presenceEvent.emoteId) } : {}),
            payload: toJsonObject(sanitizeUnknownPayload(presenceEvent)),
          });
        } else {
          incrementCount(compactedPackets, `presence_event:${interactionType || "unknown"}`);
        }
        break;
      }
      case "presence_update":
      case "spectator_roster_sync":
      case "join_shell":
      case "join_game":
      case "search":
      case "searching":
      case "matched":
      case "chat_send":
      case "room_shell_leave":
        incrementCount(compactedPackets, packet.packetType);
        break;
      case "malformed":
        appendUnknown(
          packet,
          currentGame?.id ?? null,
          "malformed_packet",
          { rawLength: packet.raw.length, rawDigest: stableId("raw", packet.raw) },
          "malformed",
          append,
        );
        break;
      default:
        appendUnknown(
          packet,
          currentGame?.id ?? null,
          "unsupported_packet",
          sanitizeUnknownPayload(packet.payload),
          "unsupported",
          append,
        );
        break;
    }

    if (currentGame) {
      currentGame.endedAt = packet.at;
      currentGame.endedAtMs = packet.atMs;
      currentGame.eventEndIndex = Math.max(currentGame.eventStartIndex, events.length - 1);
    }
    if (currentGame && observation.explicitResult) {
      currentGame = finishGame(
        packet,
        "explicit_result",
        resultEventId || events.at(-1)?.id,
        {
          ...observation,
          ...(observation.finalScores ? {} : { finalScores: Object.fromEntries(currentScores) }),
        },
      );
    }
  }

  if (currentGame) {
    const lastPacket = packets.at(-1) ?? syntheticEndPacket(parsed);
    const lifecycleEnd = captureHasEndOfMatchBoundary(parsed);
    const safeResult = observedPostgameSignal || lifecycleEnd
      ? terminalScoreResult(currentScores, lastScoreEventId)
      : null;
    if (safeResult) {
      currentGame = finishGame(lastPacket, "terminal_score", safeResult.resultEventId, safeResult);
      diagnostics.push({
        id: stableId("diagnostic", safeResult.resultEventId, "derived_terminal_score"),
        severity: "info",
        code: "derived_terminal_score",
        message: `The winner was derived from an authoritative terminal score of at least ${RIFTBOUND_TERMINAL_SCORE} after an end-of-match transition.`,
        eventId: safeResult.resultEventId,
      });
    } else {
      currentGame = finishGame(lastPacket, "capture_end");
      if ((observedPostgameSignal || lifecycleEnd) && currentScores.size) {
        diagnostics.push({
          id: stableId("diagnostic", parsed.captureId, "terminal_result_unknown", Object.fromEntries(currentScores)),
          severity: "warning",
          code: "terminal_result_unknown",
          message: "The capture ended after gameplay, but no explicit result or rules-safe terminal score was present; the winner remains unknown.",
          sourceMessageId: lastPacket.id,
        });
      }
    }
  }

  const compactedTotal = [...compactedPackets.values()].reduce((sum, count) => sum + count, 0);
  if (compactedTotal) {
    const summary = [...compactedPackets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([type, count]) => `${type}=${count}`)
      .join(", ");
    diagnostics.push({
      id: stableId("diagnostic", parsed.captureId, "compacted_ephemeral_packets", summary),
      severity: "info",
      code: "compacted_ephemeral_packets",
      message: `Compacted ${compactedTotal} non-state transport/presence packets (${summary}).`,
    });
  }

  const seriesStart = games[0]?.startedAt ?? parsed.startedAt;
  const seriesEnd = games.at(-1)?.endedAt ?? parsed.endedAt;
  const replayId = stableId("replay", parsed.captureId, parsed.seriesIdentity);
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: replayId,
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: parsed.captureId,
      roomCode: parsed.roomCode,
      startedAt: parsed.startedAt,
      endedAt: parsed.endedAt,
      messageCount: parsed.packets.length,
    },
    series: {
      id: parsed.seriesIdentity,
      ...(perspectivePlayerId ? { perspectivePlayerId } : {}),
      format,
      bestOf: format === "bo1" ? 1 : format === "bo3" ? 3 : null,
      roomCode: parsed.roomCode,
      startedAt: seriesStart,
      endedAt: seriesEnd,
      participants: [...participants.values()].sort(compareParticipants),
      games,
    },
    events,
    unknownEvents,
    diagnostics,
    checkpoints: [],
  };
}

function appendPhaseEvent(
  packet: ParsedReplayPacket,
  phase: ReplayPhase,
  rawPhase: string,
  game: MutableGame,
  append: <TEvent extends ReplayEvent>(event: Omit<TEvent, "index">) => TEvent,
  closePhase: (game: MutableGame, endEventIndex: number, endedAtMs: number) => void,
): ReplayPhaseEvent {
  const event = append<ReplayPhaseEvent>({
    id: stableId("event", packet.id, "phase", phase, game.ordinal),
    kind: "phase",
    at: packet.at,
    atMs: packet.atMs,
    sourceMessageId: packet.id,
    gameId: game.id,
    phase,
    rawPhase,
    gameNumber: game.gameNumber,
  });
  closePhase(game, Math.max(game.eventStartIndex, event.index - 1), event.atMs);
  game.currentPhase = phase;
  game.seenInGame ||= phase === "in_game";
  game.phases.push({
    phase,
    rawPhase,
    startEventIndex: event.index,
    endEventIndex: event.index,
    startedAtMs: event.atMs,
    endedAtMs: event.atMs,
  });
  return event;
}

function appendActionEvent(
  packet: ParsedReplayPacket,
  game: MutableGame | null,
  correlations: Map<string, string>,
  intents: Map<string, IntentRecord>,
  perspectivePlayerId: string,
  append: <TEvent extends ReplayEvent>(event: Omit<TEvent, "index">) => TEvent,
): ReplayActionEvent {
  const payload = packet.payload ?? {};
  const action = isRecord(payload.action) ? payload.action : {};
  const intentId = correlations.get(packet.id);
  const intent = intentId ? intents.get(intentId) : undefined;
  const clientActionId = stringValue(payload.clientActionId) || intent?.clientActionId || "";
  const actionType = stringValue(action.type) || intent?.actionType || "unknown_action";
  const actorPlayerId =
    stringValue(payload.actorPlayerId) ||
    stringValue(action.actorPlayerId) ||
    intent?.actorPlayerId ||
    "";
  const normalizedAction = sanitizeActionForPerspective(action, actorPlayerId, perspectivePlayerId);
  const { operations } = normalizePatchOperations(packet, perspectivePlayerId);
  const latencyMs = intent ? Math.max(0, packet.at - intent.packet.at) : undefined;
  return append<ReplayActionEvent>({
    id: stableId("event", packet.id, "action", actionType, clientActionId),
    kind: "action",
    at: packet.at,
    atMs: packet.atMs,
    sourceMessageId: packet.id,
    gameId: game?.id ?? null,
    actionType,
    ...(actorPlayerId ? { actorPlayerId } : {}),
    action: normalizedAction,
    confirmation: {
      status: "confirmed",
      authority: "authoritative_patch_commit",
      correlation: intent ? "matched_intent" : "intent_not_observed",
      ...(clientActionId ? { clientActionId } : {}),
      ...(intent ? { intentMessageId: intent.packet.id } : {}),
      commitMessageId: packet.id,
      ...(latencyMs !== undefined ? { latencyMs } : {}),
    },
    patch: {
      ...(integerValue(payload.baseSequence) !== undefined ? { baseSequence: integerValue(payload.baseSequence) } : {}),
      ...(integerValue(payload.sequence) !== undefined ? { sequence: integerValue(payload.sequence) } : {}),
      operations,
    },
  });
}

function appendUnknown(
  packet: ParsedReplayPacket,
  gameId: string | null,
  reason: ReplayUnknownEvent["reason"],
  payload: unknown,
  suffix: string,
  append: <TEvent extends ReplayEvent>(event: Omit<TEvent, "index">) => TEvent,
): ReplayUnknownEvent {
  const normalized = sanitizeUnknownPayload(payload);
  return append<ReplayUnknownEvent>({
    id: stableId("event", packet.id, "unknown", reason, suffix),
    kind: "unknown",
    at: packet.at,
    atMs: packet.atMs,
    sourceMessageId: packet.id,
    gameId,
    packetType: packet.packetType,
    reason,
    payload: normalized,
  });
}

function collectIntents(packets: ParsedReplayPacket[]): Map<string, IntentRecord> {
  const intents = new Map<string, IntentRecord>();
  for (const packet of packets) {
    if (packet.packetType !== "action_intent" || !packet.payload) continue;
    const action = isRecord(packet.payload.action) ? packet.payload.action : {};
    intents.set(packet.id, {
      packet,
      action: toJsonObject(action),
      actionType: stringValue(action.type),
      actorPlayerId: stringValue(packet.payload.actorPlayerId) || stringValue(action.actorPlayerId),
      clientActionId: stringValue(packet.payload.clientActionId),
    });
  }
  return intents;
}

function correlateIntents(
  packets: ParsedReplayPacket[],
  intents: Map<string, IntentRecord>,
): Map<string, string> {
  const byClientId = new Map<string, IntentRecord[]>();
  intents.forEach((intent) => {
    if (!intent.clientActionId) return;
    const list = byClientId.get(intent.clientActionId) ?? [];
    list.push(intent);
    byClientId.set(intent.clientActionId, list);
  });
  byClientId.forEach((list) => list.sort((left, right) => left.packet.order - right.packet.order));

  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const packet of packets) {
    if (packet.packetType !== "authoritative_patch_commit" || !packet.payload) continue;
    const clientActionId = stringValue(packet.payload.clientActionId);
    if (!clientActionId) continue;
    const commitAction = isRecord(packet.payload.action) ? stringValue(packet.payload.action.type) : "";
    const candidates = (byClientId.get(clientActionId) ?? []).filter(
      (intent) =>
        !used.has(intent.packet.id) &&
        intent.packet.order <= packet.order &&
        (!commitAction || !intent.actionType || commitAction === intent.actionType),
    );
    const match = candidates.at(-1);
    if (!match) continue;
    used.add(match.packet.id);
    result.set(packet.id, match.packet.id);
  }
  return result;
}

function inferSeriesFormat(parsed: ParsedRawCapture): ReplaySeriesFormat {
  for (const packet of parsed.packets) {
    const payload = packet.payload ?? {};
    const sessionDoc = isRecord(payload.sessionDoc) ? payload.sessionDoc : null;
    const snapshot = isRecord(payload.snapshot) ? payload.snapshot : null;
    const values = [sessionDoc?.matchFormat, snapshot?.matchFormat, payload.matchFormat];
    for (const value of values) {
      const format = normalizeSeriesFormat(value);
      if (format !== "unknown") return format;
    }
  }
  const capture = parsed.source.capture;
  const lifecycle = isRecord(capture?.lifecycle) ? capture.lifecycle : null;
  return normalizeSeriesFormat(lifecycle?.matchFormat);
}

function rebasePacketsForTimeline(packets: ParsedReplayPacket[]): ParsedReplayPacket[] {
  const origin = packets.find((packet) => {
    const observation = observeGamePacket(packet);
    return (
      isGamePhase(observation.phase) ||
      packet.packetType === "room_shell_sync" ||
      packet.packetType === "authoritative_snapshot" ||
      packet.packetType === "authoritative_patch_commit" ||
      packet.packetType === "action_intent"
    );
  })?.at ?? packets[0]?.at ?? 0;
  let previousAtMs = 0;
  return packets.map((packet) => {
    const atMs = Math.max(previousAtMs, Math.max(0, packet.at - origin));
    previousAtMs = atMs;
    return { ...packet, atMs };
  });
}

function startsFollowingGame(phase: ReplayPhase, game: MutableGame, format: ReplaySeriesFormat): boolean {
  if (format === "bo1") return false;
  if (!game.seenInGame) return false;
  return ["sideboarding", "battlefield_pick", "initiative_roll", "first_player_choice", "mulligan"].includes(phase);
}

function incrementCount(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function captureHasEndOfMatchBoundary(parsed: ParsedRawCapture) {
  const lifecycle = parsed.source.capture?.lifecycle;
  const boundaries = isRecord(lifecycle) && Array.isArray(lifecycle.boundaries) ? lifecycle.boundaries : [];
  return boundaries.some((boundary) =>
    isRecord(boundary) && /(?:end[-_ ]of[-_ ]match|match[-_ ]end|series[-_ ]end)/i.test(stringValue(boundary.reason)),
  );
}

function terminalScoreResult(scores: Map<string, number>, resultEventId: string) {
  if (!resultEventId || !scores.size) return null;
  const sorted = [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const winner = sorted[0];
  if (!winner || winner[1] < RIFTBOUND_TERMINAL_SCORE || sorted[1]?.[1] === winner[1]) return null;
  return {
    resultEventId,
    winnerPlayerId: winner[0],
    ...(sorted[1] ? { loserPlayerId: sorted[1][0] } : {}),
    finalScores: Object.fromEntries(scores),
  };
}

function isGamePhase(phase: ReplayPhase | undefined): boolean {
  return Boolean(phase && !["unknown", "lobby", "series_end"].includes(phase));
}

function mergeParticipant(target: Map<string, ReplayParticipant>, value: ReplayParticipant) {
  const existing = target.get(value.id);
  if (!existing) {
    target.set(value.id, value);
    return;
  }
  target.set(value.id, {
    ...existing,
    ...value,
    name: value.name || existing.name,
    isPerspective: existing.isPerspective || value.isPerspective,
    fields: { ...existing.fields, ...value.fields },
  });
}

function compareParticipants(left: ReplayParticipant, right: ReplayParticipant) {
  if (left.isPerspective !== right.isPerspective) return left.isPerspective ? -1 : 1;
  const leftSeat = typeof left.seat === "number" ? left.seat : Number.MAX_SAFE_INTEGER;
  const rightSeat = typeof right.seat === "number" ? right.seat : Number.MAX_SAFE_INTEGER;
  return leftSeat - rightSeat || left.id.localeCompare(right.id);
}

function deleteMutableFields(game: MutableGame) {
  const finalized = game as Partial<MutableGame>;
  delete finalized.currentPhase;
  delete finalized.seenInGame;
}

function syntheticEndPacket(parsed: ParsedRawCapture): ParsedReplayPacket {
  return {
    id: stableId("packet", parsed.captureId, "capture_end"),
    order: parsed.packets.length,
    sourceIndex: parsed.packets.length,
    seq: parsed.packets.length,
    at: parsed.endedAt,
    atMs: Math.max(0, parsed.endedAt - parsed.startedAt),
    direction: "unknown",
    packetType: "capture_end",
    payload: null,
    raw: "",
  };
}
