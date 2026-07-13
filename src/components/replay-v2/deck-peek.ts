import type {
  CanonicalReplayV2,
  JsonObject,
  JsonValue,
  ReplayActionEvent,
  ReplayCardState,
  ReplayPatchOperation,
  ReplayState,
} from "@/lib/replay-v2";

export type DeckPeekCardPresentation = {
  card: ReplayCardState;
  appearedAtEventIndex: number;
  destination?: string;
  movedAtEventIndex?: number;
  revealed: boolean;
  returnedAtEventIndex?: number;
};

export type DeckPeekPresentation = {
  key: string;
  playerId: string;
  playerName: string;
  revision: string;
  cards: DeckPeekCardPresentation[];
  eventIndex: number;
  phase: "inspect" | "choose" | "reveal" | "return";
  currentCardId?: string;
  currentDestination?: string;
};

type MutableDeckPeekGroup = {
  key: string;
  gameId: string;
  playerId: string;
  revision: string;
  cardOrder: string[];
  cards: Map<string, DeckPeekCardPresentation>;
};

const DECK_PEEK_ACTIONS = new Set([
  "peek_deck_top",
  "take_card_from_deck",
  "set_deck_peek_card_reveal",
  "clear_deck_peek",
]);

export function buildDeckPeekPresentation(
  replay: CanonicalReplayV2,
  state: ReplayState,
  eventIndex: number,
): DeckPeekPresentation | null {
  if (eventIndex < 0) return null;

  const groups = new Map<string, MutableDeckPeekGroup>();
  const activeByPlayer = new Map<string, string>();
  let touchedKey: string | undefined;
  let currentCardId: string | undefined;
  let currentDestination: string | undefined;
  let currentPhase: DeckPeekPresentation["phase"] = "inspect";

  for (const event of replay.events.slice(0, eventIndex + 1)) {
    if (event.kind !== "action") continue;
    const isCurrent = event.index === eventIndex;
    const actionType = event.actionType.trim().toLowerCase();
    const deckPeekUpdates = deckPeekBoardUpdates(event);
    const eventKeys = new Map<string, string>();

    for (const update of deckPeekUpdates) {
      const previousKey = activeByPlayer.get(update.playerId);
      const revision = deckPeekRevision(update.deckPeek)
        ?? (previousKey ? groups.get(previousKey)?.revision : undefined)
        ?? `event-${event.index}`;
      const key = deckPeekKey(event.gameId, update.playerId, revision);
      const group = getOrCreateGroup(groups, key, event.gameId, update.playerId, revision);
      eventKeys.set(update.playerId, key);

      const cardIds = stringArray(update.deckPeek.cardIds);
      for (const cardId of cardIds) addCandidate(group, placeholderCard(cardId, update.playerId), event.index);
      for (const cardId of stringArray(update.deckPeek.revealedCardIds)) {
        const candidate = group.cards.get(cardId);
        if (candidate) candidate.revealed = true;
      }

      if (cardIds.length > 0) activeByPlayer.set(update.playerId, key);
      else if (previousKey) activeByPlayer.delete(update.playerId);

      if (isCurrent) touchedKey = previousKey ?? key;
    }

    const likelyPlayerId = event.actorPlayerId
      ?? firstOperationPlayerId(event.patch.operations)
      ?? firstText(event.action.playerId, event.action.ownerPlayerId);
    const likelyKey = likelyPlayerId
      ? eventKeys.get(likelyPlayerId) ?? activeByPlayer.get(likelyPlayerId)
      : undefined;

    for (const operation of event.patch.operations) {
      if (operation.op === "zone_insert" && normalizeZone(operation.zone) === "deck") {
        const key = eventKeys.get(operation.playerId) ?? activeByPlayer.get(operation.playerId);
        const group = key ? groups.get(key) : undefined;
        if (!group) continue;
        for (const card of operation.cards) addCandidate(group, card, event.index);
      }

      if (operation.op === "zone_move" && normalizeZone(operation.from.zone) === "deck") {
        const key = eventKeys.get(operation.from.playerId) ?? activeByPlayer.get(operation.from.playerId);
        const group = key ? groups.get(key) : findLatestGroupWithCard(groups, operation.from.playerId, operation.cardId);
        if (!group) continue;
        if (operation.card) addCandidate(group, operation.card, event.index);
        const candidate = group.cards.get(operation.cardId);
        if (!candidate) continue;
        candidate.destination = displayZone(operation.to.zone);
        candidate.movedAtEventIndex = event.index;
        if (isCurrent) {
          touchedKey = group.key;
          currentCardId = operation.cardId;
          currentDestination = candidate.destination;
          currentPhase = "choose";
        }
      }
    }

    if (actionType === "set_deck_peek_card_reveal") {
      const cardId = firstText(event.action.cardId, event.action.cardInstanceId);
      const group = likelyKey ? groups.get(likelyKey) : findLatestGroupWithCard(groups, likelyPlayerId, cardId);
      if (group && cardId) {
        const candidate = group.cards.get(cardId);
        if (candidate) candidate.revealed = true;
        if (isCurrent) {
          touchedKey = group.key;
          currentCardId = cardId;
          currentPhase = "reveal";
        }
      }
    }

    if (actionType === "take_card_from_deck" && isCurrent && likelyKey) {
      touchedKey = likelyKey;
      currentPhase = "choose";
      currentCardId ??= firstText(event.action.cardId, event.action.cardInstanceId);
      currentDestination ??= displayZone(firstText(event.action.to, event.action.zone) ?? "");
    }

    if (actionType === "clear_deck_peek") {
      const key = likelyKey ?? (likelyPlayerId ? activeByPlayer.get(likelyPlayerId) : undefined);
      const group = key ? groups.get(key) : undefined;
      if (group) {
        for (const candidate of group.cards.values()) {
          if (candidate.movedAtEventIndex === undefined) candidate.returnedAtEventIndex = event.index;
        }
        if (isCurrent) {
          touchedKey = group.key;
          currentPhase = "return";
        }
        activeByPlayer.delete(group.playerId);
      }
    }

    if (isCurrent && DECK_PEEK_ACTIONS.has(actionType) && likelyKey) touchedKey ??= likelyKey;
  }

  const activeKey = activeDeckPeekKey(state, replay, groups, activeByPlayer);
  const key = touchedKey ?? activeKey;
  const group = key ? groups.get(key) : undefined;
  if (!group || group.cards.size === 0) return null;

  const participant = replay.series.participants.find(({ id }) => id === group.playerId);
  const playerName = state.players[group.playerId]?.name || participant?.name || "Player";
  return {
    key: group.key,
    playerId: group.playerId,
    playerName,
    revision: group.revision,
    cards: group.cardOrder.flatMap((cardId) => {
      const candidate = group.cards.get(cardId);
      return candidate ? [candidate] : [];
    }),
    eventIndex,
    phase: currentPhase,
    currentCardId,
    currentDestination,
  };
}

function deckPeekBoardUpdates(event: ReplayActionEvent) {
  return event.patch.operations.flatMap((operation) => {
    if (operation.op !== "set_board_fields") return [];
    const deckPeek = operation.fields.deckPeek;
    return isJsonObject(deckPeek) ? [{ playerId: operation.playerId, deckPeek }] : [];
  });
}

function getOrCreateGroup(
  groups: Map<string, MutableDeckPeekGroup>,
  key: string,
  gameId: string | null,
  playerId: string,
  revision: string,
) {
  const existing = groups.get(key);
  if (existing) return existing;
  const group: MutableDeckPeekGroup = {
    key,
    gameId: gameId ?? "series",
    playerId,
    revision,
    cardOrder: [],
    cards: new Map(),
  };
  groups.set(key, group);
  return group;
}

function addCandidate(group: MutableDeckPeekGroup, card: ReplayCardState, eventIndex: number) {
  const existing = group.cards.get(card.id);
  if (existing) {
    if (existing.card.isPlaceholder && !card.isPlaceholder) existing.card = card;
    return;
  }
  group.cardOrder.push(card.id);
  group.cards.set(card.id, {
    card,
    appearedAtEventIndex: eventIndex,
    revealed: false,
  });
}

function findLatestGroupWithCard(
  groups: Map<string, MutableDeckPeekGroup>,
  playerId?: string,
  cardId?: string,
) {
  if (!playerId || !cardId) return undefined;
  return Array.from(groups.values()).reverse().find((group) => (
    group.playerId === playerId && group.cards.has(cardId)
  ));
}

function activeDeckPeekKey(
  state: ReplayState,
  replay: CanonicalReplayV2,
  groups: Map<string, MutableDeckPeekGroup>,
  activeByPlayer: Map<string, string>,
) {
  for (const player of Object.values(state.players)) {
    const deckPeek = player.boardFields.deckPeek;
    if (!isJsonObject(deckPeek) || stringArray(deckPeek.cardIds).length === 0) continue;
    const revision = deckPeekRevision(deckPeek);
    if (revision !== undefined) {
      const key = deckPeekKey(state.gameId, player.id, revision);
      if (groups.has(key)) return key;
    }
    const active = activeByPlayer.get(player.id);
    if (active) return active;
  }
  const perspectiveId = replay.series.perspectivePlayerId;
  return perspectiveId ? activeByPlayer.get(perspectiveId) : activeByPlayer.values().next().value;
}

function firstOperationPlayerId(operations: ReplayPatchOperation[]) {
  for (const operation of operations) {
    if ("playerId" in operation && typeof operation.playerId === "string") return operation.playerId;
    if (operation.op === "zone_move") return operation.from.playerId;
  }
  return undefined;
}

function deckPeekRevision(deckPeek: JsonObject) {
  const revision = deckPeek.revision;
  return typeof revision === "string" || typeof revision === "number" ? String(revision) : undefined;
}

function deckPeekKey(gameId: string | null, playerId: string, revision: string) {
  return `${gameId ?? "series"}|${playerId}|${revision}`;
}

function placeholderCard(id: string, ownerPlayerId: string): ReplayCardState {
  return { id, name: "", ownerPlayerId, isPlaceholder: true, source: "deck_peek", fields: {} };
}

function normalizeZone(zone: string) {
  return zone.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function displayZone(zone: string) {
  const normalized = normalizeZone(zone);
  if (normalized.includes("trash") || normalized.includes("discard")) return "Trash";
  if (normalized.includes("base")) return "Base";
  if (normalized.includes("hand")) return "Hand";
  if (normalized.includes("deck")) return "Deck";
  return zone.trim() ? zone.replace(/[_-]+/g, " ").replace(/\b\w/g, (value) => value.toUpperCase()) : "Play";
}

function stringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry));
}

function firstText(...values: Array<JsonValue | undefined>) {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim();
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
