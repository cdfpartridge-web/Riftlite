import { createHash } from "node:crypto";

import type {
  CanonicalReplayV2,
  JsonObject,
  JsonValue,
  ReplayCardState,
  ReplayGame,
} from "@/lib/replay-v2";
import { seekReplayByEventIndex } from "@/lib/replay-v2";
import {
  DEFAULT_MULLIGAN_LAB_MINIMUM_HANDS,
  DEFAULT_MULLIGAN_LAB_MINIMUM_PLAYERS,
  MulliganLabPackReadyResponseSchema,
  MulliganLabReadyResponseSchema,
  type MulliganLabCard,
  type MulliganLabCardEvidence,
  type MulliganLabDeck,
  type MulliganLabDrill,
  type MulliganLabEvidenceSlice,
  type MulliganLabObservation,
  type MulliganLabPackReadyResponse,
  type MulliganLabReadyResponse,
} from "@/lib/mulligan-lab/contracts";
import {
  MULLIGAN_CARD_REGISTRY_METADATA,
  mulliganCardIdentity,
  mulliganCardMetadata,
} from "@/lib/mulligan-lab/registry";

const CARD_CODE = /^[A-Z]{3}-\d{3}(?:[A-Z]|\*)?$/;
const MAIN_DECK_SIZE = 40;
const CARD_GUIDANCE_MINIMUM_OFFERS = 25;
const CARD_GUIDANCE_MINIMUM_PLAYERS = 10;
const CURRENT_SEASON_STARTED_ON = "2026-07-31" as const;
const MAX_PACK_JSON_BYTES = 700_000;

export type ObservedMulliganCandidate = {
  observedHandId: string;
  contributorKey: string;
  observation: MulliganLabObservation;
  matchup: MulliganLabDrill["matchup"];
  initiative: MulliganLabDrill["initiative"];
  hand: MulliganLabCard[];
  redrawnCardIndexes: number[];
  wonGame: boolean;
  deck: MulliganLabDeck;
};

export type MulliganLabAggregateOptions = {
  minimumHands?: number;
  minimumPlayers?: number;
  maxDrills?: number;
  generatedAt?: Date;
  lifetimeHours?: number;
  coverageTruncated?: boolean;
  backfillComplete?: boolean;
  targetPlayerLegendIdentityCode?: string;
  targetOpponentLegendIdentityCode?: string;
  targetDeckFingerprint?: string;
  targetInitiative?: "first" | "second";
};

export type MulliganLabPackTarget = {
  playerLegendIdentityCode: string;
  opponentLegendIdentityCode?: string;
  deckFingerprint?: string;
  initiative?: "first" | "second";
};

/**
 * Extracts one perspective-only, Game 1 mulligan from a canonical Web Replay.
 * It deliberately fails closed unless the exact four card instances, exact
 * submitted redraw ids, initiative, result, both legends, and a legal 40-card
 * deck from the same canonical replay participant can all be proven.
 */
export function extractObservedMulligan(
  replay: CanonicalReplayV2,
  contributorKey: string,
): ObservedMulliganCandidate | null {
  if (
    replay.schema !== "riftlite-canonical-replay" ||
    replay.version !== 2 ||
    !contributorKey ||
    !replay.series.perspectivePlayerId
  ) return null;

  const perspectivePlayerId = replay.series.perspectivePlayerId;
  const game = firstGame(replay);
  if (!game?.result?.winnerPlayerId || game.result.winnerPlayerId === game.result.loserPlayerId) return null;
  const wonGame = game.result.winnerPlayerId === perspectivePlayerId;
  if (!wonGame && game.result.loserPlayerId !== perspectivePlayerId) return null;

  const action = replay.events.find((event) => (
    event.kind === "action" &&
    event.gameId === game.id &&
    event.actionType === "submit_mulligan" &&
    event.actorPlayerId === perspectivePlayerId &&
    event.confirmation.status === "confirmed" &&
    event.confirmation.authority === "authoritative_patch_commit"
  ));
  if (!action || action.kind !== "action") return null;

  if (replay.events[action.index] !== action) return null;
  const preState = seekReplayByEventIndex(replay, action.index - 1).state;
  if (preState.gameId !== game.id || preState.room.gameNumber !== 1) return null;

  const redrawnIds = action.patch.operations.flatMap((operation) => (
    operation.op === "zone_remove" &&
    operation.playerId === perspectivePlayerId &&
    normalizeKey(operation.zone) === "hand"
      ? operation.cardIds
      : []
  ));
  if (new Set(redrawnIds).size !== redrawnIds.length) return null;
  const playbackRedrawCount = mulliganPlaybackRedrawCount(action.patch.operations, perspectivePlayerId);
  if (playbackRedrawCount === undefined || playbackRedrawCount !== redrawnIds.length) return null;

  const player = preState.players[perspectivePlayerId];
  const opponentId = replay.series.participants.find((participant) => participant.id !== perspectivePlayerId)?.id;
  const opponent = opponentId ? preState.players[opponentId] : undefined;
  if (!player || !opponent || !opponentId) return null;

  const handStates = player.zones.hand;
  if (handStates.length !== 4 || new Set(handStates.map((card) => card.id)).size !== 4) return null;
  const hand = handStates.map(exactCard);
  if (hand.some((card) => !card)) return null;
  const exactHand = hand as MulliganLabCard[];

  const redrawnCardIndexes = redrawnIds.map((id) => handStates.findIndex((card) => card.id === id));
  if (redrawnCardIndexes.some((index) => index < 0)) return null;
  redrawnCardIndexes.sort((left, right) => left - right);

  const playerLegend = legendCard(player.zones);
  const opponentLegend = legendCard(opponent.zones);
  if (!playerLegend || !opponentLegend) return null;

  const firstPlayerId = preState.room.firstPlayerId;
  if (firstPlayerId !== perspectivePlayerId && firstPlayerId !== opponentId) return null;
  const initiative = firstPlayerId === perspectivePlayerId ? "first" as const : "second" as const;

  const perspectiveParticipant = replay.series.participants.find((participant) => participant.id === perspectivePlayerId);
  const deck = perspectiveParticipant
    ? sameReplayParticipantDeck(perspectiveParticipant.fields, playerLegend, exactHand)
    : null;
  if (!deck) return null;

  const observedAt = epochMilliseconds(action.at);
  if (observedAt === undefined) return null;
  const provider = replay.source.schema === "riftlite-tcga-raw-capture" ? "tcga" as const : "atlas" as const;

  return {
    observedHandId: `mh1_${digest([
      replay.id,
      game.id,
      action.sourceMessageId,
      exactHand.map((card) => card.cardCode),
      redrawnCardIndexes,
      deck.fingerprint,
    ]).slice(0, 32)}`,
    contributorKey,
    observation: {
      provider,
      matchKey: `mm1_${digest([replay.id, game.id, deck.fingerprint]).slice(0, 32)}`,
      gameNumber: 1,
      eventKey: `me1_${digest([replay.id, action.id, action.sourceMessageId]).slice(0, 32)}`,
      observedOn: new Date(observedAt).toISOString().slice(0, 10),
    },
    matchup: { playerLegend, opponentLegend },
    initiative,
    hand: exactHand,
    redrawnCardIndexes,
    wonGame,
    deck,
  };
}

/** Produces a privacy-gated, deterministic snapshot with no replay/user ids. */
export function buildMulliganLabSnapshot(
  candidates: ObservedMulliganCandidate[],
  options: MulliganLabAggregateOptions = {},
): MulliganLabReadyResponse | null {
  const minimumHands = positiveInteger(options.minimumHands) ?? DEFAULT_MULLIGAN_LAB_MINIMUM_HANDS;
  const minimumPlayers = positiveInteger(options.minimumPlayers) ?? DEFAULT_MULLIGAN_LAB_MINIMUM_PLAYERS;
  const maxDrills = Math.min(64, positiveInteger(options.maxDrills) ?? 64);
  const generatedAt = options.generatedAt ?? new Date();
  const lifetimeHours = positiveInteger(options.lifetimeHours) ?? 36;
  const coverageTruncated = options.coverageTruncated === true;
  const backfillComplete = options.backfillComplete === true;

  const balancedCandidates = dedupeCandidates(candidates);
  const groups = new Map<string, ObservedMulliganCandidate[]>();
  const playerLegendGroups = new Map<string, ObservedMulliganCandidate[]>();
  for (const candidate of balancedCandidates) {
    const key = matchupKey(candidate);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
    const legendKey = playerLegendKey(candidate);
    playerLegendGroups.set(legendKey, [...(playerLegendGroups.get(legendKey) ?? []), candidate]);
  }

  const preparedGroups = [...groups.entries()]
    .filter(([, group]) => {
      const sample = group[0];
      if (!sample) return false;
      return (
        (!options.targetPlayerLegendIdentityCode || playerLegendKey(sample) === options.targetPlayerLegendIdentityCode) &&
        (!options.targetOpponentLegendIdentityCode || opponentLegendKey(sample) === options.targetOpponentLegendIdentityCode)
      );
    })
    .map(([groupKey, unsortedGroup]) => {
      const group = unsortedGroup.sort((left, right) => left.observedHandId.localeCompare(right.observedHandId));
      const contributors = new Set(group.map((candidate) => candidate.contributorKey));
      const playerLegendGroup = playerLegendGroups.get(playerLegendKey(group[0]!)) ?? group;
      const matchupEvidence = buildRawEvidence(group);
      const playerLegendEvidence = buildRawEvidence(playerLegendGroup);
      const evidence = publishEvidence(
        matchupEvidence,
        playerLegendEvidence,
        minimumHands,
        minimumPlayers,
      );
      return {
        groupKey,
        group,
        contributors,
        evidence,
        drillCandidates: group.filter((candidate) => (
          candidate.hand.every((card) => evidence.has(cardIdentity(card.cardCode))) &&
          (!options.targetDeckFingerprint || candidate.deck.fingerprint === options.targetDeckFingerprint) &&
          (!options.targetInitiative || candidate.initiative === options.targetInitiative)
        )),
        evidenceTier: group.length >= 8 && contributors.size >= 4
          ? 2
          : group.length >= 3 && contributors.size >= 2
            ? 1
            : 0,
      };
    })
    // Evidence-rich matchups appear first. Daily rotation still changes which
    // sparse cohorts fill the remaining bounded slots.
    .sort((left, right) => (
      right.evidenceTier - left.evidenceTier ||
      right.group.length - left.group.length ||
      left.groupKey.localeCompare(right.groupKey)
    ));

  // A bounded public document cannot carry every exact hand and its bound
  // 40-card deck. Rotate the cohort window by UTC day instead of permanently
  // publishing only the largest cohorts. The step is the pack size, so
  // successive daily refreshes walk the whole circular cohort list. Candidate
  // hands rotate independently within each included cohort.
  const rotationDay = utcDayNumber(generatedAt);
  const rotatedGroups = rotateWithinEvidenceTiers(preparedGroups, rotationDay);

  const drills: MulliganLabDrill[] = [];
  for (let candidateIndex = 0; drills.length < maxDrills; candidateIndex += 1) {
    let added = false;
    for (const prepared of rotatedGroups) {
      if (candidateIndex >= prepared.drillCandidates.length) continue;
      const candidateOffset = dailyCandidateOffset(
        rotationDay,
        prepared.groupKey,
        prepared.drillCandidates.length,
      );
      const candidate = prepared.drillCandidates[
        (candidateOffset + candidateIndex) % prepared.drillCandidates.length
      ];
      if (!candidate) continue;
      const handCards = new Map(candidate.hand.map((card) => [card.cardCode, card]));
      added = true;
      drills.push({
        id: `ml2_${digest([prepared.groupKey, candidate.observedHandId, candidate.deck.fingerprint]).slice(0, 32)}`,
        matchup: candidate.matchup,
        initiative: candidate.initiative,
        hand: candidate.hand,
        deck: candidate.deck,
        evidence: {
          status: prepared.group.length >= minimumHands && prepared.contributors.size >= minimumPlayers
            ? "sufficient"
            : "early",
          scope: "matchup",
          deckScope: "all-observed-decks",
          guidanceBasis: "community-keep-rate",
          outcomeInterpretation: "descriptive-not-causal",
          playerLegendIdentityCode: playerLegendKey(candidate),
          opponentLegendIdentityCode: opponentLegendKey(candidate),
          hands: prepared.group.length,
          players: prepared.contributors.size,
        },
        cardEvidence: [...handCards].sort(([left], [right]) => left.localeCompare(right))
          .map(([code, card]) => ({
            ...prepared.evidence.get(cardIdentity(code))!,
            // The statistics pool cosmetic prints by base identity, while the
            // exact code/name continues to bind feedback to the shown art.
            cardCode: code,
            name: card.name,
          })),
      });
      if (drills.length >= maxDrills) break;
    }
    if (!added) break;
  }
  if (!drills.length) return null;

  const preseasonFacts = balancedCandidates.filter((candidate) => (
    candidate.observation.observedOn < CURRENT_SEASON_STARTED_ON
  )).length;
  const currentSeasonFacts = balancedCandidates.length - preseasonFacts;

  const response: MulliganLabReadyResponse = {
    schema: "riftlite-mulligan-lab",
    version: 2,
    status: "ready",
    generatedAt: generatedAt.toISOString(),
    expiresAt: new Date(generatedAt.getTime() + lifetimeHours * 60 * 60 * 1_000).toISOString(),
    source: {
      kind: "precomputed-observed-replays",
      corpus: "anonymized-canonical-web-replays",
      minimumHands,
      minimumPlayers,
      observedFrom: observedDateBoundary(balancedCandidates, "first"),
      observedThrough: observedDateBoundary(balancedCandidates, "last"),
      includedFacts: balancedCandidates.length,
      coverageTruncated,
      coveragePolicy: "all-available-history",
      includedPeriods: [
        ...(preseasonFacts > 0 ? ["preseason" as const] : []),
        ...(currentSeasonFacts > 0 ? ["current-season" as const] : []),
      ],
      backfillComplete,
      seasonCoverage: {
        currentSeasonStartedOn: CURRENT_SEASON_STARTED_ON,
        preseasonFacts,
        currentSeasonFacts,
      },
    },
    drills: drills.sort((left, right) => drillEvidencePriority(right) - drillEvidencePriority(left)),
  };
  return MulliganLabReadyResponseSchema.parse(response);
}

/**
 * Builds a queryable pack for one oriented matchup (or its player-Legend
 * fallback). The sampled hands/decks may be narrowed, but every percentage is
 * still calculated from the full anonymous matchup/Legend corpus.
 */
export function buildMulliganLabPack(
  candidates: ObservedMulliganCandidate[],
  target: MulliganLabPackTarget,
  options: MulliganLabAggregateOptions = {},
): MulliganLabPackReadyResponse | null {
  const minimumHands = positiveInteger(options.minimumHands) ?? DEFAULT_MULLIGAN_LAB_MINIMUM_HANDS;
  const minimumPlayers = positiveInteger(options.minimumPlayers) ?? DEFAULT_MULLIGAN_LAB_MINIMUM_PLAYERS;
  const balanced = dedupeCandidates(candidates);
  const exactDeckCohort = target.deckFingerprint
    ? balanced.filter((candidate) => (
      playerLegendKey(candidate) === target.playerLegendIdentityCode &&
      (!target.opponentLegendIdentityCode || opponentLegendKey(candidate) === target.opponentLegendIdentityCode) &&
      candidate.deck.fingerprint === target.deckFingerprint &&
      (!target.initiative || candidate.initiative === target.initiative)
    ))
    : [];
  const exactDeckKnown = exactDeckCohort.length > 0;
  const exactDeckPublishable = exactDeckCohort.length >= 8 &&
    new Set(exactDeckCohort.map((candidate) => candidate.contributorKey)).size >= 4;
  const snapshot = buildMulliganLabSnapshot(balanced, {
    ...options,
    maxDrills: Math.min(24, positiveInteger(options.maxDrills) ?? 24),
    targetPlayerLegendIdentityCode: target.playerLegendIdentityCode,
    targetOpponentLegendIdentityCode: target.opponentLegendIdentityCode,
    targetDeckFingerprint: exactDeckPublishable ? target.deckFingerprint : undefined,
    targetInitiative: target.initiative,
  });
  if (!snapshot) return null;

  const enhancedDrills = snapshot.drills.map((drill) => {
    const matchup = balanced.filter((candidate) => (
      playerLegendKey(candidate) === playerLegendKeyFromDrill(drill) &&
      opponentLegendKey(candidate) === opponentLegendKeyFromDrill(drill)
    ));
    const curve = mulliganCurveContext(drill.hand);
    const matchingCurve = matchup.filter((candidate) => (
      mulliganCurveContext(candidate.hand).classification === curve.classification
    ));
    const matchingInitiative = matchup.filter((candidate) => candidate.initiative === drill.initiative);
    const preseason = matchup.filter((candidate) => candidate.observation.observedOn < CURRENT_SEASON_STARTED_ON);
    const currentSeason = matchup.filter((candidate) => candidate.observation.observedOn >= CURRENT_SEASON_STARTED_ON);
    return {
      ...drill,
      context: {
        curve,
        // Battlefield selections are not consistently present before the
        // authoritative mulligan event. Do not infer them from later board
        // state; a future fact revision can fill these independently.
        battlefields: { player: null, opponent: null },
      },
      cardEvidence: drill.cardEvidence.map((entry) => ({
        ...entry,
        slices: {
          matchingCurve: evidenceSlice(matchingCurve, entry.identityCode, minimumHands, minimumPlayers),
          matchingInitiative: evidenceSlice(matchingInitiative, entry.identityCode, minimumHands, minimumPlayers),
          preseason: evidenceSlice(preseason, entry.identityCode, minimumHands, minimumPlayers),
          currentSeason: evidenceSlice(currentSeason, entry.identityCode, minimumHands, minimumPlayers),
        },
      })),
    };
  });
  const exactDeckResolved = Boolean(exactDeckPublishable && target.deckFingerprint &&
    enhancedDrills.some((drill) => drill.deck.fingerprint === target.deckFingerprint));
  const response: MulliganLabPackReadyResponse = {
    schema: "riftlite-mulligan-lab-pack",
    version: 1,
    status: "ready",
    generatedAt: snapshot.generatedAt,
    expiresAt: snapshot.expiresAt,
    query: {
      requested: {
        playerLegend: target.playerLegendIdentityCode,
        opponentLegend: target.opponentLegendIdentityCode ?? null,
        deckFingerprint: target.deckFingerprint ?? null,
        initiative: target.initiative ?? null,
      },
      resolved: {
        scope: exactDeckResolved
          ? "exact-deck"
          : target.opponentLegendIdentityCode ? "matchup" : "player-legend",
        deckFingerprint: exactDeckResolved ? target.deckFingerprint! : null,
        sharedCards: exactDeckResolved ? 40 : null,
        totalCards: exactDeckResolved ? 40 : null,
      },
      fallbackReason: target.deckFingerprint && !exactDeckResolved
        ? exactDeckKnown ? "insufficient-private-cohort" : "deck-not-observed"
        : null,
    },
    source: {
      ...snapshot.source,
      cardRegistryGeneratedAt: MULLIGAN_CARD_REGISTRY_METADATA.generatedAt,
      cardRegistryPrints: MULLIGAN_CARD_REGISTRY_METADATA.prints,
    },
    drills: enhancedDrills,
  };
  while (response.drills.length > 1 && Buffer.byteLength(JSON.stringify(response), "utf8") > MAX_PACK_JSON_BYTES) {
    response.drills.pop();
  }
  return MulliganLabPackReadyResponseSchema.parse(response);
}

function firstGame(replay: CanonicalReplayV2): ReplayGame | undefined {
  return replay.series.games.find((game) => game.gameNumber === 1 && game.ordinal === 1)
    ?? replay.series.games.find((game) => game.gameNumber === 1);
}

function legendCard(zones: Record<string, ReplayCardState[]>): MulliganLabCard | null {
  const legend = Object.entries(zones)
    .find(([zone]) => normalizeKey(zone).includes("legend"))?.[1]
    ?.map(exactCard)
    .find((card): card is MulliganLabCard => Boolean(card));
  return legend ?? null;
}

function sameReplayParticipantDeck(
  participantFields: JsonObject,
  playerLegend: MulliganLabCard,
  hand: MulliganLabCard[],
): MulliganLabDeck | null {
  // deck is the actual deck captured on this participant in this replay.
  // submittedDeck and registeredDeck are older same-capture aliases.
  const source = jsonObject(participantFields.deck)
    ?? jsonObject(participantFields.submittedDeck)
    ?? jsonObject(participantFields.registeredDeck);
  const sections = jsonObject(source?.sections) ?? source;
  if (!sections) return null;

  const legendEntries = deckSectionEntries(sections.legend);
  if (
    legendEntries.length !== 1 ||
    legendEntries[0].count !== 1 ||
    legendEntries[0].card.cardCode !== playerLegend.cardCode
  ) return null;

  const mainEntries = deckSectionEntries(sections.mainDeck ?? sections.main_deck);
  const championEntries = deckSectionEntries(sections.champion ?? sections.champions);
  const mainCount = mainEntries.reduce((sum, entry) => sum + entry.count, 0);
  const championCount = championEntries.reduce((sum, entry) => sum + entry.count, 0);
  const includedEntries = mainCount === MAIN_DECK_SIZE
    ? mainEntries
    // Atlas exposes the signature champion separately even though it occupies
    // one of the forty shuffled-deck slots. Never accept a bare 39-card list.
    : mainCount === MAIN_DECK_SIZE - 1 && championCount === 1
      ? [...mainEntries, ...championEntries]
      : [];
  if (!includedEntries.length) return null;

  const cards = includedEntries.flatMap((entry) => (
    Array.from({ length: entry.count }, () => entry.card)
  ));
  for (const candidateCards of [cards]) {
    const deck = normalizeDeck(candidateCards);
    if (!deck || !handFitsDeck(hand, deck)) continue;
    return deck;
  }
  return null;
}

function deckSectionEntries(value: JsonValue | undefined): Array<{ card: MulliganLabCard; count: number }> {
  if (!Array.isArray(value)) return [];
  const entries: Array<{ card: MulliganLabCard; count: number }> = [];
  for (const raw of value) {
    const entry = jsonObject(raw);
    if (!entry) return [];
    const cardCode = stringValue(entry.cardCode ?? entry.cardId ?? entry.code);
    const name = stringValue(entry.name).replace(/\s+/g, " ");
    const count = integerValue(entry.count ?? entry.qty ?? entry.quantity);
    if (!CARD_CODE.test(cardCode) || !name || name.length > 120 || !count || count > 3) return [];
    entries.push({ card: { cardCode, name }, count });
  }
  return entries;
}

function mulliganPlaybackRedrawCount(
  operations: Extract<CanonicalReplayV2["events"][number], { kind: "action" }>["patch"]["operations"],
  playerId: string,
): number | undefined {
  for (const operation of operations) {
    if (operation.op !== "set_room_fields") continue;
    const playbackByPlayer = jsonObject(operation.fields.mulliganPlaybackByPlayerId);
    const playback = jsonObject(playbackByPlayer?.[playerId]);
    const count = integerValue(playback?.redrawCount);
    if (count !== undefined && count >= 0 && count <= 2) return count;
  }
  return undefined;
}

function normalizeDeck(cards: MulliganLabCard[]): MulliganLabDeck | null {
  if (cards.length !== MAIN_DECK_SIZE) return null;
  const byCode = new Map<string, { name: string; count: number }>();
  for (const card of cards) {
    const current = byCode.get(card.cardCode);
    // Atlas display labels can vary for the same exact print code; the final
    // candidate is normalized through the packaged registry before storage.
    byCode.set(card.cardCode, { name: card.name, count: (current?.count ?? 0) + 1 });
  }
  if ([...byCode.values()].some((entry) => entry.count > 3)) return null;
  const mainDeck = [...byCode.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([cardCode, entry]) => ({ cardCode, name: entry.name, count: entry.count }));
  if (mainDeck.length < 14) return null;
  return {
    fingerprint: mulliganDeckFingerprint(mainDeck),
    mainDeck,
  };
}

function handFitsDeck(hand: MulliganLabCard[], deck: MulliganLabDeck): boolean {
  const available = new Map(deck.mainDeck.map((card) => [card.cardCode, card.count]));
  const required = new Map<string, number>();
  for (const card of hand) required.set(card.cardCode, (required.get(card.cardCode) ?? 0) + 1);
  return [...required].every(([code, count]) => count <= (available.get(code) ?? 0));
}

function exactCard(card: ReplayCardState): MulliganLabCard | null {
  const cardCode = card.cardCode?.trim() ?? "";
  const name = card.name?.trim().replace(/\s+/g, " ") ?? "";
  if (card.isPlaceholder || !CARD_CODE.test(cardCode) || !name || name.length > 120) return null;
  return { cardCode, name };
}

type RawCardEvidence = MulliganLabCard & {
  offered: number;
  kept: number;
  redrawn: number;
  keptWins: number;
  redrawnWins: number;
  contributors: Set<string>;
  keptContributors: Set<string>;
  redrawnContributors: Set<string>;
  guidanceTallies: Map<string, { kept: number; redrawn: number }>;
  guidanceDecisions: Map<string, boolean>;
};

type RawEvidenceScope = {
  hands: number;
  contributors: Set<string>;
  baselineKeepRate: number;
  cards: Map<string, RawCardEvidence>;
};

/**
 * Counts every unambiguous card opportunity once per hand, matching the user's
 * "in 100 games" interpretation. Duplicate copies that were all kept or all
 * redrawn still count once; a split duplicate decision is omitted because it
 * belongs to neither binary branch. Raw descriptive counts include every
 * deduped eligible hand. Guidance remains contributor-balanced: all of one
 * player's observations produce one majority vote, while an exact tie abstains.
 */
function buildRawEvidence(group: ObservedMulliganCandidate[]): RawEvidenceScope {
  const cards = new Map<string, RawCardEvidence>();
  for (const candidate of [...group].sort((left, right) => left.observedHandId.localeCompare(right.observedHandId))) {
    const redrawnIndexes = new Set(candidate.redrawnCardIndexes);
    const cardsInHand = new Map<string, {
      card: MulliganLabCard;
      copies: number;
      redrawnCopies: number;
    }>();
    candidate.hand.forEach((card, index) => {
      const identityCode = cardIdentity(card.cardCode);
      const current = cardsInHand.get(identityCode);
      cardsInHand.set(identityCode, {
        card,
        copies: (current?.copies ?? 0) + 1,
        redrawnCopies: (current?.redrawnCopies ?? 0) + (redrawnIndexes.has(index) ? 1 : 0),
      });
    });

    for (const [identityCode, { card, copies, redrawnCopies }] of cardsInHand) {
      // A partial duplicate decision is neither a keep nor a redraw signal for
      // that identity. Exclude it rather than forcing both copies into one
      // branch and overstating the player's intent.
      if (redrawnCopies > 0 && redrawnCopies < copies) continue;
      const entry = cards.get(identityCode) ?? {
        ...card,
        offered: 0,
        kept: 0,
        redrawn: 0,
        keptWins: 0,
        redrawnWins: 0,
        contributors: new Set<string>(),
        keptContributors: new Set<string>(),
        redrawnContributors: new Set<string>(),
        guidanceTallies: new Map<string, { kept: number; redrawn: number }>(),
        guidanceDecisions: new Map<string, boolean>(),
      };
      entry.offered += 1;
      entry.contributors.add(candidate.contributorKey);
      const tally = entry.guidanceTallies.get(candidate.contributorKey) ?? { kept: 0, redrawn: 0 };
      if (redrawnCopies === copies) {
        entry.redrawn += 1;
        entry.redrawnContributors.add(candidate.contributorKey);
        tally.redrawn += 1;
        if (candidate.wonGame) entry.redrawnWins += 1;
      } else {
        entry.kept += 1;
        entry.keptContributors.add(candidate.contributorKey);
        tally.kept += 1;
        if (candidate.wonGame) entry.keptWins += 1;
      }
      entry.guidanceTallies.set(candidate.contributorKey, tally);
      cards.set(identityCode, entry);
    }
  }

  for (const entry of cards.values()) {
    for (const [contributor, tally] of entry.guidanceTallies) {
      // Ties abstain: inventing a keep/redraw preference would bias the
      // contributor-balanced recommendation in an arbitrary direction.
      if (tally.kept === tally.redrawn) continue;
      entry.guidanceDecisions.set(contributor, tally.kept > tally.redrawn);
    }
  }
  // The baseline uses the same one-majority-vote-per-contributor/card
  // population as guidance, while raw rates above remain fully descriptive.
  const offeredOpportunities = [...cards.values()]
    .reduce((sum, entry) => sum + entry.guidanceDecisions.size, 0);
  const keptOpportunities = [...cards.values()]
    .reduce((sum, entry) => (
      sum + [...entry.guidanceDecisions.values()].filter(Boolean).length
    ), 0);
  return {
    hands: group.length,
    contributors: new Set(group.map((candidate) => candidate.contributorKey)),
    baselineKeepRate: offeredOpportunities > 0 ? keptOpportunities / offeredOpportunities : 0,
    cards,
  };
}

function publishEvidence(
  matchup: RawEvidenceScope,
  playerLegend: RawEvidenceScope,
  minimumHands: number,
  minimumPlayers: number,
): Map<string, MulliganLabCardEvidence> {
  return new Map([...matchup.cards.keys()].flatMap((code) => {
    const matchupCard = matchup.cards.get(code)!;
    const reliableOffers = Math.max(CARD_GUIDANCE_MINIMUM_OFFERS, minimumHands);
    const reliablePlayers = Math.max(
      CARD_GUIDANCE_MINIMUM_PLAYERS,
      minimumPlayers,
    );
    const matchupReliable = (
      matchupCard.offered >= reliableOffers &&
      matchupCard.guidanceDecisions.size >= reliablePlayers
    );
    const matchupDeveloping = (
      matchupCard.offered >= 8 &&
      matchupCard.guidanceDecisions.size >= 4
    );
    const playerLegendCard = playerLegend.cards.get(code) ?? matchupCard;
    const playerLegendReliable = (
      playerLegendCard.offered >= reliableOffers &&
      playerLegendCard.guidanceDecisions.size >= reliablePlayers
    );
    const playerLegendDeveloping = (
      playerLegendCard.offered >= 8 &&
      playerLegendCard.guidanceDecisions.size >= 4
    );
    const playerLegendIsMateriallyBroader = (
      playerLegendCard.offered >= matchupCard.offered * 2 &&
      playerLegendCard.guidanceDecisions.size >= matchupCard.guidanceDecisions.size * 2
    );
    // Preserve the more relevant exact matchup whenever it is robust. A
    // broader player-legend scope may replace it only when that scope is
    // itself robust, upgrades limited evidence to developing, or is at least
    // twice as broad on both observations and independent contributors.
    const usePlayerLegend = (
      !matchupReliable &&
      (
        playerLegendReliable ||
        (!matchupDeveloping && playerLegendDeveloping) ||
        (
          matchupDeveloping &&
          playerLegendDeveloping &&
          playerLegendIsMateriallyBroader
        )
      )
    );
    const scopeName = usePlayerLegend ? "player-legend" as const : "matchup" as const;
    const scope = usePlayerLegend ? playerLegend : matchup;
    // Every matchup card is necessarily present in its player-legend parent.
    const entry = scope.cards.get(code) ?? matchupCard;
    // A scope made entirely of tied per-player majorities has no honest
    // contributor-balanced rate. Omit it; candidate selection will avoid
    // publishing a drill whose displayed hand lacks evidence.
    if (entry.guidanceDecisions.size === 0) return [];
    const players = entry.contributors.size;
    const keptPlayers = entry.keptContributors.size;
    const redrawnPlayers = entry.redrawnContributors.size;
    const keepRate = entry.kept / entry.offered;
    const guidancePlayers = entry.guidanceDecisions.size;
    const guidanceKept = [...entry.guidanceDecisions.values()].filter(Boolean).length;
    const guidanceKeepRate = guidanceKept / guidancePlayers;
    const keptWinRate = entry.kept > 0 ? entry.keptWins / entry.kept : null;
    const redrawnWinRate = entry.redrawn > 0 ? entry.redrawnWins / entry.redrawn : null;
    const winRateDelta = keptWinRate !== null && redrawnWinRate !== null
      ? keptWinRate - redrawnWinRate
      : null;
    const evidenceStatus = cardEvidenceStatus(
      entry.offered,
      guidancePlayers,
      reliableOffers,
      reliablePlayers,
    );
    const evidence: MulliganLabCardEvidence = {
      cardCode: entry.cardCode,
      identityCode: code,
      name: entry.name,
      scope: scopeName,
      scopeHands: scope.hands,
      scopePlayers: scope.contributors.size,
      offered: entry.offered,
      players,
      kept: entry.kept,
      keptPlayers,
      redrawn: entry.redrawn,
      redrawnPlayers,
      keptWins: entry.keptWins,
      redrawnWins: entry.redrawnWins,
      keepRate,
      baselineKeepRate: scope.baselineKeepRate,
      guidancePlayers,
      guidanceKept,
      guidanceKeepRate,
      keptWinRate,
      redrawnWinRate,
      winRateDelta,
      guidance: communityGuidance(
        guidanceKept,
        guidancePlayers,
        scope.baselineKeepRate,
        evidenceStatus,
      ),
      evidenceStatus,
      outcomeStatus: outcomeEvidenceStatus(
        entry.kept,
        entry.redrawn,
        keptPlayers,
        redrawnPlayers,
        evidenceStatus,
      ),
    };
    return [[code, evidence] as const];
  }));
}

function evidenceSlice(
  group: ObservedMulliganCandidate[],
  identityCode: string,
  minimumHands: number,
  minimumPlayers: number,
): MulliganLabEvidenceSlice | null {
  if (!group.length) return null;
  const scope = buildRawEvidence(group);
  const entry = scope.cards.get(identityCode);
  if (!entry || entry.guidanceDecisions.size < 4 || entry.offered < 8) return null;
  const guidancePlayers = entry.guidanceDecisions.size;
  const guidanceKept = [...entry.guidanceDecisions.values()].filter(Boolean).length;
  const evidenceStatus = cardEvidenceStatus(
    entry.offered,
    guidancePlayers,
    Math.max(CARD_GUIDANCE_MINIMUM_OFFERS, minimumHands),
    Math.max(CARD_GUIDANCE_MINIMUM_PLAYERS, minimumPlayers),
  );
  return {
    offered: entry.offered,
    players: entry.contributors.size,
    kept: entry.kept,
    redrawn: entry.redrawn,
    guidancePlayers,
    guidanceKept,
    guidanceKeepRate: guidanceKept / guidancePlayers,
    guidance: communityGuidance(
      guidanceKept,
      guidancePlayers,
      scope.baselineKeepRate,
      evidenceStatus,
    ),
    evidenceStatus,
  };
}

function mulliganCurveContext(
  hand: MulliganLabCard[],
): NonNullable<MulliganLabDrill["context"]>["curve"] {
  let twoDropCount = 0;
  let earlyUnitCount = 0;
  for (const card of hand) {
    const metadata = mulliganCardMetadata(card.cardCode);
    if (!metadata) {
      return { classification: "unknown", twoDropCount: null, earlyUnitCount: null };
    }
    if (metadata.type.toLowerCase() !== "unit") continue;
    if (metadata.costEnergy === null) {
      return { classification: "unknown", twoDropCount: null, earlyUnitCount: null };
    }
    if (metadata.costEnergy === 2) twoDropCount += 1;
    if (metadata.costEnergy <= 2) earlyUnitCount += 1;
  }
  return {
    classification: twoDropCount > 0 ? "two-drop-present" : "two-drop-missing",
    twoDropCount,
    earlyUnitCount,
  };
}

function playerLegendKeyFromDrill(drill: MulliganLabDrill): string {
  return cardIdentity(drill.matchup.playerLegend.cardCode);
}

function opponentLegendKeyFromDrill(drill: MulliganLabDrill): string {
  return cardIdentity(drill.matchup.opponentLegend.cardCode);
}

function dedupeCandidates(candidates: ObservedMulliganCandidate[]): ObservedMulliganCandidate[] {
  return [...new Map(candidates.map((candidate) => [candidate.observedHandId, candidate])).values()];
}

function matchupKey(candidate: ObservedMulliganCandidate): string {
  return [
    playerLegendKey(candidate),
    opponentLegendKey(candidate),
  ].join("|");
}

function playerLegendKey(candidate: ObservedMulliganCandidate): string {
  return cardIdentity(candidate.matchup.playerLegend.cardCode);
}

function opponentLegendKey(candidate: ObservedMulliganCandidate): string {
  return cardIdentity(candidate.matchup.opponentLegend.cardCode);
}

function cardIdentity(cardCode: string): string {
  return mulliganCardIdentity(cardCode) ?? cardCode;
}

function cardEvidenceStatus(
  offered: number,
  players: number,
  minimumHands: number,
  minimumPlayers: number,
): MulliganLabCardEvidence["evidenceStatus"] {
  if (offered < 8 || players < 4) return "limited";
  if (offered < minimumHands || players < minimumPlayers) return "developing";
  return "robust";
}

/**
 * Behavioural recommendation based only on how the community handled this
 * card in this oriented matchup. Outcomes are deliberately excluded: players
 * self-select keeps, deck builds differ, and the result is heavily confounded.
 * A Wilson interval prevents a handful of unanimous decisions becoming a
 * confident recommendation.
 */
function communityGuidance(
  kept: number,
  offered: number,
  baselineKeepRate: number,
  evidenceStatus: MulliganLabCardEvidence["evidenceStatus"],
): MulliganLabCardEvidence["guidance"] {
  if (evidenceStatus === "limited") return "unclear";
  const keepRate = kept / offered;
  if (evidenceStatus !== "robust") return "unclear";
  const { lower, upper } = wilsonInterval(kept, offered, 1.959963984540054);
  if (keepRate >= 0.85 && lower > 0.5) return "strong_keep";
  if (keepRate >= 0.65 && lower > 0.5 && keepRate > baselineKeepRate) return "keep";
  if (keepRate <= 0.15 && upper < 0.5) return "strong_redraw";
  if (keepRate <= 0.35 && upper < 0.5 && keepRate < baselineKeepRate) return "redraw";
  return "mixed";
}

function outcomeEvidenceStatus(
  kept: number,
  redrawn: number,
  keptPlayers: number,
  redrawnPlayers: number,
  evidenceStatus: MulliganLabCardEvidence["evidenceStatus"],
): MulliganLabCardEvidence["outcomeStatus"] {
  if (evidenceStatus === "limited") return "sparse";
  return kept >= 25 && redrawn >= 25 && keptPlayers >= 10 && redrawnPlayers >= 10
    ? "comparable"
    : "one_sided";
}

function wilsonInterval(successes: number, trials: number, z: number): { lower: number; upper: number } {
  const proportion = successes / trials;
  const zSquared = z * z;
  const denominator = 1 + zSquared / trials;
  const center = (proportion + zSquared / (2 * trials)) / denominator;
  const margin = z * Math.sqrt(
    (proportion * (1 - proportion) + zSquared / (4 * trials)) / trials,
  ) / denominator;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

function utcDayNumber(value: Date): number {
  return Math.floor(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ) / 86_400_000);
}

function dailyCandidateOffset(day: number, groupKey: string, length: number): number {
  if (length <= 1) return 0;
  return (day + Number.parseInt(digest(groupKey).slice(0, 8), 16)) % length;
}

function rotate<T>(values: T[], offset: number): T[] {
  if (!values.length || offset <= 0) return values;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

function rotateWithinEvidenceTiers<T extends { evidenceTier: number; groupKey: string }>(
  values: T[],
  day: number,
): T[] {
  const result: T[] = [];
  for (const tier of [2, 1, 0]) {
    const bucket = values.filter((value) => value.evidenceTier === tier)
      .sort((left, right) => left.groupKey.localeCompare(right.groupKey));
    if (!bucket.length) continue;
    const offset = (day + Number.parseInt(digest(`tier-${tier}`).slice(0, 8), 16)) % bucket.length;
    result.push(...rotate(bucket, offset));
  }
  return result;
}

function drillEvidencePriority(drill: MulliganLabDrill): number {
  const robust = drill.cardEvidence.filter((entry) => entry.evidenceStatus === "robust");
  if (robust.some((entry) => !["mixed", "unclear"].includes(entry.guidance))) return 4;
  if (robust.length) return 3;
  if (drill.cardEvidence.some((entry) => entry.evidenceStatus === "developing")) return 2;
  return 1;
}

function observedDateBoundary(
  candidates: ObservedMulliganCandidate[],
  position: "first" | "last",
): string {
  const dates = candidates.map((candidate) => candidate.observation.observedOn).sort();
  return (position === "first" ? dates[0] : dates.at(-1))!;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** SHA-256 of JSON.stringify([[cardCode,count], ...]) sorted by cardCode. */
export function mulliganDeckFingerprint(
  mainDeck: Array<{ cardCode: string; count: number }>,
): string {
  return digest([...mainDeck]
    .sort((left, right) => left.cardCode.localeCompare(right.cardCode))
    .map((entry) => [entry.cardCode, entry.count]));
}

function epochMilliseconds(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
  return milliseconds >= Date.UTC(2025, 0, 1) && milliseconds <= Date.now() + 10 * 60 * 1_000
    ? milliseconds
    : undefined;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function jsonObject(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function stringValue(value: JsonValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function integerValue(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
