import type {
  CanonicalReplayV2,
  JsonObject,
  JsonValue,
  ReplayCardState,
  ReplayEvent,
  ReplayPlayerState,
  ReplayState,
} from "@/lib/replay-v2";

const HAND_ZONE_ALIASES = ["hand", "cardsinhand"];
const DECK_ZONE_ALIASES = ["deck", "library", "drawpile", "drawdeck"];
const DISCARD_ZONE_ALIASES = ["discard", "trash", "graveyard", "recycle", "recyclepile"];
const SIDEBOARD_ZONE_ALIASES = ["sideboard", "sideboardcards"];
const TRUSTED_CARD_IMAGE_HOSTS = new Set([
  "cdn.piltoverarchive.com",
  "piltoverarchive.com",
  "www.piltoverarchive.com",
]);
const NON_BOARD_ZONE_ALIASES = [
  ...HAND_ZONE_ALIASES,
  ...DECK_ZONE_ALIASES,
  ...DISCARD_ZONE_ALIASES,
  ...SIDEBOARD_ZONE_ALIASES,
  "hidden",
  "unknown",
];

export type ReplayPlayerPair = {
  bottom: ReplayPlayerState;
  top: ReplayPlayerState;
};

export type ReplayBoardZone = {
  key: string;
  label: string;
  cards: ReplayCardState[];
};

export type ReplayTurnMarker = {
  turn: number;
  atMs: number;
  eventIndex: number;
};

export type ReplaySceneKind =
  | "matchup"
  | "battlefields"
  | "initiative"
  | "mulligan"
  | "opening"
  | "game_start"
  | "sideboarding"
  | "game_transition"
  | "game_end"
  | null;

export function resolveReplayPlayers(replay: CanonicalReplayV2, state: ReplayState): ReplayPlayerPair {
  const statePlayers = Object.values(state.players);
  const participants = replay.series.participants;
  const perspectivePlayerId = replay.series.perspectivePlayerId;
  const localParticipant = participants.find((participant) => {
    const role = `${participant.role ?? ""} ${stringField(participant.fields, "role")}`.toLowerCase();
    return (
      participant.fields.isLocal === true ||
      participant.fields.isSelf === true ||
      participant.fields.isCapturingPlayer === true ||
      participant.isPerspective ||
      /(?:local|self|captur|owner|viewer)/.test(role)
    );
  });
  const bottomId =
    perspectivePlayerId ??
    localParticipant?.id ??
    participants[0]?.id ??
    statePlayers[0]?.id ??
    "player-bottom";
  const topId =
    participants.find((participant) => participant.id !== bottomId)?.id ??
    statePlayers.find((player) => player.id !== bottomId)?.id ??
    "player-top";

  return {
    bottom: playerForId(bottomId, replay, state, "You"),
    top: playerForId(topId, replay, state, "Opponent"),
  };
}

function playerForId(
  id: string,
  replay: CanonicalReplayV2,
  state: ReplayState,
  fallbackName: string,
): ReplayPlayerState {
  const live = state.players[id];
  if (live) return live;
  const participant = replay.series.participants.find((entry) => entry.id === id);
  return {
    id,
    name: participant?.name || fallbackName,
    seat: participant?.seat,
    fields: participant?.fields ?? {},
    boardFields: {},
    zones: {},
  };
}

export function zoneCards(player: ReplayPlayerState, aliases: string[]): ReplayCardState[] {
  const normalizedAliases = new Set(aliases.map(normalizeKey));
  const exact = Object.entries(player.zones).find(([key]) => normalizedAliases.has(normalizeKey(key)));
  if (exact) return exact[1];
  const partial = Object.entries(player.zones).find(([key]) => {
    const normalized = normalizeKey(key);
    return aliases.some((alias) => normalized.includes(normalizeKey(alias)));
  });
  return partial?.[1] ?? [];
}

export function handCards(player: ReplayPlayerState): ReplayCardState[] {
  return zoneCards(player, HAND_ZONE_ALIASES);
}

export function deckCards(player: ReplayPlayerState): ReplayCardState[] {
  return zoneCards(player, DECK_ZONE_ALIASES);
}

export function discardCards(player: ReplayPlayerState): ReplayCardState[] {
  return zoneCards(player, DISCARD_ZONE_ALIASES);
}

export function sideboardCards(player: ReplayPlayerState): ReplayCardState[] {
  return zoneCards(player, SIDEBOARD_ZONE_ALIASES);
}

export function boardZones(player: ReplayPlayerState): ReplayBoardZone[] {
  const zones = Object.entries(player.zones)
    .filter(([key, cards]) => {
      if (!cards.length) return false;
      const normalized = normalizeKey(key);
      return !NON_BOARD_ZONE_ALIASES.some((alias) => normalized.includes(normalizeKey(alias)));
    })
    .map(([key, cards]) => ({ key, label: titleCase(key), cards }));

  if (zones.length) return zones.slice(0, 4);
  return [{ key: "board", label: "Board", cards: [] }];
}

export function cardName(card: ReplayCardState): string {
  if (card.isPlaceholder) return "Hidden card";
  return card.name || card.cardCode || "Unknown card";
}

export function cardImageUrl(card: ReplayCardState | undefined): string | undefined {
  if (!card || card.isPlaceholder) return undefined;
  const fields = card.fields;
  const direct = firstString(
    fields.imageUrl,
    fields.image_url,
    fields.image,
    fields.artUrl,
    fields.art_url,
    fields.src,
  );
  const safeDirect = safeCardImageUrl(direct);
  if (safeDirect) return safeDirect;
  const code = card.cardCode || cardCodeFromValue(card.id) || cardCodeFromValue(card.name);
  return code ? `https://cdn.piltoverarchive.com/cards/${encodeURIComponent(code)}.webp` : undefined;
}

export function safeCardImageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\/(?![\\/])/.test(value)) return value;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !TRUSTED_CARD_IMAGE_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function cardCodeFromValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/\b([A-Z]{3}-\d{3}[a-z]?)\b/i);
  if (!match) return undefined;
  return `${match[1].slice(0, 3).toUpperCase()}-${match[1].slice(4)}`;
}

export function legendCard(player: ReplayPlayerState): ReplayCardState | undefined {
  const candidates = [
    player.fields.legend,
    player.fields.legendCard,
    player.fields.champion,
    player.boardFields.legend,
    player.boardFields.legendCard,
  ];
  for (const candidate of candidates) {
    const card = looseCard(candidate, `${player.id}-legend`);
    if (card) return card;
  }
  return undefined;
}

export function championCard(player: ReplayPlayerState): ReplayCardState | undefined {
  const candidates = [
    player.fields.champion,
    player.fields.championCard,
    player.fields.signatureUnit,
    player.boardFields.champion,
    player.boardFields.championCard,
  ];
  for (const candidate of candidates) {
    const card = looseCard(candidate, `${player.id}-champion`);
    if (card) return card;
  }
  return undefined;
}

export function battlefieldCards(state: ReplayState, players: ReplayPlayerPair): ReplayCardState[] {
  const candidates: JsonValue[] = [];
  const roomFields = state.room.fields;
  for (const key of [
    "battlefields",
    "battlefieldCards",
    "selectedBattlefields",
    "availableBattlefields",
    "battlefieldOptions",
  ]) {
    const value = roomFields[key];
    if (value !== undefined) candidates.push(value);
  }
  for (const player of [players.bottom, players.top]) {
    for (const key of ["battlefield", "selectedBattlefield", "battlefieldCard", "battlefieldOptions"]) {
      const value = player.boardFields[key] ?? player.fields[key];
      if (value !== undefined) candidates.push(value);
    }
  }

  const cards = candidates.flatMap((candidate, index) => looseCards(candidate, `battlefield-${index}`));
  const unique = new Map<string, ReplayCardState>();
  for (const card of cards) unique.set(card.id || card.cardCode || card.name, card);
  return Array.from(unique.values()).slice(0, 3);
}

export function initiativeRoll(player: ReplayPlayerState, state: ReplayState): number | undefined {
  const roomRolls = state.room.fields.initiativeRolls;
  if (isRecord(roomRolls)) {
    const direct = numberValue(roomRolls[player.id]);
    if (direct !== undefined) return direct;
    const byName = numberValue(roomRolls[player.name]);
    if (byName !== undefined) return byName;
  }
  return firstNumber(
    player.fields.initiativeRoll,
    player.fields.initiative,
    player.fields.dieRoll,
    player.boardFields.initiativeRoll,
  );
}

export function activeScene(
  replay: CanonicalReplayV2,
  state: ReplayState,
  currentMs: number,
): ReplaySceneKind {
  switch (state.phase) {
    case "matchup":
    case "lobby":
      return "matchup";
    case "battlefield_pick":
      return "battlefields";
    case "initiative_roll":
    case "first_player_choice":
      return "initiative";
    case "mulligan":
      return "mulligan";
    case "sideboarding":
      return "sideboarding";
    case "game_end":
    case "series_end":
      return "game_end";
    default:
      break;
  }

  const appliedEvents = replay.events.slice(0, Math.max(0, state.appliedEventIndex + 1));
  const lastBoundary = [...appliedEvents].reverse().find((event) => event.kind === "game_boundary");
  if (lastBoundary?.kind === "game_boundary" && lastBoundary.boundary === "end" && currentMs - lastBoundary.atMs < 2_200) {
    return "game_transition";
  }

  if (state.phase === "in_game") {
    const latestGameStart = [...appliedEvents]
      .reverse()
      .find((event) => event.kind === "phase" && event.phase === "in_game" && event.gameId === state.gameId);
    if (latestGameStart && currentMs - latestGameStart.atMs < 2_400) return "opening";
  }

  if (currentMs < 2_400 && state.appliedEventIndex <= 0) return "matchup";
  return null;
}

export function turnMarkers(replay: CanonicalReplayV2): ReplayTurnMarker[] {
  const markers: ReplayTurnMarker[] = [];
  let previousTurn: number | undefined;

  for (const event of replay.events) {
    let turn: number | undefined;
    if (event.kind === "snapshot") {
      turn = event.snapshot.room.turnNumber;
    } else if (event.kind === "action") {
      turn = firstNumber(event.action.turnNumber, event.action.turn, event.action.round);
      if (turn === undefined) {
        const roomPatch = event.patch.operations.find((operation) => operation.op === "set_room_fields");
        if (roomPatch?.op === "set_room_fields") {
          turn = firstNumber(roomPatch.fields.turnNumber, roomPatch.fields.turn, roomPatch.fields.round);
        }
      }
    }
    if (turn === undefined || turn === previousTurn) continue;
    markers.push({ turn, atMs: event.atMs, eventIndex: event.index });
    previousTurn = turn;
  }

  if (!markers.length) {
    for (const checkpoint of replay.checkpoints) {
      const turn = checkpoint.state.room.turnNumber;
      if (turn === undefined || turn === previousTurn) continue;
      markers.push({ turn, atMs: checkpoint.atMs, eventIndex: checkpoint.eventIndex });
      previousTurn = turn;
    }
  }
  return markers;
}

export function replayDurationMs(replay: CanonicalReplayV2): number {
  const finalEvent = replay.events.at(-1)?.atMs ?? 0;
  const finalCheckpoint = replay.checkpoints.at(-1)?.atMs ?? 0;
  const seriesDuration = Math.max(0, replay.series.endedAt - replay.series.startedAt);
  return Math.max(1, finalEvent, finalCheckpoint, seriesDuration);
}

export function eventLabel(event: ReplayEvent | undefined): string {
  if (!event) return "Replay ready";
  switch (event.kind) {
    case "action":
      return titleCase(event.actionType || "Action");
    case "chat":
      return event.entries.at(-1)?.text || "Chat message";
    case "log":
      return event.entries.at(-1)?.text || "Match log";
    case "interaction":
      return event.interactionType === "card_ping" ? "Card ping" : "Board emote";
    case "game_boundary":
      return `${event.boundary === "start" ? "Game" : "Game complete"} ${event.gameNumber}`;
    case "phase":
      return titleCase(event.phase);
    case "snapshot":
      return "Board synchronized";
    case "unknown":
      return titleCase(event.packetType || "Unknown event");
    default:
      return "Replay event";
  }
}

export function visibleCardFields(card: ReplayCardState): Array<[string, string]> {
  const fields: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(card.fields)) {
    if (/^(?:image|imageurl|image_url|src|arturl|art_url)$/i.test(key)) continue;
    const formatted = displayValue(value);
    if (!formatted) continue;
    fields.push([titleCase(key), formatted]);
    if (fields.length >= 7) break;
  }
  return fields;
}

export function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function gameForState(replay: CanonicalReplayV2, state: ReplayState) {
  return (
    replay.series.games.find((game) => game.id === state.gameId) ??
    replay.series.games.find((game) => game.ordinal === state.gameOrdinal) ??
    replay.series.games[0]
  );
}

export function isRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function looseCards(value: JsonValue, idPrefix: string): ReplayCardState[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => looseCards(entry, `${idPrefix}-${index}`));
  }
  const card = looseCard(value, idPrefix);
  if (card) return [card];
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, entry]) => looseCards(entry, `${idPrefix}-${key}`));
}

function looseCard(value: JsonValue | undefined, fallbackId: string): ReplayCardState | undefined {
  if (typeof value === "string") {
    if (!value.trim()) return undefined;
    return {
      id: fallbackId,
      name: value,
      cardCode: cardCodeFromValue(value),
      fields: {},
    };
  }
  if (!isRecord(value)) return undefined;
  const name = firstString(value.name, value.cardName, value.title, value.label);
  const code = firstString(value.cardCode, value.code, value.card_id, value.cardId);
  const id = firstString(value.instanceId, value.cardInstanceId, value.id) || code || fallbackId;
  if (!name && !code) return undefined;
  return {
    id,
    name: name || code || "Unknown card",
    cardCode: cardCodeFromValue(code) || code || cardCodeFromValue(name),
    isPlaceholder: value.isPlaceholder === true || value.hidden === true,
    exhausted: value.exhausted === true || value.tapped === true,
    fields: value,
  };
}

function displayValue(value: JsonValue): string {
  if (typeof value === "string") return value.length > 70 ? `${value.slice(0, 67)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.length <= 5) {
    return value.map((entry) => displayValue(entry)).filter(Boolean).join(", ");
  }
  return "";
}

function stringField(fields: JsonObject, key: string): string {
  const value = fields[key];
  return typeof value === "string" ? value : "";
}

function firstString(...values: Array<JsonValue | undefined>): string | undefined {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim();
}

function numberValue(value: JsonValue | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function firstNumber(...values: Array<JsonValue | undefined>): number | undefined {
  for (const value of values) {
    const number = numberValue(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
