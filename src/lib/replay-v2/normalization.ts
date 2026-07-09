import {
  booleanValue,
  finiteNumber,
  integerValue,
  isRecord,
  redactSecrets,
  stringValue,
} from "@/lib/replay-v2/json";
import { stableId } from "@/lib/replay-v2/stable-id";
import { sanitizeUnknownPayload, stripHiddenParticipantFields } from "@/lib/replay-v2/perspective";
import type {
  JsonObject,
  JsonValue,
  ParsedReplayPacket,
  ReplayCardState,
  ReplayChainEntry,
  ReplayChatEntry,
  ReplayLogEntry,
  ReplayParticipant,
  ReplayPatchOperation,
  ReplayPhase,
  ReplayPlayerState,
  ReplaySeriesFormat,
  ReplaySnapshot,
} from "@/lib/replay-v2/types";

const ZONE_KEYS = new Set([
  "deck",
  "hand",
  "base",
  "trash",
  "discard",
  "banished",
  "battlefieldA",
  "battlefieldB",
  "battlefieldToken",
  "champion",
  "legend",
  "runeDeck",
  "runeArea",
  "sideboard",
  "removed",
]);

const RESULT_ACTION_TYPES = new Set([
  "game_result",
  "game_end",
  "confirm_winner",
  "report_result",
  "concede",
]);

export type GameObservation = {
  phase?: ReplayPhase;
  rawPhase?: string;
  explicitGameNumber?: number;
  gameInstanceId?: string;
  explicitResult: boolean;
  winnerPlayerId?: string;
  loserPlayerId?: string;
  finalScores?: Record<string, number>;
};

export function normalizeReplayPhase(value: unknown): { phase: ReplayPhase; rawPhase: string } {
  const rawPhase = stringValue(value);
  const normalized = rawPhase.toLowerCase().replace(/[\s-]+/g, "_");
  const phase: ReplayPhase = (() => {
    if (!normalized) return "unknown";
    if (["lobby", "searching", "matched", "waiting"].includes(normalized)) return "lobby";
    if (["matchup", "versus", "intro"].includes(normalized)) return "matchup";
    if (["sideboard", "sideboarding", "deck_select", "deck_selection"].includes(normalized)) return "sideboarding";
    if (["battlefield", "battlefield_pick", "battlefield_select", "select_battlefield"].includes(normalized)) {
      return "battlefield_pick";
    }
    if (["initiative", "initiative_roll", "roll_initiative"].includes(normalized)) return "initiative_roll";
    if (["first_player", "first_player_choice", "choose_first_player"].includes(normalized)) {
      return "first_player_choice";
    }
    if (["mulligan", "mulligans"].includes(normalized)) return "mulligan";
    if (["in_game", "game", "playing", "gameplay"].includes(normalized)) return "in_game";
    if (["game_end", "game_over", "post_game", "result", "results"].includes(normalized)) return "game_end";
    if (["series_end", "match_end", "match_over", "complete", "completed"].includes(normalized)) return "series_end";
    return "unknown";
  })();
  return { phase, rawPhase };
}

export function normalizeSeriesFormat(value: unknown): ReplaySeriesFormat {
  const normalized = stringValue(value).toLowerCase().replace(/[\s_-]+/g, "");
  if (["bo1", "bestof1", "bestofone"].includes(normalized)) return "bo1";
  if (["bo3", "bestof3", "bestofthree"].includes(normalized)) return "bo3";
  return "unknown";
}

export function observeGamePacket(packet: ParsedReplayPacket): GameObservation {
  const payload = packet.payload ?? {};
  const sessionDoc = isRecord(payload.sessionDoc) ? payload.sessionDoc : null;
  const snapshot = isRecord(payload.snapshot) ? payload.snapshot : null;
  const action = isRecord(payload.action) ? payload.action : null;
  const operations = patchOperations(payload);
  const roomFieldSources = operations
    .filter((operation) => stringValue(operation.op) === "set_room_fields")
    .map((operation) => (isRecord(operation.fields) ? operation.fields : {}));
  const sources = [sessionDoc, snapshot, payload, action, ...roomFieldSources].filter(isRecord);

  let rawPhase = "";
  let explicitGameNumber: number | undefined;
  let winnerPlayerId = "";
  let loserPlayerId = "";
  let finalScores: Record<string, number> | undefined;
  for (const source of sources) {
    rawPhase = stringValue(source.phase) || rawPhase;
    explicitGameNumber =
      integerValue(source.gameNumber) ?? integerValue(source.game_number) ?? explicitGameNumber;
    winnerPlayerId =
      stringValue(source.winnerPlayerId) ||
      stringValue(source.gameWinnerPlayerId) ||
      stringValue(source.winnerId) ||
      winnerPlayerId;
    loserPlayerId =
      stringValue(source.loserPlayerId) ||
      stringValue(source.gameLoserPlayerId) ||
      stringValue(source.loserId) ||
      loserPlayerId;
    finalScores = scoresFromUnknown(source.finalScores) ?? scoresFromUnknown(source.scoresByPlayerId) ?? finalScores;
  }

  const normalizedPhase = normalizeReplayPhase(rawPhase);
  const actionType = stringValue(action?.type).toLowerCase();
  const explicitResult =
    normalizedPhase.phase === "game_end" ||
    normalizedPhase.phase === "series_end" ||
    RESULT_ACTION_TYPES.has(actionType) ||
    Boolean(winnerPlayerId);

  return {
    ...(rawPhase ? normalizedPhase : {}),
    ...(explicitGameNumber !== undefined && explicitGameNumber > 0 ? { explicitGameNumber } : {}),
    ...(stringValue(payload.gameInstanceId) ? { gameInstanceId: stringValue(payload.gameInstanceId) } : {}),
    explicitResult,
    ...(winnerPlayerId ? { winnerPlayerId } : {}),
    ...(loserPlayerId ? { loserPlayerId } : {}),
    ...(finalScores ? { finalScores } : {}),
  };
}

export function collectParticipants(packet: ParsedReplayPacket, perspectivePlayerId = ""): ReplayParticipant[] {
  const payload = packet.payload ?? {};
  const values: unknown[] = [];
  const sessionDoc = isRecord(payload.sessionDoc) ? payload.sessionDoc : null;
  const snapshot = isRecord(payload.snapshot) ? payload.snapshot : null;
  if (sessionDoc) {
    if (sessionDoc.selfPlayer) values.push(sessionDoc.selfPlayer);
    if (Array.isArray(sessionDoc.publicPlayers)) values.push(...sessionDoc.publicPlayers);
    if (Array.isArray(sessionDoc.players)) values.push(...sessionDoc.players);
  }
  if (snapshot && Array.isArray(snapshot.players)) values.push(...snapshot.players);

  return values.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const id = stringValue(value.id) || stringValue(value.playerId);
    if (!id) return [];
    const fields = sanitizedObject(value);
    delete fields.board;
    return [{
      id,
      name: stringValue(value.name) || stringValue(value.playerName) || `Player ${index + 1}`,
      isPerspective: Boolean(perspectivePlayerId && id === perspectivePlayerId),
      ...(finiteNumber(value.seat) !== undefined || stringValue(value.seat)
        ? { seat: finiteNumber(value.seat) ?? stringValue(value.seat) }
        : {}),
      ...(stringValue(value.role) ? { role: stringValue(value.role) } : {}),
      fields: stripHiddenParticipantFields(fields, id, perspectivePlayerId),
    }];
  });
}

export function normalizeSnapshot(
  value: unknown,
  sourceMessageId: string,
  fallbackGameNumber: number,
  perspectivePlayerId = "",
): ReplaySnapshot {
  const snapshot = isRecord(value) ? value : {};
  const players: Record<string, ReplayPlayerState> = {};
  const playerValues = Array.isArray(snapshot.players) ? snapshot.players : [];
  playerValues.forEach((playerValue, playerIndex) => {
    if (!isRecord(playerValue)) return;
    const id =
      stringValue(playerValue.id) ||
      stringValue(playerValue.playerId) ||
      stableId("player", sourceMessageId, playerIndex);
    const board = isRecord(playerValue.board) ? playerValue.board : {};
    const zones: Record<string, ReplayCardState[]> = {};
    const boardFields: JsonObject = {};
    for (const [key, entry] of Object.entries(board)) {
      if (Array.isArray(entry) && (ZONE_KEYS.has(key) || looksLikeCardArray(entry))) {
        zones[key] = entry.map((card, cardIndex) =>
          normalizeCardForPerspective(
            card,
            sourceMessageId,
            playerIndex,
            key,
            cardIndex,
            id,
            perspectivePlayerId,
          ),
        );
      } else {
        boardFields[key] = redactSecrets(entry);
      }
    }
    for (const zone of ZONE_KEYS) zones[zone] ??= [];

    const fields = stripHiddenParticipantFields(sanitizedObject(playerValue), id, perspectivePlayerId);
    delete fields.board;
    players[id] = {
      id,
      name: stringValue(playerValue.name) || stringValue(playerValue.playerName) || `Player ${playerIndex + 1}`,
      ...(finiteNumber(playerValue.seat) !== undefined || stringValue(playerValue.seat)
        ? { seat: finiteNumber(playerValue.seat) ?? stringValue(playerValue.seat) }
        : {}),
      ...(finiteNumber(board.score) !== undefined ? { score: finiteNumber(board.score) } : {}),
      fields,
      boardFields,
      zones,
    };
  });

  const normalizedPhase = normalizeReplayPhase(snapshot.phase);
  const gameNumber = integerValue(snapshot.gameNumber) ?? fallbackGameNumber;
  const roomFields = sanitizedObject(snapshot);
  delete roomFields.players;
  delete roomFields.chainEntries;
  delete roomFields.gameplayLog;
  delete roomFields.chatEntries;

  return {
    room: {
      phase: normalizedPhase.phase,
      rawPhase: normalizedPhase.rawPhase,
      gameNumber,
      ...(stringValue(snapshot.activeTurnPlayerId) ? { activeTurnPlayerId: stringValue(snapshot.activeTurnPlayerId) } : {}),
      ...(stringValue(snapshot.firstPlayerId) ? { firstPlayerId: stringValue(snapshot.firstPlayerId) } : {}),
      ...(integerValue(snapshot.turnNumber) !== undefined ? { turnNumber: integerValue(snapshot.turnNumber) } : {}),
      fields: roomFields,
    },
    players,
    chain: normalizeChainEntries(snapshot.chainEntries, sourceMessageId),
    log: normalizeLogEntries(snapshot.gameplayLog, sourceMessageId),
  };
}

export function normalizePatchOperations(
  packet: ParsedReplayPacket,
  perspectivePlayerId = "",
): {
  operations: ReplayPatchOperation[];
  unknownOperations: Extract<ReplayPatchOperation, { op: "unknown" }>[];
} {
  const operations = patchOperations(packet.payload ?? {}).map((value, index) =>
    normalizePatchOperation(value, packet.id, index, perspectivePlayerId),
  );
  return {
    operations,
    unknownOperations: operations.filter(
      (operation): operation is Extract<ReplayPatchOperation, { op: "unknown" }> => operation.op === "unknown",
    ),
  };
}

export function normalizeChatEntries(value: unknown, sourceMessageId: string): ReplayChatEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const fields = sanitizedObject(entry);
    return [{
      id: stringValue(entry.id) || stableId("chat", sourceMessageId, index, fields),
      ...(finiteNumber(entry.at) !== undefined ? { at: finiteNumber(entry.at) } : {}),
      author: stringValue(entry.author) || stringValue(entry.authorName),
      ...(stringValue(entry.authorPlayerId) ? { authorPlayerId: stringValue(entry.authorPlayerId) } : {}),
      text: stringValue(entry.text) || stringValue(entry.message),
      fields,
    }];
  });
}

export function patchOperations(payload: JsonObject): Record<string, unknown>[] {
  const patch = isRecord(payload.patch) ? payload.patch : {};
  const candidates = [
    ...(Array.isArray(payload.operations) ? payload.operations : []),
    ...(Array.isArray(payload.ops) ? payload.ops : []),
    ...(Array.isArray(patch.operations) ? patch.operations : []),
    ...(Array.isArray(patch.ops) ? patch.ops : []),
  ];
  return candidates.flatMap((candidate) => (isRecord(candidate) ? [candidate] : []));
}

function normalizePatchOperation(
  value: Record<string, unknown>,
  sourceMessageId: string,
  operationIndex: number,
  perspectivePlayerId: string,
): ReplayPatchOperation {
  const sourceOp = stringValue(value.op) || "unknown";
  const id = stableId("patch", sourceMessageId, operationIndex, sourceOp, value);
  const playerId = stringValue(value.playerId);
  const zone = stringValue(value.zone);

  switch (sourceOp) {
    case "zone_insert": {
      const cards = Array.isArray(value.cards)
        ? value.cards.map((card, cardIndex) =>
          normalizeCardForPerspective(
            card,
            sourceMessageId,
            operationIndex,
            zone,
            cardIndex,
            playerId,
            perspectivePlayerId,
          ),
        )
        : [];
      return { id, op: sourceOp, playerId, zone, index: integerValue(value.index) ?? -1, cards };
    }
    case "zone_remove":
      return {
        id,
        op: sourceOp,
        playerId,
        zone,
        cardIds: Array.isArray(value.cardIds) ? value.cardIds.map(stringValue).filter(Boolean) : [],
      };
    case "zone_move": {
      const from = isRecord(value.from) ? value.from : {};
      const to = isRecord(value.to) ? value.to : {};
      return {
        id,
        op: sourceOp,
        cardId: stringValue(value.cardId),
        from: { playerId: stringValue(from.playerId), zone: stringValue(from.zone) },
        to: { playerId: stringValue(to.playerId), zone: stringValue(to.zone), index: integerValue(to.index) ?? -1 },
        ...(value.card !== undefined
          ? {
              card: normalizeCardForPerspective(
                value.card,
                sourceMessageId,
                operationIndex,
                stringValue(to.zone) || "move",
                0,
                stringValue(to.playerId),
                perspectivePlayerId,
              ),
            }
          : {}),
      };
    }
    case "patch_card_fields":
      return {
        id,
        op: sourceOp,
        playerId,
        zone,
        cardId: stringValue(value.cardId),
        fields: sanitizeCardPatchFields(value.fields, playerId, zone, perspectivePlayerId),
      };
    case "unset_card_fields":
      return { id, op: sourceOp, playerId, zone, cardId: stringValue(value.cardId), fields: stringArray(value.fields) };
    case "set_room_fields":
      return { id, op: sourceOp, fields: sanitizedUnknownObject(value.fields) };
    case "unset_room_fields":
      return { id, op: sourceOp, fields: stringArray(value.fields) };
    case "set_player_fields":
      return {
        id,
        op: sourceOp,
        playerId,
        fields: stripHiddenParticipantFields(sanitizedObject(value.fields), playerId, perspectivePlayerId),
      };
    case "set_board_fields":
      return {
        id,
        op: sourceOp,
        playerId,
        fields: stripHiddenParticipantFields(sanitizedObject(value.fields), playerId, perspectivePlayerId),
      };
    case "chain_insert":
      return {
        id,
        op: sourceOp,
        index: integerValue(value.index) ?? -1,
        entries: normalizeChainEntries(value.entries, sourceMessageId),
      };
    case "chain_remove":
      return { id, op: sourceOp, entryIds: stringArray(value.entryIds) };
    case "log_insert":
      return {
        id,
        op: sourceOp,
        index: integerValue(value.index) ?? -1,
        entries: normalizeLogEntries(value.entries, sourceMessageId),
      };
    case "log_remove":
      return { id, op: sourceOp, entryIds: stringArray(value.entryIds) };
    default:
      return { id, op: "unknown", sourceOp, payload: sanitizedUnknownObject(value) };
  }
}

function normalizeCard(
  value: unknown,
  sourceMessageId: string,
  groupIndex: number,
  zone: string,
  cardIndex: number,
): ReplayCardState {
  if (typeof value === "string") {
    return {
      id: stableId("card", sourceMessageId, groupIndex, zone, cardIndex, value),
      name: value,
      fields: { name: value },
    };
  }
  const card = isRecord(value) ? value : {};
  const fields = sanitizedObject(card);
  const explicitId = stringValue(card.id) || stringValue(card.instanceId) || stringValue(card.cardInstanceId);
  const name = stringValue(card.name) || stringValue(card.cardName) || stringValue(card.title);
  const cardCode = stringValue(card.cardCode) || stringValue(card.code);
  return {
    id: explicitId || stableId("card", sourceMessageId, groupIndex, zone, cardIndex, name, cardCode, fields),
    name,
    ...(cardCode ? { cardCode } : {}),
    ...(stringValue(card.ownerPlayerId) || stringValue(card.ownerId)
      ? { ownerPlayerId: stringValue(card.ownerPlayerId) || stringValue(card.ownerId) }
      : {}),
    ...(stringValue(card.source) ? { source: stringValue(card.source) } : {}),
    ...(booleanValue(card.exhausted) !== undefined ? { exhausted: booleanValue(card.exhausted) } : {}),
    ...(booleanValue(card.isPlaceholder) !== undefined ? { isPlaceholder: booleanValue(card.isPlaceholder) } : {}),
    fields,
  };
}

function normalizeCardForPerspective(
  value: unknown,
  sourceMessageId: string,
  groupIndex: number,
  zone: string,
  cardIndex: number,
  ownerPlayerId: string,
  perspectivePlayerId: string,
): ReplayCardState {
  const card = normalizeCard(value, sourceMessageId, groupIndex, zone, cardIndex);
  if (!isHiddenZone(zone) || (perspectivePlayerId && ownerPlayerId === perspectivePlayerId)) return card;
  return {
    id: card.id,
    name: "",
    ownerPlayerId: ownerPlayerId || card.ownerPlayerId,
    source: zone,
    isPlaceholder: true,
    fields: {
      id: card.id,
      ownerPlayerId: ownerPlayerId || card.ownerPlayerId || "",
      source: zone,
      isPlaceholder: true,
    },
  };
}

function isHiddenZone(zone: string) {
  return ["deck", "hand", "runedeck", "sideboard"].includes(zone.toLowerCase());
}

function sanitizeCardPatchFields(
  value: unknown,
  ownerPlayerId: string,
  zone: string,
  perspectivePlayerId: string,
): JsonObject {
  if (isHiddenZone(zone) && (!perspectivePlayerId || ownerPlayerId !== perspectivePlayerId)) {
    return {
      ownerPlayerId,
      source: zone,
      isPlaceholder: true,
    };
  }
  return sanitizedObject(value);
}

function sanitizedUnknownObject(value: unknown): JsonObject {
  const sanitized = sanitizeUnknownPayload(value);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized) ? sanitized : {};
}

function normalizeChainEntries(value: unknown, sourceMessageId: string): ReplayChainEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const fields = sanitizedObject(entry);
    return [{ id: stringValue(entry.id) || stableId("chain", sourceMessageId, index, fields), fields }];
  });
}

export function normalizeLogEntries(value: unknown, sourceMessageId: string): ReplayLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const fields = sanitizedObject(entry);
    return [{
      id: stringValue(entry.id) || stableId("log", sourceMessageId, index, fields),
      ...(finiteNumber(entry.at) !== undefined ? { at: finiteNumber(entry.at) } : {}),
      text: stringValue(entry.text) || stringValue(entry.message),
      ...(stringValue(entry.authorPlayerId) ? { authorPlayerId: stringValue(entry.authorPlayerId) } : {}),
      fields,
    }];
  });
}

function sanitizedObject(value: unknown): JsonObject {
  const sanitized = redactSecrets(value);
  return isJsonObject(sanitized) ? sanitized : {};
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function looksLikeCardArray(value: unknown[]): boolean {
  if (!value.length) return false;
  return value.every((entry) =>
    typeof entry === "string" ||
    (isRecord(entry) && Boolean(stringValue(entry.id) || stringValue(entry.name) || stringValue(entry.cardCode))),
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function scoresFromUnknown(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).flatMap(([playerId, score]) => {
    const number = finiteNumber(score);
    return number === undefined ? [] : [[playerId, number] as const];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}
