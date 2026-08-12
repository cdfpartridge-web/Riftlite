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
  MulliganLabReadyResponseSchema,
  type MulliganLabCard,
  type MulliganLabCardEvidence,
  type MulliganLabDeck,
  type MulliganLabDrill,
  type MulliganLabReadyResponse,
} from "@/lib/mulligan-lab/contracts";

const CARD_CODE = /^[A-Z]{3}-\d{3}[A-Z]?$/;
const MAIN_DECK_SIZE = 40;

export type ObservedMulliganCandidate = {
  observedHandId: string;
  contributorKey: string;
  observation: MulliganLabDrill["observation"];
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

  const groups = new Map<string, ObservedMulliganCandidate[]>();
  for (const candidate of dedupeCandidates(candidates)) {
    const key = matchupKey(candidate);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  const preparedGroups = [...groups.entries()]
    .map(([groupKey, group]) => ({
      groupKey,
      group: group.sort((left, right) => left.observedHandId.localeCompare(right.observedHandId)),
      contributors: new Set(group.map((candidate) => candidate.contributorKey)),
      evidence: buildEvidence(group),
    }))
    // Prefer broader evidence when there are more than 64 matchup cohorts,
    // then round-robin so one large cohort cannot consume the entire pack.
    .sort((left, right) => (
      right.group.length - left.group.length || left.groupKey.localeCompare(right.groupKey)
    ));

  // A bounded public document cannot carry every exact hand and its bound
  // 40-card deck. Rotate the cohort window by UTC day instead of permanently
  // publishing only the largest cohorts. The step is the pack size, so
  // successive daily refreshes walk the whole circular cohort list. Candidate
  // hands rotate independently within each included cohort.
  const rotationDay = utcDayNumber(generatedAt);
  const groupOffset = preparedGroups.length > maxDrills
    ? (rotationDay * maxDrills) % preparedGroups.length
    : 0;
  const rotatedGroups = rotate(preparedGroups, groupOffset);

  const drills: MulliganLabDrill[] = [];
  for (let candidateIndex = 0; drills.length < maxDrills; candidateIndex += 1) {
    let added = false;
    for (const prepared of rotatedGroups) {
      if (candidateIndex >= prepared.group.length) continue;
      const candidateOffset = dailyCandidateOffset(rotationDay, prepared.groupKey, prepared.group.length);
      const candidate = prepared.group[(candidateOffset + candidateIndex) % prepared.group.length];
      if (!candidate) continue;
      added = true;
      const handCodes = new Set(candidate.hand.map((card) => card.cardCode));
      drills.push({
        id: `ml1_${digest([prepared.groupKey, candidate.observedHandId, candidate.deck.fingerprint]).slice(0, 32)}`,
        observedHandId: candidate.observedHandId,
        observation: candidate.observation,
        matchup: candidate.matchup,
        initiative: candidate.initiative,
        hand: candidate.hand,
        observedDecision: {
          redrawnCardIndexes: candidate.redrawnCardIndexes,
          wonGame: candidate.wonGame,
        },
        deck: candidate.deck,
        evidence: {
          status: prepared.group.length >= minimumHands && prepared.contributors.size >= minimumPlayers
            ? "sufficient"
            : "early",
          scope: "matchup-initiative",
          hands: prepared.group.length,
          players: prepared.contributors.size,
        },
        cardEvidence: [...handCodes].sort().map((code) => prepared.evidence.get(code)!),
      });
      if (drills.length >= maxDrills) break;
    }
    if (!added) break;
  }
  if (!drills.length) return null;

  const response: MulliganLabReadyResponse = {
    schema: "riftlite-mulligan-lab",
    version: 1,
    status: "ready",
    generatedAt: generatedAt.toISOString(),
    expiresAt: new Date(generatedAt.getTime() + lifetimeHours * 60 * 60 * 1_000).toISOString(),
    source: {
      kind: "precomputed-observed-replays",
      corpus: "anonymized-canonical-web-replays",
      minimumHands,
      minimumPlayers,
    },
    drills: drills.sort((left, right) => left.id.localeCompare(right.id)),
  };
  return MulliganLabReadyResponseSchema.parse(response);
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

function buildEvidence(
  group: ObservedMulliganCandidate[],
): Map<string, MulliganLabCardEvidence> {
  const stats = new Map<string, MulliganLabCardEvidence & { contributors: Set<string> }>();
  for (const candidate of group) {
    const redrawn = new Set(candidate.redrawnCardIndexes);
    candidate.hand.forEach((card, index) => {
      const entry = stats.get(card.cardCode) ?? {
        ...card,
        offered: 0,
        kept: 0,
        redrawn: 0,
        keptWins: 0,
        redrawnWins: 0,
        contributors: new Set<string>(),
      };
      entry.offered += 1;
      entry.contributors.add(candidate.contributorKey);
      if (redrawn.has(index)) {
        entry.redrawn += 1;
        if (candidate.wonGame) entry.redrawnWins += 1;
      } else {
        entry.kept += 1;
        if (candidate.wonGame) entry.keptWins += 1;
      }
      stats.set(card.cardCode, entry);
    });
  }
  return new Map([...stats]
    .map(([code, entry]) => [code, {
      cardCode: entry.cardCode,
      name: entry.name,
      offered: entry.offered,
      kept: entry.kept,
      redrawn: entry.redrawn,
      keptWins: entry.keptWins,
      redrawnWins: entry.redrawnWins,
    }]));
}

function dedupeCandidates(candidates: ObservedMulliganCandidate[]): ObservedMulliganCandidate[] {
  return [...new Map(candidates.map((candidate) => [candidate.observedHandId, candidate])).values()];
}

function matchupKey(candidate: ObservedMulliganCandidate): string {
  return [
    candidate.matchup.playerLegend.cardCode,
    candidate.matchup.opponentLegend.cardCode,
    candidate.initiative,
  ].join("|");
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
