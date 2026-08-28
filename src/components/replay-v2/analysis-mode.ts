import {
  cloneReplayState,
  reduceReplayEvent,
  type CanonicalReplayV2,
  type JsonObject,
  type ReplayCardState,
  type ReplayPlayerState,
  type ReplayState,
} from "@/lib/replay-v2";

export const REPLAY_ANALYSIS_DESTINATIONS = [
  { label: "Hand", zone: "hand" },
  { label: "Base", zone: "base" },
  { label: "Battlefield A", zone: "battlefieldA" },
  { label: "Battlefield B", zone: "battlefieldB" },
  { label: "Rune area", zone: "runeArea" },
  { label: "Trash", zone: "discard" },
  { label: "Banished", zone: "banished" },
] as const;

export type ReplayAnalysisCounterField = "whiteCounter" | "redCounter";

export type ReplayAnalysisOperation =
  | { kind: "move_card"; cardId: string; playerId?: string; zone: string }
  | { kind: "toggle_exhausted"; cardId: string }
  | { kind: "adjust_counter"; cardId: string; field: ReplayAnalysisCounterField; delta: number }
  | { kind: "adjust_score"; playerId: string; delta: number }
  | { kind: "attach_card"; cardId: string; targetCardId: string }
  | { kind: "add_to_chain"; cardId: string }
  | { kind: "add_chain_target"; entryId: string; targetCardId: string }
  | { kind: "clear_chain_targets"; entryId: string }
  | { kind: "detach_card"; cardId: string }
  | { kind: "remove_from_chain"; entryId: string }
  | { kind: "restore_card"; cardId: string };

export type ReplayAnalysisSession = {
  anchorAtMs: number;
  anchorEventIndex: number;
  future: ReplayState[];
  inferredCardIds: string[];
  history: ReplayState[];
  initialState: ReplayState;
  state: ReplayState;
};

export type ReplayAnalysisCardLocation = {
  card: ReplayCardState;
  index: number;
  player: ReplayPlayerState;
  zone: string;
};

type TrackedHiddenCard = {
  active: boolean;
  allowProjectionGaps: boolean;
  playerId: string;
};

type AnonymousAtlasHandCohort = {
  playerId: string;
  slots: Array<string | null>;
};

type AnonymousAtlasHandEvidence = {
  hiddenRemoved: number;
  mutations: Array<
    | { count: number; index: number; kind: "insert" }
    | { indices: number[]; kind: "remove" }
  >;
  privateTransition: boolean;
  publicCards: ReplayCardState[];
};

/**
 * Creates a transient analysis branch. The canonical replay and its checkpoints
 * are never mutated; all inferred identities and user changes live in this
 * cloned state only.
 */
export function createReplayAnalysisSession(
  replay: CanonicalReplayV2,
  anchorEventIndex: number,
  anchorState: ReplayState,
): ReplayAnalysisSession {
  const { inferredCardIds, state } = revealFutureKnownHandCards(
    replay,
    anchorEventIndex,
    anchorState,
  );
  return {
    anchorAtMs: replay.events[anchorEventIndex]?.atMs ?? 0,
    anchorEventIndex,
    future: [],
    inferredCardIds,
    history: [],
    initialState: cloneReplayState(state),
    state,
  };
}

/**
 * Reveals a hidden hand card only when that same opaque card instance later
 * becomes public. Generic provider IDs must remain continuously present so ID
 * reuse cannot create a false inference. TCGA's stable per-card IDs may cross
 * short projection gaps because its snapshots temporarily omit resolving
 * cards. Cards drawn after the anchor are never candidates.
 */
export function revealFutureKnownHandCards(
  replay: CanonicalReplayV2,
  anchorEventIndex: number,
  anchorState: ReplayState,
  options: { allowStableProjectionGaps?: boolean } = {},
): { inferredCardIds: string[]; state: ReplayState } {
  const state = cloneReplayState(anchorState);
  const tracked = new Map<string, TrackedHiddenCard>();
  const anonymousAtlasHands = new Map<string, AnonymousAtlasHandCohort>();
  for (const player of Object.values(anchorState.players)) {
    for (const [zone, cards] of Object.entries(player.zones)) {
      if (!isHandZone(zone)) continue;
      for (const card of cards) {
        if (card.isPlaceholder) {
          if (isAnonymousAtlasHandCardId(card.id)) {
            const cohort = anonymousAtlasHands.get(player.id) ?? {
              playerId: player.id,
              slots: [],
            };
            const cardIndex = anonymousAtlasHandIndex(card.id) ?? cohort.slots.length;
            while (cohort.slots.length <= cardIndex) cohort.slots.push(null);
            cohort.slots[cardIndex] = card.id;
            anonymousAtlasHands.set(player.id, cohort);
            continue;
          }
          tracked.set(card.id, {
            active: true,
            allowProjectionGaps: options.allowStableProjectionGaps !== false && isStableTcgaCardId(card.id),
            playerId: player.id,
          });
        }
      }
    }
  }
  if (!tracked.size && !anonymousAtlasHands.size) return { inferredCardIds: [], state };

  const inferred = new Map<string, ReplayCardState>();
  let futureState = cloneReplayState(anchorState);
  const anchorGameId = anchorState.gameId;

  for (let index = anchorEventIndex + 1; index < replay.events.length; index += 1) {
    const event = replay.events[index];
    if (anchorGameId && event.gameId && event.gameId !== anchorGameId) break;
    if (
      event.kind === "game_boundary" &&
      event.boundary === "start" &&
      index > anchorEventIndex + 1
    ) {
      break;
    }

    const previousState = futureState;
    futureState = reduceReplayEvent(futureState, event);

    const anonymousEvidence = anonymousAtlasHandEvidence(event);
    for (const cohort of anonymousAtlasHands.values()) {
      if (event.kind === "snapshot") {
        cohort.slots = Array<string | null>(
          anonymousAtlasHandCount(futureState, cohort.playerId),
        ).fill(null);
        continue;
      }
      reconcileAnonymousAtlasHand(
        cohort,
        anonymousAtlasHandCount(previousState, cohort.playerId),
      );
      const evidence = anonymousEvidence.get(cohort.playerId);
      if (evidence) applyAnonymousAtlasHandEvidence(cohort, evidence, inferred);
      reconcileAnonymousAtlasHand(
        cohort,
        anonymousAtlasHandCount(futureState, cohort.playerId),
      );
    }

    for (const [cardId, tracking] of tracked) {
      if (!tracking.active || inferred.has(cardId)) continue;
      if (eventPrivatizesCard(event, cardId, tracking.playerId)) {
        tracking.active = false;
        continue;
      }
      const previous = findCardLocation(previousState, cardId);
      const current = findCardLocation(futureState, cardId);
      if (!current) {
        if (!tracking.allowProjectionGaps) tracking.active = false;
        continue;
      }
      if (current.player.id !== tracking.playerId) {
        tracking.active = false;
        continue;
      }
      if (isPrivateKnowledgeZone(current.zone) && !isHandZone(current.zone)) {
        tracking.active = false;
        continue;
      }
      if (
        isPublicCardEvidence(current.card, current.zone) &&
        (Boolean(previous) || tracking.allowProjectionGaps)
      ) {
        inferred.set(cardId, current.card);
        continue;
      }
      if (!previous && !tracking.allowProjectionGaps) {
        tracking.active = false;
      }
    }
  }

  for (const [cardId, publicCard] of inferred) {
    const location = findCardLocation(state, cardId);
    if (!location || !isHandZone(location.zone) || !location.card.isPlaceholder) continue;
    const source = location.card.source ?? location.zone;
    location.card.name = publicCard.name;
    location.card.cardCode = publicCard.cardCode;
    location.card.ownerPlayerId = location.card.ownerPlayerId ?? publicCard.ownerPlayerId;
    location.card.source = source;
    location.card.exhausted = false;
    location.card.isPlaceholder = false;
    location.card.fields = {
      ...cloneObject(publicCard.fields ?? {}),
      ownerPlayerId: location.card.ownerPlayerId ?? publicCard.ownerPlayerId ?? location.player.id,
      source,
      isPlaceholder: false,
      analysisKnowledge: "future_reveal",
    };
  }

  return { inferredCardIds: [...inferred.keys()], state };
}

function anonymousAtlasHandEvidence(
  event: CanonicalReplayV2["events"][number],
): Map<string, AnonymousAtlasHandEvidence> {
  const result = new Map<string, AnonymousAtlasHandEvidence>();
  if (event.kind !== "action") return result;

  const evidenceFor = (playerId: string) => {
    const evidence = result.get(playerId) ?? {
      hiddenRemoved: 0,
      mutations: [],
      privateTransition: false,
      publicCards: [],
    };
    result.set(playerId, evidence);
    return evidence;
  };

  for (const operation of event.patch.operations) {
    if (operation.op === "zone_remove" && isHandZone(operation.zone)) {
      const indices = operation.cardIds.flatMap((cardId) => {
        const index = anonymousAtlasHandIndex(cardId);
        return index === undefined ? [] : [index];
      });
      if (indices.length) {
        const evidence = evidenceFor(operation.playerId);
        evidence.hiddenRemoved += indices.length;
        evidence.mutations.push({ indices, kind: "remove" });
      }
      continue;
    }
    if (operation.op === "zone_insert") {
      const evidence = evidenceFor(operation.playerId);
      if (isPrivateKnowledgeZone(operation.zone) && !isHandZone(operation.zone)) {
        evidence.privateTransition = true;
      }
      if (isHandZone(operation.zone)) {
        const hiddenAdded = operation.cards.filter(
          (card) => card.isPlaceholder && isAnonymousAtlasHandCardId(card.id),
        ).length;
        if (hiddenAdded) {
          evidence.mutations.push({
            count: hiddenAdded,
            index: operation.index,
            kind: "insert",
          });
        }
      }
      for (const card of operation.cards) {
        if (
          event.actionType === "move_card" &&
          isPublicCardEvidence(card, operation.zone) &&
          (!card.ownerPlayerId || card.ownerPlayerId === operation.playerId)
        ) {
          evidence.publicCards.push(card);
        }
      }
      continue;
    }
    if (operation.op === "zone_move") {
      const evidence = evidenceFor(operation.from.playerId);
      if (isPrivateKnowledgeZone(operation.to.zone) && !isHandZone(operation.to.zone)) {
        evidence.privateTransition = true;
      }
      if (
        isHandZone(operation.from.zone) &&
        isAnonymousAtlasHandCardId(operation.cardId)
      ) {
        const index = anonymousAtlasHandIndex(operation.cardId);
        evidence.hiddenRemoved += 1;
        if (index !== undefined) {
          evidence.mutations.push({ indices: [index], kind: "remove" });
        }
        if (operation.card && isPublicCardEvidence(operation.card, operation.to.zone)) {
          evidence.publicCards.push(operation.card);
        }
      }
      if (
        isHandZone(operation.to.zone) &&
        operation.card?.isPlaceholder &&
        isAnonymousAtlasHandCardId(operation.card.id)
      ) {
        evidenceFor(operation.to.playerId).mutations.push({
          count: 1,
          index: operation.to.index,
          kind: "insert",
        });
      }
      continue;
    }
    if (operation.op !== "chain_insert") continue;
    for (const entry of operation.entries) {
      const fromZone = textField(entry.fields.fromZone);
      const card = replayCardFromJson(entry.fields.card);
      const playerId = textField(entry.fields.byPlayerId) ?? card?.ownerPlayerId;
      if (
        playerId &&
        fromZone &&
        isHandZone(fromZone) &&
        card &&
        isPubliclyVisibleIdentity(card)
      ) {
        evidenceFor(playerId).publicCards.push(card);
      }
    }
  }

  for (const evidence of result.values()) {
    evidence.publicCards = uniquePublicCards(evidence.publicCards);
  }
  return result;
}

function applyAnonymousAtlasHandEvidence(
  cohort: AnonymousAtlasHandCohort,
  evidence: AnonymousAtlasHandEvidence,
  inferred: Map<string, ReplayCardState>,
): void {
  const removedAnchorCardIds: string[] = [];
  for (const mutation of evidence.mutations) {
    if (mutation.kind === "insert") {
      const index = Math.max(0, Math.min(mutation.index, cohort.slots.length));
      cohort.slots.splice(index, 0, ...Array<string | null>(mutation.count).fill(null));
      continue;
    }
    for (const index of [...mutation.indices].sort((left, right) => right - left)) {
      if (index < 0 || index >= cohort.slots.length) continue;
      const [removedCardId] = cohort.slots.splice(index, 1);
      if (removedCardId) removedAnchorCardIds.unshift(removedCardId);
    }
  }

  if (
    !evidence.privateTransition &&
    removedAnchorCardIds.length === evidence.hiddenRemoved &&
    evidence.publicCards.length === evidence.hiddenRemoved
  ) {
    for (let index = 0; index < evidence.hiddenRemoved; index += 1) {
      inferred.set(removedAnchorCardIds[index], evidence.publicCards[index]);
    }
  }
}

function reconcileAnonymousAtlasHand(
  cohort: AnonymousAtlasHandCohort,
  nextHiddenCount: number,
): void {
  if (nextHiddenCount === cohort.slots.length) return;
  cohort.slots = Array<string | null>(nextHiddenCount).fill(null);
}

function anonymousAtlasHandCount(state: ReplayState, playerId: string): number {
  const player = state.players[playerId];
  if (!player) return 0;
  return Object.entries(player.zones).reduce((count, [zone, cards]) => (
    isHandZone(zone)
      ? count + cards.filter(
          (card) => card.isPlaceholder && isAnonymousAtlasHandCardId(card.id),
        ).length
      : count
  ), 0);
}

function uniquePublicCards(cards: ReplayCardState[]): ReplayCardState[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = `${card.id}|${card.cardCode ?? ""}|${card.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function replayCardFromJson(value: unknown): ReplayCardState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const card = cloneCard(value as ReplayCardState);
  return typeof card.id === "string" && typeof card.name === "string" ? card : undefined;
}

export function applyReplayAnalysisOperation(
  session: ReplayAnalysisSession,
  operation: ReplayAnalysisOperation,
): ReplayAnalysisSession {
  const previous = cloneReplayState(session.state);
  const state = cloneReplayState(session.state);
  let changed = false;

  switch (operation.kind) {
    case "move_card": {
      const location = findCardLocation(state, operation.cardId);
      const playerId = operation.playerId ?? location?.player.id ?? "";
      if (
        !location ||
        !replayAnalysisCanMove(state, operation.cardId, playerId, operation.zone)
      ) {
        break;
      }
      const movedCards = takeCardGroup(state, operation.cardId);
      if (!movedCards.length) break;
      const [card, ...attachments] = movedCards;
      if (!card) break;
      delete card.fields.attachedToCardId;
      markMovedCard(card, operation.zone);
      for (const attachment of attachments) markMovedCard(attachment, operation.zone);
      ensureZone(location.player, operation.zone).push(card, ...attachments);
      changed = true;
      break;
    }
    case "toggle_exhausted": {
      const location = findCardLocation(state, operation.cardId);
      if (!location || location.card.isPlaceholder) break;
      location.card.exhausted = !location.card.exhausted;
      location.card.fields = {
        ...location.card.fields,
        exhausted: location.card.exhausted,
        analysisStatus: "what_if",
      };
      changed = true;
      break;
    }
    case "adjust_counter": {
      const location = findCardLocation(state, operation.cardId);
      if (!location || location.card.isPlaceholder || !Number.isFinite(operation.delta)) break;
      const current = finiteCounter(location.card.fields[operation.field]);
      const next = Math.max(0, current + Math.trunc(operation.delta));
      if (next === current) break;
      location.card.fields = {
        ...location.card.fields,
        [operation.field]: next,
        analysisStatus: "what_if",
      };
      changed = true;
      break;
    }
    case "adjust_score": {
      const player = state.players[operation.playerId];
      if (!player || !Number.isFinite(operation.delta)) break;
      const current = finiteCounter(player.score ?? player.boardFields.score);
      const next = Math.max(0, current + Math.trunc(operation.delta));
      if (next === current) break;
      player.score = next;
      player.boardFields = {
        ...player.boardFields,
        score: next,
        analysisScoreChanged: true,
      };
      changed = true;
      break;
    }
    case "attach_card": {
      if (!replayAnalysisCanAttach(state, operation.cardId, operation.targetCardId)) break;
      const source = findCardLocation(state, operation.cardId);
      const target = findCardLocation(state, operation.targetCardId);
      if (!source || !target) break;
      const movedCards = takeCardGroup(state, operation.cardId);
      const [card, ...attachments] = movedCards;
      if (!card) break;
      card.ownerPlayerId = target.card.ownerPlayerId ?? target.player.id;
      card.source = target.zone;
      card.fields = {
        ...card.fields,
        attachedToCardId: target.card.id,
        ownerPlayerId: card.ownerPlayerId,
        source: target.zone,
        analysisStatus: "what_if",
      };
      for (const attachment of attachments) markMovedCard(attachment, target.zone);
      const targetCards = ensureZone(target.player, target.zone);
      const targetIndex = targetCards.findIndex((candidate) => candidate.id === target.card.id);
      targetCards.splice(Math.max(0, targetIndex), 0, card, ...attachments);
      changed = true;
      break;
    }
    case "add_to_chain": {
      const location = findCardLocation(state, operation.cardId);
      if (!location || !replayAnalysisCanAddToChain(state, operation.cardId)) break;
      const [card] = takeCardGroup(state, operation.cardId);
      if (!card) break;
      delete card.fields.attachedToCardId;
      markMovedCard(card, "chain");
      const entryId = uniqueAnalysisChainEntryId(
        state,
        card.id,
        session.history.length,
      );
      state.chain.push({
        id: entryId,
        fields: {
          analysisStatus: "what_if",
          analysisPlayerId: location.player.id,
          analysisSourceIndex: location.index,
          analysisSourceZone: location.zone,
          card: cardToJsonObject(card),
          sourceCardId: card.id,
        },
      });
      changed = true;
      break;
    }
    case "add_chain_target": {
      if (
        !replayAnalysisCanAddChainTarget(
          state,
          operation.entryId,
          operation.targetCardId,
        )
      ) {
        break;
      }
      const entry = state.chain.find((candidate) => candidate.id === operation.entryId);
      const sourceCard = entry ? cardFromAnalysisChainEntry(entry) : undefined;
      if (!entry || !sourceCard) break;
      entry.fields = {
        ...entry.fields,
        analysisTargetCardIds: [
          ...replayAnalysisChainTargetIds(state, entry.id),
          operation.targetCardId,
        ],
        sourceCardId: sourceCard.id,
      };
      changed = true;
      break;
    }
    case "clear_chain_targets": {
      const entry = state.chain.find((candidate) => candidate.id === operation.entryId);
      if (!entry || !replayAnalysisChainTargetIds(state, entry.id).length) break;
      delete entry.fields.analysisTargetCardIds;
      changed = true;
      break;
    }
    case "detach_card": {
      const location = findCardLocation(state, operation.cardId);
      if (!location || !attachedTo(location.card)) break;
      delete location.card.fields.attachedToCardId;
      location.card.fields = {
        ...location.card.fields,
        analysisStatus: "what_if",
      };
      changed = true;
      break;
    }
    case "remove_from_chain": {
      const entryIndex = state.chain.findIndex((entry) => entry.id === operation.entryId);
      if (entryIndex < 0) break;
      const entry = state.chain[entryIndex];
      const card = cardFromAnalysisChainEntry(entry);
      const playerId = textField(entry.fields.analysisPlayerId) ?? card?.ownerPlayerId;
      const player = playerId ? state.players[playerId] : undefined;
      if (!card || !player) break;
      const zone = textField(entry.fields.analysisSourceZone) ?? "hand";
      const requestedIndex = finiteCounter(entry.fields.analysisSourceIndex);
      state.chain.splice(entryIndex, 1);
      markMovedCard(card, zone);
      const targetZone = ensureZone(player, zone);
      targetZone.splice(Math.min(requestedIndex, targetZone.length), 0, card);
      changed = true;
      break;
    }
    case "restore_card": {
      changed = restoreCardToAnalysisStart(state, session.initialState, operation.cardId);
      break;
    }
  }

  if (!changed) return session;
  return {
    ...session,
    future: [],
    history: [...session.history, previous],
    state,
  };
}

export function undoReplayAnalysisOperation(
  session: ReplayAnalysisSession,
): ReplayAnalysisSession {
  const previous = session.history.at(-1);
  if (!previous) return session;
  return {
    ...session,
    future: [...session.future, cloneReplayState(session.state)],
    history: session.history.slice(0, -1),
    state: cloneReplayState(previous),
  };
}

export function redoReplayAnalysisOperation(
  session: ReplayAnalysisSession,
): ReplayAnalysisSession {
  const next = session.future.at(-1);
  if (!next) return session;
  return {
    ...session,
    future: session.future.slice(0, -1),
    history: [...session.history, cloneReplayState(session.state)],
    state: cloneReplayState(next),
  };
}

export function resetReplayAnalysisSession(
  session: ReplayAnalysisSession,
): ReplayAnalysisSession {
  if (!session.history.length && !session.future.length) return session;
  return {
    ...session,
    future: [],
    history: [],
    state: cloneReplayState(session.initialState),
  };
}

export function replayAnalysisChangedCardCount(state: ReplayState): number {
  let count = 0;
  for (const player of Object.values(state.players)) {
    for (const cards of Object.values(player.zones)) {
      count += cards.filter((card) => card.fields.analysisStatus === "what_if").length;
    }
  }
  count += state.chain.filter((entry) => entry.fields.analysisStatus === "what_if").length;
  return count;
}

export function replayAnalysisSelectedCard(
  state: ReplayState,
  cardId: string | null,
): ReplayCardState | null {
  return cardId ? findCardLocation(state, cardId)?.card ?? null : null;
}

export function replayAnalysisCardPlayer(
  state: ReplayState,
  cardId: string,
): ReplayPlayerState | null {
  return findCardLocation(state, cardId)?.player ?? null;
}

export function replayAnalysisCardLocation(
  state: ReplayState,
  cardId: string,
): ReplayAnalysisCardLocation | null {
  return findCardLocation(state, cardId) ?? null;
}

export function replayAnalysisCanMove(
  state: ReplayState,
  cardId: string,
  playerId: string,
  zone: string,
): boolean {
  const location = findCardLocation(state, cardId);
  const destinationFamily = zoneFamily(zone);
  return Boolean(
    location &&
    !location.card.isPlaceholder &&
    location.player.id === playerId &&
    isAnalysisDestinationFamily(destinationFamily) &&
    zoneFamily(location.zone) !== destinationFamily
  );
}

export function replayAnalysisCanAddToChain(
  state: ReplayState,
  cardId: string,
): boolean {
  const location = findCardLocation(state, cardId);
  return Boolean(
    location &&
    !location.card.isPlaceholder &&
    !descendantAttachmentIds(state, cardId).length
  );
}

export function replayAnalysisChainTargetIds(
  state: ReplayState,
  entryId: string,
): string[] {
  const entry = state.chain.find((candidate) => candidate.id === entryId);
  if (!entry || entry.fields.analysisStatus !== "what_if") return [];
  const value = entry.fields.analysisTargetCardIds;
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(
    (candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()),
  ))];
}

export function replayAnalysisCanAddChainTarget(
  state: ReplayState,
  entryId: string,
  targetCardId: string,
): boolean {
  const entry = state.chain.find((candidate) => candidate.id === entryId);
  const sourceCard = entry ? cardFromAnalysisChainEntry(entry) : undefined;
  return Boolean(
    entry &&
    entry.fields.analysisStatus === "what_if" &&
    sourceCard &&
    targetCardId.trim() &&
    sourceCard.id !== targetCardId &&
    !replayAnalysisChainTargetIds(state, entryId).includes(targetCardId)
  );
}

export function replayAnalysisCanAttach(
  state: ReplayState,
  cardId: string,
  targetCardId: string,
): boolean {
  if (cardId === targetCardId) return false;
  const source = findCardLocation(state, cardId);
  const target = findCardLocation(state, targetCardId);
  return Boolean(
    source &&
    target &&
    !source.card.isPlaceholder &&
    !target.card.isPlaceholder &&
    source.player.id === target.player.id &&
    isBoardCardZone(target.zone) &&
    attachedTo(source.card) !== target.card.id &&
    !attachmentPathIncludes(state, target.card.id, source.card.id),
  );
}

function findCardLocation(
  state: ReplayState,
  cardId: string,
): ReplayAnalysisCardLocation | undefined {
  for (const player of Object.values(state.players)) {
    for (const [zone, cards] of Object.entries(player.zones)) {
      const index = cards.findIndex((candidate) => candidate.id === cardId);
      if (index >= 0) return { card: cards[index], index, player, zone };
    }
  }
  return undefined;
}

function takeCardGroup(state: ReplayState, hostCardId: string): ReplayCardState[] {
  const host = findCardLocation(state, hostCardId);
  if (!host) return [];
  const attachedIds = descendantAttachmentIds(state, hostCardId);
  const orderedCards = [host.card];
  for (const id of attachedIds) {
    const location = findCardLocation(state, id);
    if (location) orderedCards.push(location.card);
  }
  for (const card of orderedCards) removeCard(state, card.id);
  return orderedCards;
}

function removeCard(state: ReplayState, cardId: string): ReplayCardState | undefined {
  const location = findCardLocation(state, cardId);
  if (!location) return undefined;
  const [card] = location.player.zones[location.zone]?.splice(location.index, 1) ?? [];
  return card;
}

function descendantAttachmentIds(state: ReplayState, hostCardId: string): string[] {
  const result: string[] = [];
  const pending = [hostCardId];
  const seen = new Set(pending);
  while (pending.length) {
    const targetId = pending.shift();
    for (const player of Object.values(state.players)) {
      for (const cards of Object.values(player.zones)) {
        for (const card of cards) {
          if (
            !seen.has(card.id) &&
            targetId &&
            attachedTo(card) === targetId
          ) {
            seen.add(card.id);
            result.push(card.id);
            pending.push(card.id);
          }
        }
      }
    }
  }
  return result;
}

function attachmentPathIncludes(
  state: ReplayState,
  startCardId: string,
  soughtCardId: string,
): boolean {
  let currentId: string | undefined = startCardId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    if (currentId === soughtCardId) return true;
    seen.add(currentId);
    const current = findCardLocation(state, currentId);
    currentId = current ? attachedTo(current.card) : undefined;
  }
  return false;
}

function restoreCardToAnalysisStart(
  state: ReplayState,
  initialState: ReplayState,
  cardId: string,
): boolean {
  const current = findCardLocation(state, cardId);
  const initial = findCardLocation(initialState, cardId);
  if (!current || !initial) return false;

  const followers = takeCardGroup(state, cardId).slice(1);
  const restoredCard = cloneCard(initial.card);
  const targetZone = ensureZone(state.players[initial.player.id], initial.zone);
  const insertionIndex = Math.min(initial.index, targetZone.length);
  targetZone.splice(insertionIndex, 0, restoredCard, ...followers);
  for (const follower of followers) markMovedCard(follower, initial.zone);
  return true;
}

function markMovedCard(card: ReplayCardState, zone: string): void {
  card.source = zone;
  card.fields = {
    ...card.fields,
    source: zone,
    analysisStatus: "what_if",
  };
}

function attachedTo(card: ReplayCardState): string | undefined {
  const value = card.fields.attachedToCardId;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function cloneCard(card: ReplayCardState): ReplayCardState {
  return JSON.parse(JSON.stringify(card)) as ReplayCardState;
}

function cardToJsonObject(card: ReplayCardState): JsonObject {
  return JSON.parse(JSON.stringify(card)) as JsonObject;
}

function cardFromAnalysisChainEntry(
  entry: ReplayState["chain"][number],
): ReplayCardState | undefined {
  const value = entry.fields.card;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const card = JSON.parse(JSON.stringify(value)) as ReplayCardState;
  return typeof card.id === "string" && card.id.trim() ? card : undefined;
}

function uniqueAnalysisChainEntryId(
  state: ReplayState,
  cardId: string,
  historyLength: number,
): string {
  const prefix = `analysis-chain-${cardId}`;
  let id = `${prefix}-${historyLength + 1}`;
  let suffix = historyLength + 1;
  const existing = new Set(state.chain.map((entry) => entry.id));
  while (existing.has(id)) {
    suffix += 1;
    id = `${prefix}-${suffix}`;
  }
  return id;
}

function textField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function ensureZone(player: ReplayPlayerState, zone: string): ReplayCardState[] {
  const requestedFamily = zoneFamily(zone);
  const existingKey = Object.keys(player.zones).find((key) => zoneFamily(key) === requestedFamily);
  const key = existingKey ?? zone;
  player.zones[key] ??= [];
  return player.zones[key];
}

function hasPublicIdentity(card: ReplayCardState): boolean {
  return Boolean(!card.isPlaceholder && (card.name.trim() || card.cardCode?.trim()));
}

function isPublicCardEvidence(card: ReplayCardState, zone: string): boolean {
  return !isPrivateKnowledgeZone(zone) && isPubliclyVisibleIdentity(card);
}

function isPubliclyVisibleIdentity(card: ReplayCardState): boolean {
  return hasPublicIdentity(card) && (
    card.fields?.hidden !== true || card.fields?.revealedToOpponent === true
  );
}

function isPrivateKnowledgeZone(zone: string): boolean {
  return [
    "cardsinhand",
    "deck",
    "exilehidden",
    "hand",
    "removed",
    "removedfromgame",
    "runedeck",
    "sideboard",
    "unknown",
  ]
    .includes(normalizeZone(zone));
}

function eventPrivatizesCard(
  event: CanonicalReplayV2["events"][number],
  cardId: string,
  playerId: string,
): boolean {
  if (event.kind !== "action") return false;
  return event.patch.operations.some((operation) => {
    if (operation.op === "zone_move") {
      return operation.cardId === cardId &&
        operation.to.playerId === playerId &&
        isPrivateKnowledgeZone(operation.to.zone) &&
        !isHandZone(operation.to.zone);
    }
    return operation.op === "zone_insert" &&
      operation.playerId === playerId &&
      isPrivateKnowledgeZone(operation.zone) &&
      !isHandZone(operation.zone) &&
      operation.cards.some((card) => card.id === cardId);
  });
}

function isHandZone(zone: string): boolean {
  return normalizeZone(zone).includes("hand");
}

function isBoardCardZone(zone: string): boolean {
  const normalized = normalizeZone(zone);
  return (
    normalized === "base" ||
    normalized === "board" ||
    normalized.includes("battlefield") ||
    normalized.includes("lane")
  );
}

function isAnalysisDestinationFamily(value: string): boolean {
  return [
    "hand",
    "base",
    "battlefielda",
    "battlefieldb",
    "runearea",
    "discard",
    "banished",
  ].includes(value);
}

function normalizeZone(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isStableTcgaCardId(cardId: string): boolean {
  return /^tcga_card_[a-f0-9]{16}$/i.test(cardId);
}

function isAnonymousAtlasHandCardId(cardId: string): boolean {
  return /^__hidden_zone__:[^:]+:hand:\d+$/i.test(cardId);
}

function anonymousAtlasHandIndex(cardId: string): number | undefined {
  const match = cardId.match(/^__hidden_zone__:[^:]+:hand:(\d+)$/i);
  if (!match) return undefined;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : undefined;
}

function zoneFamily(value: string): string {
  const normalized = normalizeZone(value);
  if (["hand", "cardsinhand"].includes(normalized)) return "hand";
  if (["discard", "trash", "graveyard", "recycle", "recyclepile"].includes(normalized)) return "discard";
  if ([
    "banish",
    "banished",
    "exile",
    "exiled",
    "exilehidden",
    "removed",
    "removedfromgame",
  ].includes(normalized)) {
    return "banished";
  }
  if (["runearea", "runes", "resources"].includes(normalized)) return "runearea";
  return normalized;
}

function finiteCounter(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function cloneObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
