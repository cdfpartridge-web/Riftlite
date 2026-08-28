import {
  cloneReplayState,
  reduceReplayEvent,
  seekReplayByEventIndex,
  type CanonicalReplayV2,
  type JsonObject,
  type ReplayCardState,
  type ReplayChainEntry,
  type ReplayState,
} from "@/lib/replay-v2";

type PublicKnowledgeInterval = {
  card: ReplayCardState;
  endEventIndex: number;
  gameId: string;
  playerId: string;
  startEventIndex: number;
};

type PublicKnowledgeIndexState = {
  active: Map<string, PublicKnowledgeInterval>;
  activeGameId: string;
  history: Map<string, PublicKnowledgeInterval[]>;
};

type FutureKnowledgeInterval = {
  card?: ReplayCardState;
  cardId: string;
  endEventIndex: number;
  gameId: string;
  playerId: string;
  startEventIndex: number;
};

type CardLocation = {
  card: ReplayCardState;
  playerId: string;
  publicZone: boolean;
  zone: string;
};

export type ReplayCardsUpProjection = {
  knownCardIds: string[];
  state: ReplayState;
};

export type ReplayCardsUpProjectionCache = {
  readonly replay: CanonicalReplayV2;
  readonly futureHistory: Map<string, FutureKnowledgeInterval[]>;
  readonly publicHistory: Map<string, PublicKnowledgeInterval[]>;
  lastEventIndex: number;
  /** Canonical playback state only; never contains Cards-up display mutations. */
  lastState: ReplayState | null;
};

const OPEN_INTERVAL_END = Number.MAX_SAFE_INTEGER;
const PUBLIC_ZONES = new Set([
  "banished",
  "base",
  "battlefield",
  "battlefielda",
  "battlefieldb",
  "battlefieldtoken",
  "board",
  "champion",
  "discard",
  "exile",
  "graveyard",
  "legend",
  "runearea",
  "trash",
]);

export function createReplayCardsUpProjectionCache(
  replay: CanonicalReplayV2,
): ReplayCardsUpProjectionCache {
  const indexes = buildCardsUpKnowledgeIndexes(replay);
  return {
    replay,
    futureHistory: indexes.futureHistory,
    publicHistory: indexes.publicHistory,
    lastEventIndex: -1,
    lastState: null,
  };
}

/**
 * Projects the Cards-up display incrementally from two one-time knowledge
 * indexes. Playback never scans the remaining replay timeline.
 */
export function projectReplayCardsUp(
  cache: ReplayCardsUpProjectionCache,
  eventIndex: number,
): ReplayCardsUpProjection {
  if (!Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex >= cache.replay.events.length) {
    throw new RangeError("Cards-up event index is outside the replay timeline.");
  }

  if (cache.lastState && cache.lastEventIndex === eventIndex) {
    const displayed = cloneReplayState(cache.lastState);
    applyCardsUpKnowledge(displayed, cache, eventIndex);
    return projectionResult(displayed);
  }

  if (!cache.lastState || eventIndex < cache.lastEventIndex) {
    const canonical = cloneReplayState(seekReplayByEventIndex(cache.replay, eventIndex).state);
    cache.lastEventIndex = eventIndex;
    cache.lastState = canonical;
    const displayed = cloneReplayState(canonical);
    applyCardsUpKnowledge(displayed, cache, eventIndex);
    return projectionResult(displayed);
  }

  let canonical = cloneReplayState(cache.lastState);
  for (let index = cache.lastEventIndex + 1; index <= eventIndex; index += 1) {
    const event = cache.replay.events[index];
    canonical = reduceReplayEvent(canonical, event);
  }

  cache.lastEventIndex = eventIndex;
  cache.lastState = canonical;
  const displayed = cloneReplayState(canonical);
  applyCardsUpKnowledge(displayed, cache, eventIndex);
  return projectionResult(displayed);
}

type AnonymousFutureEvidence = {
  handMutated: boolean;
  mutations: Array<
    | { count: number; index: number; kind: "insert" }
    | { indices: number[]; kind: "remove" }
  >;
  privateTransition: boolean;
  publicCards: ReplayCardState[];
};

type AnonymousFutureLineage = {
  intervals: FutureKnowledgeInterval[];
};

type AnonymousFutureCohort = {
  gameId: string;
  playerId: string;
  slots: Array<AnonymousFutureLineage | null>;
};

function buildCardsUpKnowledgeIndexes(
  replay: CanonicalReplayV2,
): {
  futureHistory: Map<string, FutureKnowledgeInterval[]>;
  publicHistory: Map<string, PublicKnowledgeInterval[]>;
} {
  const history = new Map<string, FutureKnowledgeInterval[]>();
  const active = new Map<string, FutureKnowledgeInterval>();
  const anonymousCohorts = new Map<string, AnonymousFutureCohort>();
  const publicIndex: PublicKnowledgeIndexState = {
    active: new Map(),
    activeGameId: "",
    history: new Map(),
  };
  let projected: ReplayState | null = null;
  let activeGameId = "";

  replay.events.forEach((event, eventIndex) => {
    const previousState = projected;
    const nextState = previousState
      ? reduceReplayEvent(previousState, event)
      : seekReplayByEventIndex(replay, eventIndex).state;
    const gameId = nextState.gameId ?? event.gameId ?? "";
    if (activeGameId && gameId && activeGameId !== gameId) {
      closeAllFutureIntervals(active, eventIndex - 1);
      resetAllAnonymousCohorts(anonymousCohorts, eventIndex - 1);
    }
    if (gameId) activeGameId = gameId;

    const privateTransitions = privateTransitionCardIds(event);
    const anonymousEvidence = anonymousFutureEvidence(event);
    if (event.kind === "snapshot") {
      resetAllAnonymousCohorts(anonymousCohorts, eventIndex - 1);
    } else {
      for (const [playerId, evidence] of anonymousEvidence) {
        if (!evidence.handMutated) continue;
        const cohort = anonymousCohorts.get(playerId);
        if (cohort?.gameId === gameId) {
          applyAnonymousFutureEvidence(
            cohort,
            evidence,
            nextState,
            eventIndex,
            history,
          );
        }
      }
    }

    const locations = cardLocations(nextState);
    indexPublicKnowledgeStep(
      publicIndex,
      eventIndex,
      gameId,
      locations,
      privateTransitions,
    );
    for (const [key, interval] of active) {
      if (interval.gameId !== gameId) {
        closeFutureInterval(active, key, interval, eventIndex - 1);
        continue;
      }
      if (privateTransitions.has(interval.cardId)) {
        closeFutureInterval(active, key, interval, eventIndex - 1);
        continue;
      }
      const location = locations.get(interval.cardId);
      if (!location || location.playerId !== interval.playerId) {
        closeFutureInterval(active, key, interval, eventIndex - 1);
        continue;
      }
      if (location.publicZone && isPubliclyVisibleIdentity(location.card)) {
        completeFutureInterval(active, key, interval, eventIndex - 1, location.card);
        continue;
      }
      if (!isHandZone(location.zone) || !location.card.isPlaceholder) {
        closeFutureInterval(active, key, interval, eventIndex - 1);
      }
    }

    startFutureHandIntervals(nextState, gameId, eventIndex, active, history);
    reconcileAnonymousCohorts(
      anonymousCohorts,
      nextState,
      gameId,
      eventIndex,
      history,
    );
    projected = nextState;
  });

  closeAllFutureIntervals(active, replay.events.length - 1);
  resetAllAnonymousCohorts(anonymousCohorts, replay.events.length - 1);
  return { futureHistory: history, publicHistory: publicIndex.history };
}

function startFutureHandIntervals(
  state: ReplayState,
  gameId: string,
  eventIndex: number,
  active: Map<string, FutureKnowledgeInterval>,
  history: Map<string, FutureKnowledgeInterval[]>,
): void {
  for (const player of Object.values(state.players)) {
    for (const [zone, cards] of Object.entries(player.zones)) {
      if (!isHandZone(zone)) continue;
      for (const card of cards) {
        if (!card.isPlaceholder || isAnonymousAtlasHandCardId(card.id)) continue;
        const key = knowledgeKey(gameId, card.id);
        if (active.has(key)) continue;
        const interval: FutureKnowledgeInterval = {
          cardId: card.id,
          endEventIndex: OPEN_INTERVAL_END,
          gameId,
          playerId: player.id,
          startEventIndex: eventIndex,
        };
        active.set(key, interval);
        const intervals = history.get(key) ?? [];
        intervals.push(interval);
        history.set(key, intervals);
      }
    }
  }
}

function applyAnonymousFutureEvidence(
  cohort: AnonymousFutureCohort,
  evidence: AnonymousFutureEvidence,
  nextState: ReplayState,
  eventIndex: number,
  history: Map<string, FutureKnowledgeInterval[]>,
): void {
  closeAnonymousCohortAliases(cohort, eventIndex - 1);
  const removedLineages: AnonymousFutureLineage[] = [];
  for (const mutation of evidence.mutations) {
    if (mutation.kind === "insert") {
      const index = Math.max(0, Math.min(mutation.index, cohort.slots.length));
      cohort.slots.splice(index, 0, ...Array<AnonymousFutureLineage | null>(mutation.count).fill(null));
      continue;
    }
    const removedForMutation: AnonymousFutureLineage[] = [];
    for (const index of [...mutation.indices].sort((left, right) => right - left)) {
      if (index < 0 || index >= cohort.slots.length) continue;
      const [removed] = cohort.slots.splice(index, 1);
      if (removed) removedForMutation.unshift(removed);
    }
    removedLineages.push(...removedForMutation);
  }

  if (
    !evidence.privateTransition &&
    removedLineages.length === evidence.publicCards.length
  ) {
    removedLineages.forEach((lineage, index) => {
      const publicCard = evidence.publicCards[index];
      if (!publicCard) return;
      lineage.intervals.forEach((interval) => {
        interval.card = cloneCard(publicCard);
      });
    });
  }

  restartAnonymousCohortAliases(cohort, nextState, eventIndex, history);
}

function reconcileAnonymousCohorts(
  cohorts: Map<string, AnonymousFutureCohort>,
  state: ReplayState,
  gameId: string,
  eventIndex: number,
  history: Map<string, FutureKnowledgeInterval[]>,
): void {
  for (const player of Object.values(state.players)) {
    const cards = anonymousHandCards(state, player.id);
    const existing = cohorts.get(player.id);
    if (!cards.length) {
      if (existing) {
        closeAnonymousCohortAliases(existing, eventIndex - 1);
        cohorts.delete(player.id);
      }
      continue;
    }
    if (!existing || existing.gameId !== gameId) {
      if (existing) closeAnonymousCohortAliases(existing, eventIndex - 1);
      const cohort: AnonymousFutureCohort = {
        gameId,
        playerId: player.id,
        slots: cards.map(() => ({ intervals: [] })),
      };
      cohorts.set(player.id, cohort);
      restartAnonymousCohortAliases(cohort, state, eventIndex, history);
      continue;
    }
    if (existing.slots.length !== cards.length) {
      closeAnonymousCohortAliases(existing, eventIndex - 1);
      existing.slots = cards.map(() => ({ intervals: [] }));
      restartAnonymousCohortAliases(existing, state, eventIndex, history);
    }
  }
}

function restartAnonymousCohortAliases(
  cohort: AnonymousFutureCohort,
  state: ReplayState,
  eventIndex: number,
  history: Map<string, FutureKnowledgeInterval[]>,
): void {
  const cards = anonymousHandCards(state, cohort.playerId);
  if (cohort.slots.length !== cards.length) {
    cohort.slots = cards.map(() => ({ intervals: [] }));
  }
  cards.forEach((card, index) => {
    const lineage = cohort.slots[index] ?? { intervals: [] };
    cohort.slots[index] = lineage;
    const interval: FutureKnowledgeInterval = {
      cardId: card.id,
      endEventIndex: OPEN_INTERVAL_END,
      gameId: cohort.gameId,
      playerId: cohort.playerId,
      startEventIndex: eventIndex,
    };
    lineage.intervals.push(interval);
    const key = knowledgeKey(cohort.gameId, card.id);
    const intervals = history.get(key) ?? [];
    intervals.push(interval);
    history.set(key, intervals);
  });
}

function closeAnonymousCohortAliases(
  cohort: AnonymousFutureCohort,
  endEventIndex: number,
): void {
  for (const lineage of cohort.slots) {
    const interval = lineage?.intervals.at(-1);
    if (!interval || interval.endEventIndex !== OPEN_INTERVAL_END) continue;
    interval.endEventIndex = Math.max(interval.startEventIndex, endEventIndex);
  }
}

function resetAllAnonymousCohorts(
  cohorts: Map<string, AnonymousFutureCohort>,
  endEventIndex: number,
): void {
  for (const cohort of cohorts.values()) {
    closeAnonymousCohortAliases(cohort, endEventIndex);
  }
  cohorts.clear();
}

function anonymousHandCards(state: ReplayState, playerId: string): ReplayCardState[] {
  const player = state.players[playerId];
  if (!player) return [];
  return Object.entries(player.zones).flatMap(([zone, cards]) => (
    isHandZone(zone)
      ? cards.filter((card) => card.isPlaceholder && isAnonymousAtlasHandCardId(card.id))
      : []
  ));
}

function anonymousFutureEvidence(
  event: CanonicalReplayV2["events"][number],
): Map<string, AnonymousFutureEvidence> {
  const result = new Map<string, AnonymousFutureEvidence>();
  if (event.kind !== "action") return result;
  const evidenceFor = (playerId: string) => {
    const evidence = result.get(playerId) ?? {
      handMutated: false,
      mutations: [],
      privateTransition: false,
      publicCards: [],
    };
    result.set(playerId, evidence);
    return evidence;
  };

  for (const operation of event.patch.operations) {
    if (operation.op === "zone_remove" && isHandZone(operation.zone)) {
      const removed = operation.cardIds.filter(isAnonymousAtlasHandCardId);
      if (removed.length) {
        const evidence = evidenceFor(operation.playerId);
        evidence.handMutated = true;
        evidence.mutations.push({
          indices: removed.flatMap((cardId) => {
            const index = anonymousAtlasHandIndex(cardId);
            return index === undefined ? [] : [index];
          }),
          kind: "remove",
        });
      }
      continue;
    }
    if (operation.op === "zone_insert") {
      const evidence = evidenceFor(operation.playerId);
      if (
        isPrivateKnowledgeZone(operation.zone) &&
        !isHandZone(operation.zone) &&
        operation.cards.length > 0
      ) {
        evidence.privateTransition = true;
      }
      if (
        isHandZone(operation.zone) &&
        operation.cards.some((card) => card.isPlaceholder && isAnonymousAtlasHandCardId(card.id))
      ) {
        evidence.handMutated = true;
        evidence.mutations.push({
          count: operation.cards.filter(
            (card) => card.isPlaceholder && isAnonymousAtlasHandCardId(card.id),
          ).length,
          index: operation.index,
          kind: "insert",
        });
      }
      if (event.actionType === "move_card") {
        evidence.publicCards.push(...operation.cards.filter(
          (card) => isPublicCardEvidence(card, operation.zone) &&
            (!card.ownerPlayerId || card.ownerPlayerId === operation.playerId),
        ));
      }
      continue;
    }
    if (operation.op === "zone_move") {
      const fromEvidence = evidenceFor(operation.from.playerId);
      if (isHandZone(operation.from.zone) && isAnonymousAtlasHandCardId(operation.cardId)) {
        fromEvidence.handMutated = true;
        const index = anonymousAtlasHandIndex(operation.cardId);
        if (index !== undefined) {
          fromEvidence.mutations.push({ indices: [index], kind: "remove" });
        }
        if (operation.card && isPublicCardEvidence(operation.card, operation.to.zone)) {
          fromEvidence.publicCards.push(operation.card);
        }
      }
      if (
        isPrivateKnowledgeZone(operation.to.zone) &&
        !isHandZone(operation.to.zone) &&
        isAnonymousAtlasHandCardId(operation.cardId)
      ) {
        fromEvidence.privateTransition = true;
      }
      if (
        isHandZone(operation.to.zone) &&
        operation.card?.isPlaceholder &&
        isAnonymousAtlasHandCardId(operation.card.id)
      ) {
        const toEvidence = evidenceFor(operation.to.playerId);
        toEvidence.handMutated = true;
        toEvidence.mutations.push({ count: 1, index: operation.to.index, kind: "insert" });
      }
      continue;
    }
    if (operation.op !== "chain_insert") continue;
    operation.entries.forEach((entry, index) => {
      const fromZone = firstText(entry.fields.fromZone);
      const card = cardFromChain(entry, index);
      const playerId = firstText(entry.fields.byPlayerId, card?.ownerPlayerId);
      if (playerId && isHandZone(fromZone) && card && isPubliclyVisibleIdentity(card)) {
        evidenceFor(playerId).publicCards.push(card);
      }
    });
  }

  for (const evidence of result.values()) {
    evidence.publicCards = uniquePublicCards(evidence.publicCards);
  }
  return result;
}

function completeFutureInterval(
  active: Map<string, FutureKnowledgeInterval>,
  key: string,
  interval: FutureKnowledgeInterval,
  endEventIndex: number,
  card: ReplayCardState,
): void {
  interval.card = cloneCard(card);
  closeFutureInterval(active, key, interval, endEventIndex);
}

function closeFutureInterval(
  active: Map<string, FutureKnowledgeInterval>,
  key: string,
  interval: FutureKnowledgeInterval,
  endEventIndex: number,
): void {
  interval.endEventIndex = Math.max(interval.startEventIndex, endEventIndex);
  active.delete(key);
}

function closeAllFutureIntervals(
  active: Map<string, FutureKnowledgeInterval>,
  endEventIndex: number,
): void {
  for (const [key, interval] of active) {
    closeFutureInterval(active, key, interval, endEventIndex);
  }
}

function indexPublicKnowledgeStep(
  index: PublicKnowledgeIndexState,
  eventIndex: number,
  gameId: string,
  locations: Map<string, CardLocation>,
  privateTransitions: Set<string>,
): void {
  if (index.activeGameId && gameId && index.activeGameId !== gameId) {
    closeAllIntervals(index.active, eventIndex - 1);
  }
  if (gameId) index.activeGameId = gameId;

  for (const [key, interval] of index.active) {
    if (interval.gameId !== gameId) {
      closeInterval(index.active, key, interval, eventIndex - 1);
      continue;
    }
    if (privateTransitions.has(interval.card.id)) {
      closeInterval(index.active, key, interval, eventIndex - 1);
      continue;
    }
    const location = locations.get(interval.card.id);
    if (!location) {
      closeInterval(index.active, key, interval, eventIndex - 1);
      continue;
    }
    const publiclyVisible = location.publicZone && isPubliclyVisibleIdentity(location.card);
    if (!isHandZone(location.zone) && !publiclyVisible) {
      closeInterval(index.active, key, interval, eventIndex - 1);
      continue;
    }
    if (
      location.playerId !== interval.playerId ||
      (!location.card.isPlaceholder && !samePublicIdentity(location.card, interval.card))
    ) {
      closeInterval(index.active, key, interval, eventIndex - 1);
    }
  }

  for (const location of locations.values()) {
    if (!location.publicZone || !isPubliclyVisibleIdentity(location.card)) continue;
    const key = knowledgeKey(gameId, location.card.id);
    const existing = index.active.get(key);
    if (existing && samePublicIdentity(existing.card, location.card)) continue;
    if (existing) closeInterval(index.active, key, existing, eventIndex - 1);
    const interval: PublicKnowledgeInterval = {
      card: cloneCard(location.card),
      endEventIndex: OPEN_INTERVAL_END,
      gameId,
      playerId: location.playerId,
      startEventIndex: eventIndex,
    };
    index.active.set(key, interval);
    const intervals = index.history.get(key) ?? [];
    intervals.push(interval);
    index.history.set(key, intervals);
  }
}

function applyCardsUpKnowledge(
  state: ReplayState,
  cache: ReplayCardsUpProjectionCache,
  eventIndex: number,
): void {
  clearCardsUpKnowledge(state);
  applyPreviouslyPublicHandKnowledge(state, cache.publicHistory, eventIndex);
  applyFuturePublicHandKnowledge(state, cache.futureHistory, eventIndex);
}

function clearCardsUpKnowledge(state: ReplayState): void {
  for (const player of Object.values(state.players)) {
    for (const cards of Object.values(player.zones)) {
      cards.forEach(clearAnalysisKnowledge);
    }
  }
}

function applyPreviouslyPublicHandKnowledge(
  state: ReplayState,
  history: Map<string, PublicKnowledgeInterval[]>,
  eventIndex: number,
): void {
  const gameId = state.gameId ?? "";
  for (const player of Object.values(state.players)) {
    for (const [zone, cards] of Object.entries(player.zones)) {
      const hand = isHandZone(zone);
      for (const card of cards) {
        if (!hand) {
          clearAnalysisKnowledge(card);
          continue;
        }
        const interval = activeKnowledgeInterval(
          history.get(knowledgeKey(gameId, card.id)),
          eventIndex,
          player.id,
        );
        if (!interval || (!card.isPlaceholder && !samePublicIdentity(card, interval.card))) {
          if (card.fields.analysisKnowledge === "previous_reveal") clearAnalysisKnowledge(card);
          continue;
        }
        revealPreviouslyPublicCard(card, interval.card, player.id, zone);
      }
    }
  }
}

function applyFuturePublicHandKnowledge(
  state: ReplayState,
  history: Map<string, FutureKnowledgeInterval[]>,
  eventIndex: number,
): void {
  const gameId = state.gameId ?? "";
  for (const player of Object.values(state.players)) {
    for (const [zone, cards] of Object.entries(player.zones)) {
      if (!isHandZone(zone)) continue;
      for (const card of cards) {
        if (card.fields.analysisKnowledge === "previous_reveal") continue;
        const interval = futureKnowledgeInterval(
          history.get(knowledgeKey(gameId, card.id)),
          eventIndex,
          player.id,
        );
        if (
          !interval?.card ||
          (!card.isPlaceholder && !samePublicIdentity(card, interval.card))
        ) {
          continue;
        }
        revealFuturePublicCard(card, interval.card, player.id, zone);
      }
    }
  }
}

function activeKnowledgeInterval(
  intervals: PublicKnowledgeInterval[] | undefined,
  eventIndex: number,
  playerId: string,
): PublicKnowledgeInterval | undefined {
  if (!intervals) return undefined;
  for (let index = intervals.length - 1; index >= 0; index -= 1) {
    const interval = intervals[index];
    if (
      interval.playerId === playerId &&
      interval.startEventIndex <= eventIndex &&
      interval.endEventIndex >= eventIndex
    ) {
      return interval;
    }
  }
  return undefined;
}

function futureKnowledgeInterval(
  intervals: FutureKnowledgeInterval[] | undefined,
  eventIndex: number,
  playerId: string,
): FutureKnowledgeInterval | undefined {
  if (!intervals) return undefined;
  for (let index = intervals.length - 1; index >= 0; index -= 1) {
    const interval = intervals[index];
    if (
      interval.card &&
      interval.playerId === playerId &&
      interval.startEventIndex <= eventIndex &&
      interval.endEventIndex >= eventIndex
    ) {
      return interval;
    }
  }
  return undefined;
}

function revealPreviouslyPublicCard(
  card: ReplayCardState,
  publicCard: ReplayCardState,
  playerId: string,
  zone: string,
): void {
  const source = card.source ?? zone;
  card.name = publicCard.name;
  card.cardCode = publicCard.cardCode;
  card.ownerPlayerId = card.ownerPlayerId ?? publicCard.ownerPlayerId ?? playerId;
  card.source = source;
  card.exhausted = false;
  card.isPlaceholder = false;
  card.fields = {
    ...card.fields,
    analysisKnowledge: "previous_reveal",
    exhausted: false,
    isPlaceholder: false,
    ownerPlayerId: card.ownerPlayerId,
    source,
  };
}

function revealFuturePublicCard(
  card: ReplayCardState,
  publicCard: ReplayCardState,
  playerId: string,
  zone: string,
): void {
  const source = card.source ?? zone;
  card.name = publicCard.name;
  card.cardCode = publicCard.cardCode;
  card.ownerPlayerId = card.ownerPlayerId ?? publicCard.ownerPlayerId ?? playerId;
  card.source = source;
  card.exhausted = false;
  card.isPlaceholder = false;
  card.fields = {
    ...card.fields,
    analysisKnowledge: "future_reveal",
    exhausted: false,
    isPlaceholder: false,
    ownerPlayerId: card.ownerPlayerId,
    source,
  };
}

function clearAnalysisKnowledge(card: ReplayCardState): void {
  if (card.fields.analysisKnowledge === undefined) return;
  const fields = { ...card.fields };
  delete fields.analysisKnowledge;
  card.fields = fields;
}

function cardLocations(state: ReplayState): Map<string, CardLocation> {
  const result = new Map<string, CardLocation>();
  for (const player of Object.values(state.players)) {
    for (const [zone, cards] of Object.entries(player.zones)) {
      const publicZone = PUBLIC_ZONES.has(normalizeZone(zone));
      for (const card of cards) {
        result.set(card.id, { card, playerId: player.id, publicZone, zone });
      }
    }
  }
  state.chain.forEach((entry, index) => {
    const card = cardFromChain(entry, index);
    if (!card) return;
    result.set(card.id, {
      card,
      playerId: card.ownerPlayerId ?? "",
      publicZone: true,
      zone: "chain",
    });
  });
  return result;
}

function cardFromChain(entry: ReplayChainEntry, index: number): ReplayCardState | undefined {
  const fields = entry.fields;
  const candidate = [fields.card, fields.sourceCard, fields.actionCard, fields.payload]
    .find(isJsonObject);
  const record = candidate ?? fields;
  const nestedFields = isJsonObject(record.fields) ? record.fields : {};
  const name = firstText(record.name, record.cardName, record.title, fields.label, fields.actionType);
  const cardCode = firstText(record.cardCode, record.code, record.cardId);
  if (!name && !cardCode) return undefined;
  return {
    id: firstText(record.instanceId, record.cardInstanceId, record.id) || entry.id || `chain-${index}`,
    name: name || cardCode || "Chain action",
    cardCode,
    exhausted: record.exhausted === true,
    isPlaceholder: record.isPlaceholder === true,
    ownerPlayerId: firstText(record.ownerPlayerId, fields.byPlayerId, fields.actorPlayerId),
    source: firstText(record.source) || "chain",
    fields: { ...record, ...nestedFields },
  };
}

function projectionResult(state: ReplayState): ReplayCardsUpProjection {
  const knownCardIds = Object.values(state.players).flatMap((player) =>
    Object.entries(player.zones).flatMap(([zone, cards]) =>
      isHandZone(zone)
        ? cards.filter(isAnalysisKnownCard).map((card) => card.id)
        : [],
    ),
  );
  return { knownCardIds, state };
}

function isAnalysisKnownCard(card: ReplayCardState): boolean {
  return card.fields.analysisKnowledge === "future_reveal" ||
    card.fields.analysisKnowledge === "previous_reveal";
}

function isHandZone(zone: string): boolean {
  return normalizeZone(zone) === "hand";
}

function normalizeZone(zone: string): string {
  return zone.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function privateTransitionCardIds(
  event: CanonicalReplayV2["events"][number],
): Set<string> {
  const result = new Set<string>();
  if (event.kind !== "action") return result;
  for (const operation of event.patch.operations) {
    if (
      operation.op === "zone_move" &&
      isPrivateKnowledgeZone(operation.to.zone) &&
      !isHandZone(operation.to.zone)
    ) {
      result.add(operation.cardId);
    } else if (
      operation.op === "zone_insert" &&
      isPrivateKnowledgeZone(operation.zone) &&
      !isHandZone(operation.zone)
    ) {
      operation.cards.forEach((card) => result.add(card.id));
    }
  }
  return result;
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
  ].includes(normalizeZone(zone));
}

function knowledgeKey(gameId: string, cardId: string): string {
  return `${gameId}\u0000${cardId}`;
}

function closeInterval(
  active: Map<string, PublicKnowledgeInterval>,
  key: string,
  interval: PublicKnowledgeInterval,
  endEventIndex: number,
): void {
  interval.endEventIndex = Math.max(interval.startEventIndex, endEventIndex);
  active.delete(key);
}

function closeAllIntervals(
  active: Map<string, PublicKnowledgeInterval>,
  endEventIndex: number,
): void {
  for (const [key, interval] of active) closeInterval(active, key, interval, endEventIndex);
}

function hasPublicIdentity(card: ReplayCardState): boolean {
  return !card.isPlaceholder && Boolean(card.cardCode?.trim() || card.name?.trim());
}

function isPubliclyVisibleIdentity(card: ReplayCardState): boolean {
  return hasPublicIdentity(card) && (
    card.fields?.hidden !== true || card.fields?.revealedToOpponent === true
  );
}

function isPublicCardEvidence(card: ReplayCardState, zone: string): boolean {
  return !isPrivateKnowledgeZone(zone) && isPubliclyVisibleIdentity(card);
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

function isAnonymousAtlasHandCardId(cardId: string): boolean {
  return /^__hidden_zone__:[^:]+:hand:\d+$/i.test(cardId);
}

function anonymousAtlasHandIndex(cardId: string): number | undefined {
  const match = cardId.match(/^__hidden_zone__:[^:]+:hand:(\d+)$/i);
  if (!match) return undefined;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : undefined;
}

function samePublicIdentity(left: ReplayCardState, right: ReplayCardState): boolean {
  const leftCode = left.cardCode?.trim().toUpperCase();
  const rightCode = right.cardCode?.trim().toUpperCase();
  if (leftCode && rightCode) return leftCode === rightCode;
  const leftName = left.name?.trim().toLowerCase();
  const rightName = right.name?.trim().toLowerCase();
  return Boolean(leftName && rightName && leftName === rightName);
}

function cloneCard(card: ReplayCardState): ReplayCardState {
  return { ...card, fields: { ...card.fields } };
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstText(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))
    ?.trim() ?? "";
}
