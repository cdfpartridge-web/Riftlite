import { cloneJson, finiteNumber, integerValue, stringValue } from "@/lib/replay-v2/json";
import { normalizeReplayPhase } from "@/lib/replay-v2/normalization";
import type {
  CanonicalReplayV2,
  JsonObject,
  ReplayCardState,
  ReplayEvent,
  ReplayPatchOperation,
  ReplayPlayerState,
  ReplaySeries,
  ReplayState,
} from "@/lib/replay-v2/types";

export function createInitialReplayState(replay: Pick<CanonicalReplayV2, "series"> | ReplaySeries): ReplayState {
  const series = "series" in replay ? replay.series : replay;
  const players = Object.fromEntries(
    series.participants.map((participant) => [
      participant.id,
      {
        id: participant.id,
        name: participant.name,
        ...(participant.seat !== undefined ? { seat: participant.seat } : {}),
        fields: cloneJson(participant.fields),
        boardFields: {},
        zones: {},
      } satisfies ReplayPlayerState,
    ]),
  );
  return {
    seriesId: series.id,
    gameId: null,
    gameOrdinal: null,
    phase: "unknown",
    room: {
      phase: "unknown",
      rawPhase: "",
      gameNumber: 1,
      fields: {},
    },
    players,
    chain: [],
    log: [],
    chat: [],
    appliedEventIndex: -1,
  };
}

export function reduceReplayEvent(previous: ReplayState, event: ReplayEvent): ReplayState {
  const state = cloneReplayState(previous);
  switch (event.kind) {
    case "game_boundary":
      if (event.boundary === "start") {
        state.gameId = event.gameId;
        state.gameOrdinal = event.gameOrdinal;
        state.phase = "unknown";
        state.room.phase = "unknown";
        state.room.rawPhase = "";
        state.room.gameNumber = event.gameNumber;
      }
      break;
    case "phase":
      state.gameId = event.gameId;
      state.phase = event.phase;
      state.room.phase = event.phase;
      state.room.rawPhase = event.rawPhase;
      state.room.gameNumber = event.gameNumber;
      break;
    case "snapshot":
      state.gameId = event.gameId;
      state.room = cloneRoom(event.snapshot.room);
      state.phase = event.snapshot.room.phase;
      state.players = mergeSnapshotPlayers(state.players, event.snapshot.players);
      state.chain = event.snapshot.chain.map((entry) => ({ id: entry.id, fields: cloneJson(entry.fields) }));
      state.log = event.snapshot.log.map((entry) => ({ ...entry, fields: cloneJson(entry.fields) }));
      break;
    case "action":
      event.patch.operations.forEach((operation) => applyPatchOperation(state, operation));
      break;
    case "chat":
      state.chat = event.mode === "replace"
        ? event.entries.map((entry) => ({ ...entry, fields: cloneJson(entry.fields) }))
        : [...state.chat, ...event.entries.map((entry) => ({ ...entry, fields: cloneJson(entry.fields) }))];
      break;
    case "log":
      state.log = event.mode === "replace"
        ? event.entries.map((entry) => ({ ...entry, fields: cloneJson(entry.fields) }))
        : [...state.log, ...event.entries.map((entry) => ({ ...entry, fields: cloneJson(entry.fields) }))];
      break;
    case "interaction":
      break;
    case "unknown":
      break;
  }
  state.appliedEventIndex = event.index;
  return state;
}

export function projectReplayState(
  replay: Pick<CanonicalReplayV2, "series" | "events">,
  eventIndex = replay.events.length - 1,
): ReplayState {
  let state = createInitialReplayState(replay.series);
  const end = Math.min(Math.max(-1, Math.trunc(eventIndex)), replay.events.length - 1);
  for (let index = 0; index <= end; index += 1) {
    state = reduceReplayEvent(state, replay.events[index]);
  }
  return state;
}

export function cloneReplayState(state: ReplayState): ReplayState {
  return {
    ...state,
    room: cloneRoom(state.room),
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => [playerId, clonePlayer(player)]),
    ),
    chain: state.chain.map((entry) => ({ id: entry.id, fields: cloneJson(entry.fields) })),
    log: state.log.map((entry) => ({ ...entry, fields: cloneJson(entry.fields) })),
    chat: state.chat.map((entry) => ({ ...entry, fields: cloneJson(entry.fields) })),
  };
}

function applyPatchOperation(state: ReplayState, operation: ReplayPatchOperation) {
  switch (operation.op) {
    case "zone_insert": {
      const player = ensurePlayer(state, operation.playerId);
      const zone = ensureZone(player, operation.zone);
      insertAt(zone, operation.index, operation.cards.map(cloneCard));
      break;
    }
    case "zone_remove": {
      const player = ensurePlayer(state, operation.playerId);
      const removeIds = new Set(operation.cardIds);
      player.zones[operation.zone] = ensureZone(player, operation.zone).filter((card) => !removeIds.has(card.id));
      break;
    }
    case "zone_move": {
      const fromPlayer = ensurePlayer(state, operation.from.playerId);
      const fromZone = ensureZone(fromPlayer, operation.from.zone);
      const sourceIndex = fromZone.findIndex((card) => card.id === operation.cardId);
      const existing = sourceIndex >= 0 ? fromZone.splice(sourceIndex, 1)[0] : undefined;
      const card = operation.card ? cloneCard(operation.card) : existing;
      if (card) {
        const toPlayer = ensurePlayer(state, operation.to.playerId);
        insertAt(ensureZone(toPlayer, operation.to.zone), operation.to.index, [card]);
      }
      break;
    }
    case "patch_card_fields": {
      const card = findCard(state, operation.playerId, operation.zone, operation.cardId);
      if (card) applyCardFields(card, operation.fields);
      break;
    }
    case "unset_card_fields": {
      const card = findCard(state, operation.playerId, operation.zone, operation.cardId);
      if (!card) break;
      operation.fields.forEach((field) => {
        delete card.fields[field];
        if (field === "name") card.name = "";
        if (field === "cardCode") delete card.cardCode;
        if (field === "ownerPlayerId") delete card.ownerPlayerId;
        if (field === "source") delete card.source;
        if (field === "exhausted") delete card.exhausted;
        if (field === "isPlaceholder") delete card.isPlaceholder;
      });
      break;
    }
    case "set_room_fields":
      applyRoomFields(state, operation.fields);
      break;
    case "unset_room_fields":
      operation.fields.forEach((field) => {
        delete state.room.fields[field];
        if (field === "activeTurnPlayerId") delete state.room.activeTurnPlayerId;
        if (field === "firstPlayerId") delete state.room.firstPlayerId;
        if (field === "turnNumber") delete state.room.turnNumber;
      });
      break;
    case "set_player_fields": {
      const player = ensurePlayer(state, operation.playerId);
      player.fields = { ...player.fields, ...cloneJson(operation.fields) };
      if (typeof operation.fields.name === "string") player.name = operation.fields.name;
      if (typeof operation.fields.seat === "string" || typeof operation.fields.seat === "number") {
        player.seat = operation.fields.seat;
      }
      break;
    }
    case "set_board_fields": {
      const player = ensurePlayer(state, operation.playerId);
      player.boardFields = { ...player.boardFields, ...cloneJson(operation.fields) };
      const score = finiteNumber(operation.fields.score);
      if (score !== undefined) player.score = score;
      break;
    }
    case "chain_insert":
      insertAt(
        state.chain,
        operation.index,
        operation.entries.map((entry) => ({ id: entry.id, fields: cloneJson(entry.fields) })),
      );
      break;
    case "chain_remove": {
      const removeIds = new Set(operation.entryIds);
      state.chain = state.chain.filter((entry) => !removeIds.has(entry.id));
      break;
    }
    case "log_insert":
      insertAt(
        state.log,
        operation.index,
        operation.entries.map((entry) => ({ ...entry, fields: cloneJson(entry.fields) })),
      );
      break;
    case "log_remove": {
      const removeIds = new Set(operation.entryIds);
      state.log = state.log.filter((entry) => !removeIds.has(entry.id));
      break;
    }
    case "unknown":
      break;
  }
}

function applyRoomFields(state: ReplayState, fields: JsonObject) {
  state.room.fields = { ...state.room.fields, ...cloneJson(fields) };
  if (typeof fields.phase === "string") {
    const normalized = normalizeReplayPhase(fields.phase);
    state.phase = normalized.phase;
    state.room.phase = normalized.phase;
    state.room.rawPhase = normalized.rawPhase;
  }
  const gameNumber = integerValue(fields.gameNumber);
  if (gameNumber !== undefined) state.room.gameNumber = gameNumber;
  const activeTurnPlayerId = stringValue(fields.activeTurnPlayerId);
  if (activeTurnPlayerId) state.room.activeTurnPlayerId = activeTurnPlayerId;
  const firstPlayerId = stringValue(fields.firstPlayerId);
  if (firstPlayerId) state.room.firstPlayerId = firstPlayerId;
  const turnNumber = integerValue(fields.turnNumber);
  if (turnNumber !== undefined) state.room.turnNumber = turnNumber;
}

function applyCardFields(card: ReplayCardState, fields: JsonObject) {
  card.fields = { ...card.fields, ...cloneJson(fields) };
  if (typeof fields.name === "string") card.name = fields.name;
  if (typeof fields.cardCode === "string") card.cardCode = fields.cardCode;
  if (typeof fields.ownerPlayerId === "string") card.ownerPlayerId = fields.ownerPlayerId;
  if (typeof fields.source === "string") card.source = fields.source;
  if (typeof fields.exhausted === "boolean") card.exhausted = fields.exhausted;
  if (typeof fields.isPlaceholder === "boolean") card.isPlaceholder = fields.isPlaceholder;
}

function ensurePlayer(state: ReplayState, playerId: string): ReplayPlayerState {
  const id = playerId || "unknown-player";
  state.players[id] ??= {
    id,
    name: "Unknown player",
    fields: {},
    boardFields: {},
    zones: {},
  };
  return state.players[id];
}

function ensureZone(player: ReplayPlayerState, zone: string): ReplayCardState[] {
  const key = zone || "unknown";
  player.zones[key] ??= [];
  return player.zones[key];
}

function findCard(state: ReplayState, playerId: string, zone: string, cardId: string) {
  return ensureZone(ensurePlayer(state, playerId), zone).find((card) => card.id === cardId);
}

function insertAt<T>(target: T[], requestedIndex: number, values: T[]) {
  const index = requestedIndex < 0 ? target.length : Math.min(Math.max(0, requestedIndex), target.length);
  target.splice(index, 0, ...values);
}

function mergeSnapshotPlayers(
  existing: Record<string, ReplayPlayerState>,
  snapshot: Record<string, ReplayPlayerState>,
) {
  const result: Record<string, ReplayPlayerState> = {};
  for (const [playerId, player] of Object.entries(snapshot)) {
    const prior = existing[playerId];
    result[playerId] = {
      ...clonePlayer(player),
      name: player.name || prior?.name || "Unknown player",
      fields: { ...(prior ? cloneJson(prior.fields) : {}), ...cloneJson(player.fields) },
    };
  }
  for (const [playerId, player] of Object.entries(existing)) {
    result[playerId] ??= clonePlayer(player);
  }
  return result;
}

function cloneRoom(room: ReplayState["room"]): ReplayState["room"] {
  return { ...room, fields: cloneJson(room.fields) };
}

function clonePlayer(player: ReplayPlayerState): ReplayPlayerState {
  return {
    ...player,
    fields: cloneJson(player.fields),
    boardFields: cloneJson(player.boardFields),
    zones: Object.fromEntries(
      Object.entries(player.zones).map(([zone, cards]) => [zone, cards.map(cloneCard)]),
    ),
  };
}

function cloneCard(card: ReplayCardState): ReplayCardState {
  return { ...card, fields: cloneJson(card.fields) };
}
