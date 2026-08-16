import { createHash } from "node:crypto";

import registryData from "@/lib/mulligan-lab/card-registry-v1.json";
import type {
  CanonicalReplayV2,
  JsonObject,
  JsonValue,
  ReplayActionEvent,
  ReplayParticipant,
  ReplaySnapshot,
  ReplaySnapshotEvent,
} from "@/lib/replay-v2";
import { seekReplayByEventIndex } from "@/lib/replay-v2";

const CARD_CODE = /^[A-Z]{3}-\d{3}(?:[A-Z]|\*)?$/;
const MAIN_DECK_SIZE = 40;
const REGISTRY = registryData.cards as Record<string, RegistryCard>;
const FORBIDDEN_DECK_TYPES = new Set(["legend", "battlefield", "rune", "token"]);

type RegistryCard = { basePrintId: string; name: string; type: string; supertype?: string | null };

export type SideboardLabCard = {
  cardCode: string;
  name: string;
};

export type SideboardLabDeckCard = SideboardLabCard & {
  count: number;
};

export type SideboardLabDeck = {
  fingerprint: string;
  chosenChampionCode?: string;
  mainDeck: SideboardLabDeckCard[];
  sideboard: SideboardLabDeckCard[];
};

export type ObservedSideboardCandidate = {
  observedDecisionId: string;
  contributorKey: string;
  observation: {
    provider: "atlas";
    matchKey: string;
    targetGameNumber: 2 | 3;
    eventKey: string;
    observedOn: string;
    priorGameWon: boolean;
    nextInitiative?: "first" | "second" | "unknown";
  };
  matchup: {
    playerLegend: SideboardLabCard;
    opponentLegend: SideboardLabCard;
  };
  deck: SideboardLabDeck;
  submittedDeck: SideboardLabDeck;
  cardsIn: SideboardLabDeckCard[];
  cardsOut: SideboardLabDeckCard[];
  wonGame: boolean;
};

export type StoredSideboardDecision = Omit<ObservedSideboardCandidate, "contributorKey">;

export type SideboardLabExtractionRejectionCode =
  | "invalid_canonical_replay"
  | "unsupported_provider"
  | "collaboration_not_eligible"
  | "missing_contributor"
  | "missing_perspective"
  | "missing_participant"
  | "missing_game_1"
  | "missing_game_2"
  | "incomplete_game_result"
  | "missing_confirmed_sideboard_action"
  | "ambiguous_confirmed_sideboard_action"
  | "missing_baseline_deck"
  | "invalid_baseline_deck"
  | "missing_submitted_deck"
  | "invalid_submitted_deck"
  | "conflicting_submitted_decks"
  | "card_pool_changed"
  | "unbalanced_swap"
  | "sideboard_delta_mismatch"
  | "missing_player_legend"
  | "missing_opponent_legend"
  | "invalid_observation_time";

export type SideboardLabExtractionAudit = {
  candidates: ObservedSideboardCandidate[];
  rejection: null | {
    code: SideboardLabExtractionRejectionCode;
    /** Non-identifying diagnostics suitable for corpus audits and metrics. */
    details?: Record<string, string | number | boolean>;
  };
};

export function withoutSideboardContributor(
  candidate: ObservedSideboardCandidate,
): StoredSideboardDecision {
  return {
    observedDecisionId: candidate.observedDecisionId,
    observation: candidate.observation,
    matchup: candidate.matchup,
    deck: candidate.deck,
    submittedDeck: candidate.submittedDeck,
    cardsIn: candidate.cardsIn,
    cardsOut: candidate.cardsOut,
    wonGame: candidate.wonGame,
  };
}

/**
 * Extracts the perspective player's confirmed Atlas Game 2 choice and, when
 * fully proven, the separate Game 3 choice from the post-Game-2 baseline.
 * It intentionally accepts only complete, registry-backed before/after lists;
 * an attractive but ambiguous partial capture is less useful than no fact.
 */
export function extractObservedSideboardDecisions(
  replay: CanonicalReplayV2,
  contributorKey: string,
): ObservedSideboardCandidate[] {
  return auditObservedSideboardDecisions(replay, contributorKey).candidates;
}

/**
 * Runs the strict extractor while retaining one stable reason when a replay is
 * ineligible. The details deliberately contain no account/player identifiers.
 */
export function auditObservedSideboardDecisions(
  replay: CanonicalReplayV2,
  contributorKey: string,
): SideboardLabExtractionAudit {
  const reject = (
    code: SideboardLabExtractionRejectionCode,
    details?: Record<string, string | number | boolean>,
  ): SideboardLabExtractionAudit => ({
    candidates: [],
    rejection: details && Object.keys(details).length > 0 ? { code, details } : { code },
  });

  if (replay.schema !== "riftlite-canonical-replay" || replay.version !== 2) {
    return reject("invalid_canonical_replay");
  }
  if (replay.source.schema !== "riftreplay-raw-capture") {
    return reject("unsupported_provider");
  }
  if (replay.collaboration) return reject("collaboration_not_eligible");
  if (!contributorKey) return reject("missing_contributor");
  if (!replay.series.perspectivePlayerId) return reject("missing_perspective");

  const perspectivePlayerId = replay.series.perspectivePlayerId;
  const participant = replay.series.participants.find(({ id }) => id === perspectivePlayerId);
  const opponent = replay.series.participants.find(({ id }) => id !== perspectivePlayerId);
  if (!participant || !opponent) return reject("missing_participant");

  const firstGame = replay.series.games.find((game) => game.gameNumber === 1 && game.ordinal === 1)
    ?? replay.series.games.find((game) => game.gameNumber === 1);
  const targetGame = replay.series.games.find((game) => game.gameNumber === 2 && game.ordinal === 2)
    ?? replay.series.games.find((game) => game.gameNumber === 2);
  if (!firstGame) return reject("missing_game_1");
  if (!targetGame) return reject("missing_game_2");

  const priorGameWon = perspectiveResult(firstGame.result, perspectivePlayerId);
  const wonGame = perspectiveResult(targetGame.result, perspectivePlayerId);
  if (priorGameWon === null || wonGame === null) {
    return reject("incomplete_game_result", {
      game1Decisive: priorGameWon !== null,
      game2Decisive: wonGame !== null,
    });
  }

  const actions = confirmedPerspectiveSideboardActions(replay, targetGame, perspectivePlayerId);
  if (actions.length === 0) return reject("missing_confirmed_sideboard_action");
  if (actions.length !== 1) {
    return reject("ambiguous_confirmed_sideboard_action", { actionCount: actions.length });
  }
  const action = actions[0];

  // registeredDeck is immutable provider registration. `participant.deck` and
  // `submittedDeck` may be the last submitted deck after the whole capture was
  // merged, so using either as Game 2's baseline can leak a Game 3 decision.
  const baselineSource = jsonObject(participant.fields.registeredDeck)
    ?? initialPerspectiveDeckSnapshot(replay, targetGame.eventStartIndex, perspectivePlayerId);
  if (!baselineSource) return reject("missing_baseline_deck");

  const deck = normalizeDeck(baselineSource);
  if (!deck) {
    const cardCode = firstUnregisteredDeckCode(baselineSource);
    return reject("invalid_baseline_deck", cardCode ? { unregisteredCardCode: cardCode } : undefined);
  }

  const submitted = exactSubmittedDeckFromPatch(action, perspectivePlayerId);
  if (!submitted.source) return reject(submitted.code, submitted.details);
  const submittedSource = submitted.source;
  const submittedDeck = normalizeDeck(submittedSource);
  if (!submittedDeck) {
    const cardCode = firstUnregisteredDeckCode(submittedSource);
    return reject("invalid_submitted_deck", cardCode ? { unregisteredCardCode: cardCode } : undefined);
  }
  if (!sameCardPool(deck, submittedDeck)) return reject("card_pool_changed");

  const cardsIn = mainDeckDelta(deck.mainDeck, submittedDeck.mainDeck, "in");
  const cardsOut = mainDeckDelta(deck.mainDeck, submittedDeck.mainDeck, "out");
  const incomingCount = cardTotal(cardsIn);
  const outgoingCount = cardTotal(cardsOut);
  if (incomingCount !== outgoingCount) {
    return reject("unbalanced_swap", { incomingCount, outgoingCount });
  }
  if (!sideboardDeltasMatch(deck, submittedDeck, cardsIn, cardsOut)) {
    return reject("sideboard_delta_mismatch");
  }

  const playerLegend = legendForParticipant(participant, replay, perspectivePlayerId, targetGame.eventStartIndex);
  const opponentLegend = legendForParticipant(opponent, replay, opponent.id, targetGame.eventStartIndex);
  const observedAt = epochMilliseconds(action.at);
  if (!playerLegend) return reject("missing_player_legend");
  if (!opponentLegend) return reject("missing_opponent_legend");
  if (observedAt === null) return reject("invalid_observation_time");
  const firstPlayerId = seekReplayByEventIndex(replay, targetGame.eventEndIndex).state.room.firstPlayerId;
  const nextInitiative = firstPlayerId === perspectivePlayerId
    ? "first" as const
    : firstPlayerId === opponent.id ? "second" as const : "unknown" as const;

  const game2Candidate: ObservedSideboardCandidate = {
    observedDecisionId: `sd1_${digest([
      replay.id,
      targetGame.id,
      action.id,
      deck.fingerprint,
      submittedDeck.fingerprint,
    ]).slice(0, 32)}`,
    contributorKey,
    observation: {
      provider: "atlas",
      matchKey: `sm1_${digest([replay.id, replay.series.id, deck.fingerprint]).slice(0, 32)}`,
      targetGameNumber: 2,
      eventKey: `se1_${digest([replay.id, action.id, action.sourceMessageId]).slice(0, 32)}`,
      observedOn: new Date(observedAt).toISOString().slice(0, 10),
      priorGameWon,
      nextInitiative,
    },
    matchup: { playerLegend, opponentLegend },
    deck,
    submittedDeck,
    cardsIn,
    cardsOut,
    wonGame,
  };
  const candidates = [game2Candidate];
  const thirdGame = replay.series.games.find((game) => game.gameNumber === 3 && game.ordinal === 3)
    ?? replay.series.games.find((game) => game.gameNumber === 3);
  if (thirdGame) {
    const thirdWon = perspectiveResult(thirdGame.result, perspectivePlayerId);
    const thirdActions = confirmedPerspectiveSideboardActions(replay, thirdGame, perspectivePlayerId);
    if (thirdWon !== null && thirdActions.length === 1) {
      const thirdAction = thirdActions[0]!;
      const thirdSubmitted = exactSubmittedDeckFromPatch(thirdAction, perspectivePlayerId);
      const thirdSubmittedDeck = thirdSubmitted.source ? normalizeDeck(thirdSubmitted.source) : null;
      if (thirdSubmittedDeck && sameCardPool(submittedDeck, thirdSubmittedDeck)) {
        const thirdCardsIn = mainDeckDelta(submittedDeck.mainDeck, thirdSubmittedDeck.mainDeck, "in");
        const thirdCardsOut = mainDeckDelta(submittedDeck.mainDeck, thirdSubmittedDeck.mainDeck, "out");
        const incomingCount = cardTotal(thirdCardsIn);
        const outgoingCount = cardTotal(thirdCardsOut);
        const thirdObservedAt = epochMilliseconds(thirdAction.at);
        if (
          incomingCount === outgoingCount &&
          sideboardDeltasMatch(submittedDeck, thirdSubmittedDeck, thirdCardsIn, thirdCardsOut) &&
          thirdObservedAt !== null
        ) {
          const firstPlayerId = seekReplayByEventIndex(replay, thirdGame.eventEndIndex).state.room.firstPlayerId;
          candidates.push({
            observedDecisionId: `sd1_${digest([
              replay.id,
              thirdGame.id,
              thirdAction.id,
              submittedDeck.fingerprint,
              thirdSubmittedDeck.fingerprint,
            ]).slice(0, 32)}`,
            contributorKey,
            observation: {
              provider: "atlas",
              matchKey: `sm1_${digest([replay.id, replay.series.id, submittedDeck.fingerprint]).slice(0, 32)}`,
              targetGameNumber: 3,
              eventKey: `se1_${digest([replay.id, thirdAction.id, thirdAction.sourceMessageId]).slice(0, 32)}`,
              observedOn: new Date(thirdObservedAt).toISOString().slice(0, 10),
              priorGameWon: wonGame,
              nextInitiative: firstPlayerId === perspectivePlayerId
                ? "first"
                : firstPlayerId === opponent.id ? "second" : "unknown",
            },
            matchup: { playerLegend, opponentLegend },
            deck: submittedDeck,
            submittedDeck: thirdSubmittedDeck,
            cardsIn: thirdCardsIn,
            cardsOut: thirdCardsOut,
            wonGame: thirdWon,
          });
        }
      }
    }
  }
  return { candidates, rejection: null };
}

export function sideboardDeckFingerprint(
  mainDeck: SideboardLabDeckCard[],
  sideboard: SideboardLabDeckCard[],
): string {
  const line = (card: SideboardLabDeckCard) => `${card.cardCode}:${card.count}`;
  return createHash("sha256").update(JSON.stringify({
    mainDeck: [...mainDeck].sort(compareDeckCards).map(line),
    sideboard: [...sideboard].sort(compareDeckCards).map(line),
  })).digest("hex");
}

/**
 * Chosen Champion is provenance, not a guess from the provider's section
 * label. Legacy facts occasionally put an ordinary card in that section; keep
 * the legal forty-card deck but omit the unproven designation.
 */
export function normalizeSideboardChampionProvenance(
  deck: SideboardLabDeck,
): SideboardLabDeck {
  const chosenChampionCode = validatedChosenChampionCode(deck);
  if (chosenChampionCode === deck.chosenChampionCode) return deck;
  return {
    fingerprint: deck.fingerprint,
    mainDeck: deck.mainDeck,
    sideboard: deck.sideboard,
  };
}

/** Revalidates a persisted candidate without trusting stored derived fields. */
export function isValidObservedSideboardCandidate(candidate: ObservedSideboardCandidate): boolean {
  try {
    if (
      !/^sd1_[a-f0-9]{32}$/.test(candidate.observedDecisionId) ||
      !candidate.contributorKey ||
      candidate.observation.provider !== "atlas" ||
      (candidate.observation.targetGameNumber !== 2 && candidate.observation.targetGameNumber !== 3) ||
      !/^sm1_[a-f0-9]{32}$/.test(candidate.observation.matchKey) ||
      !/^se1_[a-f0-9]{32}$/.test(candidate.observation.eventKey) ||
      !isIsoDay(candidate.observation.observedOn) ||
      typeof candidate.observation.priorGameWon !== "boolean" ||
      (candidate.observation.nextInitiative !== undefined &&
        !["first", "second", "unknown"].includes(candidate.observation.nextInitiative)) ||
      typeof candidate.wonGame !== "boolean" ||
      !sameCanonicalCard(candidate.matchup.playerLegend, canonicalCard(candidate.matchup.playerLegend.cardCode, "legend")) ||
      !sameCanonicalCard(candidate.matchup.opponentLegend, canonicalCard(candidate.matchup.opponentLegend.cardCode, "legend")) ||
      !isCanonicalDeck(candidate.deck) ||
      !isCanonicalDeck(candidate.submittedDeck) ||
      !sameCardPool(candidate.deck, candidate.submittedDeck)
    ) return false;

    const cardsIn = mainDeckDelta(candidate.deck.mainDeck, candidate.submittedDeck.mainDeck, "in");
    const cardsOut = mainDeckDelta(candidate.deck.mainDeck, candidate.submittedDeck.mainDeck, "out");
    return deckCardsEqual(candidate.cardsIn, cardsIn) &&
      deckCardsEqual(candidate.cardsOut, cardsOut) &&
      cardTotal(cardsIn) === cardTotal(cardsOut) &&
      sideboardDeltasMatch(candidate.deck, candidate.submittedDeck, cardsIn, cardsOut);
  } catch {
    return false;
  }
}

function confirmedPerspectiveSideboardActions(
  replay: CanonicalReplayV2,
  game: CanonicalReplayV2["series"]["games"][number],
  playerId: string,
): ReplayActionEvent[] {
  return replay.events.filter((event): event is ReplayActionEvent => (
    event.kind === "action" &&
    event.index >= game.eventStartIndex &&
    event.index <= game.eventEndIndex &&
    (event.gameId === game.id || event.gameId === null) &&
    event.actorPlayerId === playerId &&
    normalizeKey(`${event.actionType} ${stringValue(event.action.type)}`).includes("submitsideboard") &&
    event.confirmation.status === "confirmed" &&
    event.confirmation.authority === "authoritative_patch_commit"
  ));
}

function exactSubmittedDeckFromPatch(
  action: ReplayActionEvent,
  playerId: string,
): {
  source: JsonObject | null;
  code: "missing_submitted_deck" | "invalid_submitted_deck" | "conflicting_submitted_decks";
  details?: Record<string, string | number | boolean>;
} {
  const sources = action.patch.operations.flatMap((operation) => {
    if (operation.op !== "set_player_fields" || operation.playerId !== playerId) return [];
    return [
      jsonObject(operation.fields.deck),
      jsonObject(operation.fields.submittedDeck),
      jsonObject(operation.fields.registeredDeck),
      hasDeckSections(operation.fields) ? operation.fields : null,
    ].filter((value): value is JsonObject => Boolean(value));
  });
  if (sources.length === 0) return { source: null, code: "missing_submitted_deck" };

  const complete = sources.flatMap((source) => {
    const deck = normalizeDeck(source);
    return deck ? [{ source, fingerprint: deck.fingerprint }] : [];
  });
  if (complete.length === 0) {
    const cardCode = sources.map(firstUnregisteredDeckCode).find(Boolean);
    return {
      source: null,
      code: "invalid_submitted_deck",
      details: cardCode
        ? { sourceCount: sources.length, unregisteredCardCode: cardCode }
        : { sourceCount: sources.length },
    };
  }

  const unique = [...new Map(complete.map((entry) => [entry.fingerprint, entry])).values()];
  if (unique.length !== 1) {
    return {
      source: null,
      code: "conflicting_submitted_decks",
      details: { uniqueDeckCount: unique.length },
    };
  }
  return { source: unique[0].source, code: "missing_submitted_deck" };
}

function initialPerspectiveDeckSnapshot(
  replay: CanonicalReplayV2,
  beforeIndex: number,
  playerId: string,
): JsonObject | null {
  for (const event of earlierSnapshots(replay, beforeIndex)) {
    const fields = event.snapshot.players[playerId]?.fields;
    if (!fields) continue;
    for (const key of ["registeredDeck", "deck", "submittedDeck"] as const) {
      const source = jsonObject(fields[key]);
      if (source && normalizeDeck(source)) return source;
    }
  }
  return null;
}

function legendForParticipant(
  participant: ReplayParticipant,
  replay: CanonicalReplayV2,
  playerId: string,
  beforeIndex: number,
): SideboardLabCard | null {
  for (const sourceKey of ["registeredDeck", "deck", "submittedDeck"] as const) {
    const source = jsonObject(participant.fields[sourceKey]);
    const sections = deckSections(source);
    const legend = sections ? deckEntries(sections.legend, "legend") : null;
    if (legend?.length === 1 && legend[0].count === 1) return withoutCount(legend[0]);
  }
  for (const event of earlierSnapshots(replay, beforeIndex)) {
    const legend = legendFromSnapshot(event.snapshot, playerId);
    if (legend) return legend;
  }
  return null;
}

function earlierSnapshots(replay: CanonicalReplayV2, beforeIndex: number): ReplaySnapshotEvent[] {
  return replay.events
    .filter((event): event is ReplaySnapshotEvent => (
      event.kind === "snapshot" && event.index < beforeIndex
    ))
    .sort((left, right) => right.index - left.index);
}

function legendFromSnapshot(snapshot: ReplaySnapshot, playerId: string): SideboardLabCard | null {
  const player = snapshot.players[playerId];
  if (!player) return null;
  const card = Object.entries(player.zones)
    .find(([zone]) => normalizeKey(zone).includes("legend"))?.[1]
    ?.find((candidate) => !candidate.isPlaceholder);
  return card ? canonicalCard(card.cardCode, "legend") : null;
}

function normalizeDeck(source: JsonObject): SideboardLabDeck | null {
  const sections = deckSections(source);
  if (!sections) return null;
  const main = deckEntries(valueByNormalizedKey(sections, ["maindeck", "main"]));
  const champions = deckEntries(valueByNormalizedKey(sections, ["champion", "champions"]));
  const sideboard = deckEntries(valueByNormalizedKey(sections, ["sideboard"]));
  if (!main || !champions || !sideboard) return null;
  const mainCount = cardTotal(main);
  const championCount = cardTotal(champions);
  const shuffled = mainCount === MAIN_DECK_SIZE && championCount === 0
    ? main
    : mainCount === MAIN_DECK_SIZE - 1 && championCount === 1
      ? [...main, ...champions]
      : null;
  if (!shuffled) return null;
  const normalizedMain = combineDeckEntries(shuffled);
  const normalizedSideboard = combineDeckEntries(sideboard);
  if (
    cardTotal(normalizedMain) !== MAIN_DECK_SIZE ||
    normalizedSideboard.length === 0 ||
    normalizedMain.some((card) => card.count > 3) ||
    normalizedSideboard.some((card) => card.count > 3) ||
    !withinBasePrintCopyLimit([...normalizedMain, ...normalizedSideboard])
  ) return null;
  const designatedChampionCode = championCount === 1 ? champions[0]!.cardCode : null;
  const chosenChampionCode = designatedChampionCode &&
    REGISTRY[designatedChampionCode]?.supertype?.toLowerCase() === "champion"
    ? designatedChampionCode
    : null;
  return {
    fingerprint: sideboardDeckFingerprint(normalizedMain, normalizedSideboard),
    ...(chosenChampionCode ? { chosenChampionCode } : {}),
    mainDeck: normalizedMain,
    sideboard: normalizedSideboard,
  };
}

function deckSections(source: JsonObject | null): JsonObject | null {
  if (!source) return null;
  return jsonObject(source.sections) ?? (hasDeckSections(source) ? source : null);
}

function hasDeckSections(value: JsonObject): boolean {
  return valueByNormalizedKey(value, ["maindeck", "main"]) !== undefined &&
    valueByNormalizedKey(value, ["sideboard"]) !== undefined;
}

function deckEntries(value: JsonValue | undefined, requiredType?: string): SideboardLabDeckCard[] | null {
  if (value === undefined) return requiredType ? null : [];
  if (!Array.isArray(value)) return null;
  const entries: SideboardLabDeckCard[] = [];
  for (const raw of value) {
    const object = jsonObject(raw);
    if (!object) return null;
    const cardCode = stringValue(object.cardCode ?? object.cardId ?? object.code).toUpperCase();
    const count = integerValue(object.count ?? object.qty ?? object.quantity);
    const observedName = stringValue(object.name ?? object.cardName);
    const card = canonicalCard(cardCode, requiredType, observedName);
    if (!card || count === null || count < 1 || count > 3) return null;
    if (!requiredType && FORBIDDEN_DECK_TYPES.has(REGISTRY[card.cardCode]!.type.toLowerCase())) return null;
    entries.push({ ...card, count });
  }
  return entries;
}

function canonicalCard(
  cardCode: string | undefined,
  requiredType?: string,
  observedName?: string,
): SideboardLabCard | null {
  const code = cardCode?.trim().toUpperCase() ?? "";
  const exact = REGISTRY[code];
  if (exact && (!requiredType || exact.type.toLowerCase() === requiredType)) {
    return { cardCode: code, name: exact.name };
  }

  if (!CARD_CODE.test(code)) return null;

  // Atlas can emit an unlisted face suffix for an otherwise packaged print
  // (for example VEN-069B while the registry contains VEN-069/VEN-069A).
  // Collapse only when the provider's full card name agrees with the packaged
  // base print; this preserves real packaged text/art without accepting an
  // arbitrary unknown code.
  const baseCode = /^([A-Z]{3}-\d{3})[A-Z*]$/.exec(code)?.[1];
  const base = baseCode ? REGISTRY[baseCode] : undefined;
  if (
    base &&
    observedName &&
    normalizedCardName(observedName) === normalizedCardName(base.name) &&
    (!requiredType || base.type.toLowerCase() === requiredType)
  ) {
    return { cardCode: baseCode!, name: base.name };
  }
  return null;
}

function firstUnregisteredDeckCode(source: JsonObject): string | null {
  const sections = deckSections(source);
  if (!sections) return null;
  const values = [
    valueByNormalizedKey(sections, ["maindeck", "main"]),
    valueByNormalizedKey(sections, ["champion", "champions"]),
    valueByNormalizedKey(sections, ["sideboard"]),
  ];
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const raw of value) {
      const object = jsonObject(raw);
      if (!object) continue;
      const cardCode = stringValue(object.cardCode ?? object.cardId ?? object.code).toUpperCase();
      const observedName = stringValue(object.name ?? object.cardName);
      if (cardCode && !canonicalCard(cardCode, undefined, observedName)) return cardCode;
    }
  }
  return null;
}

function sameCardPool(before: SideboardLabDeck, after: SideboardLabDeck): boolean {
  const allBefore = combineDeckEntries([...before.mainDeck, ...before.sideboard]);
  const allAfter = combineDeckEntries([...after.mainDeck, ...after.sideboard]);
  return JSON.stringify(allBefore) === JSON.stringify(allAfter);
}

function sideboardDeltasMatch(
  before: SideboardLabDeck,
  after: SideboardLabDeck,
  cardsIn: SideboardLabDeckCard[],
  cardsOut: SideboardLabDeckCard[],
): boolean {
  return JSON.stringify(mainDeckDelta(before.sideboard, after.sideboard, "out")) === JSON.stringify(cardsIn) &&
    JSON.stringify(mainDeckDelta(before.sideboard, after.sideboard, "in")) === JSON.stringify(cardsOut);
}

function mainDeckDelta(
  before: SideboardLabDeckCard[],
  after: SideboardLabDeckCard[],
  direction: "in" | "out",
): SideboardLabDeckCard[] {
  const previous = new Map(before.map((card) => [card.cardCode, card]));
  const submitted = new Map(after.map((card) => [card.cardCode, card]));
  const codes = [...new Set([...previous.keys(), ...submitted.keys()])].sort();
  return codes.flatMap((cardCode) => {
    const beforeCard = previous.get(cardCode);
    const afterCard = submitted.get(cardCode);
    const delta = (afterCard?.count ?? 0) - (beforeCard?.count ?? 0);
    const count = direction === "in" ? delta : -delta;
    return count > 0 ? [{ ...(afterCard ?? beforeCard)!, count }] : [];
  });
}

function combineDeckEntries(entries: SideboardLabDeckCard[]): SideboardLabDeckCard[] {
  const byCode = new Map<string, SideboardLabDeckCard>();
  for (const entry of entries) {
    const current = byCode.get(entry.cardCode);
    byCode.set(entry.cardCode, { ...entry, count: (current?.count ?? 0) + entry.count });
  }
  return [...byCode.values()].sort(compareDeckCards);
}

function isCanonicalDeck(deck: SideboardLabDeck): boolean {
  if (
    !deck ||
    !Array.isArray(deck.mainDeck) ||
    !Array.isArray(deck.sideboard) ||
    deck.mainDeck.length < 14 ||
    deck.mainDeck.length > 40 ||
    deck.sideboard.length === 0 ||
    deck.sideboard.length > 40 ||
    cardTotal(deck.mainDeck) !== MAIN_DECK_SIZE ||
    deck.fingerprint !== sideboardDeckFingerprint(deck.mainDeck, deck.sideboard)
  ) return false;
  if (deck.chosenChampionCode && validatedChosenChampionCode(deck) !== deck.chosenChampionCode) {
    return false;
  }
  const sections = [deck.mainDeck, deck.sideboard];
  if (sections.some((section) => (
    new Set(section.map(({ cardCode }) => cardCode)).size !== section.length ||
    section.some((card, index) => (
      !Number.isInteger(card.count) ||
      card.count < 1 ||
      card.count > 3 ||
      !sameCanonicalCard(card, canonicalCard(card.cardCode)) ||
      FORBIDDEN_DECK_TYPES.has(REGISTRY[card.cardCode]?.type.toLowerCase() ?? "") ||
      (index > 0 && section[index - 1].cardCode.localeCompare(card.cardCode) >= 0)
    ))
  ))) return false;
  return withinBasePrintCopyLimit([...deck.mainDeck, ...deck.sideboard]);
}

function validatedChosenChampionCode(deck: SideboardLabDeck): string | undefined {
  const code = typeof deck.chosenChampionCode === "string" ? deck.chosenChampionCode : "";
  if (!code || REGISTRY[code]?.supertype?.toLowerCase() !== "champion") return undefined;
  const registered = deck.mainDeck.find((card) => card.cardCode === code);
  return registered?.count === 1 ? code : undefined;
}

function withinBasePrintCopyLimit(cards: SideboardLabDeckCard[]): boolean {
  const totals = new Map<string, number>();
  for (const card of cards) {
    const basePrintId = REGISTRY[card.cardCode]?.basePrintId;
    if (!basePrintId) return false;
    const total = (totals.get(basePrintId) ?? 0) + card.count;
    if (total > 3) return false;
    totals.set(basePrintId, total);
  }
  return true;
}

function sameCanonicalCard(
  actual: SideboardLabCard,
  expected: SideboardLabCard | null,
): boolean {
  return Boolean(expected && actual.cardCode === expected.cardCode && actual.name === expected.name);
}

function deckCardsEqual(left: SideboardLabDeckCard[], right: SideboardLabDeckCard[]): boolean {
  return Array.isArray(left) && JSON.stringify(left) === JSON.stringify(right);
}

function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function valueByNormalizedKey(object: JsonObject, candidates: string[]): JsonValue | undefined {
  const accepted = new Set(candidates.map(normalizeKey));
  return Object.entries(object).find(([key]) => accepted.has(normalizeKey(key)))?.[1];
}

function perspectiveResult(
  result: CanonicalReplayV2["series"]["games"][number]["result"],
  playerId: string,
): boolean | null {
  if (!result?.winnerPlayerId || !result.loserPlayerId || result.winnerPlayerId === result.loserPlayerId) return null;
  if (result.winnerPlayerId === playerId) return true;
  if (result.loserPlayerId === playerId) return false;
  return null;
}

function epochMilliseconds(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value < 10_000_000_000 ? value * 1_000 : value;
}

function compareDeckCards(left: SideboardLabDeckCard, right: SideboardLabDeckCard): number {
  return left.cardCode.localeCompare(right.cardCode);
}

function cardTotal(cards: SideboardLabDeckCard[]): number {
  return cards.reduce((sum, card) => sum + card.count, 0);
}

function withoutCount(card: SideboardLabDeckCard): SideboardLabCard {
  return { cardCode: card.cardCode, name: card.name };
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizedCardName(value: string): string {
  return value.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function jsonObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
