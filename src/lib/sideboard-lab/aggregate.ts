import { createHash } from "node:crypto";

import {
  DEFAULT_SIDEBOARD_LAB_MINIMUM_DECISIONS,
  DEFAULT_SIDEBOARD_LAB_MINIMUM_PLAYERS,
  SideboardLabPackReadyResponseSchema,
  SideboardLabReadyResponseSchema,
  type SideboardLabCard,
  type SideboardLabCardEvidence,
  type SideboardLabDeck,
  type SideboardLabDrill,
  type SideboardLabEvidenceSlice,
  type SideboardLabPackReadyResponse,
  type SideboardLabReadyResponse,
  type SideboardLabSwapCard,
} from "@/lib/sideboard-lab/contracts";
import {
  MULLIGAN_CARD_REGISTRY_METADATA,
  mulliganCardIdentity,
  mulliganCardMetadata,
} from "@/lib/mulligan-lab/registry";
import type { ObservedSideboardCandidate } from "@/lib/sideboard-lab/extract";

const CARD_GUIDANCE_MINIMUM_OPPORTUNITIES = 25;
const CARD_GUIDANCE_MINIMUM_PLAYERS = 10;
const CURRENT_SEASON_STARTED_ON = "2026-07-31" as const;
// Leave comfortable room beneath Firestore's 1 MiB document ceiling for the
// aggregate wrapper and Firestore's per-field encoding overhead.
const MAX_SNAPSHOT_JSON_BYTES = 700_000;

export type { ObservedSideboardCandidate } from "@/lib/sideboard-lab/extract";

export type SideboardLabAggregateOptions = {
  minimumDecisions?: number;
  minimumPlayers?: number;
  maxDrills?: number;
  generatedAt?: Date;
  lifetimeHours?: number;
  coverageTruncated?: boolean;
  backfillComplete?: boolean;
  targetPlayerLegendIdentityCode?: string;
  targetOpponentLegendIdentityCode?: string;
  targetDeckFingerprint?: string;
  targetPriorGameResult?: "win" | "loss";
};

export type SideboardLabPackTarget = {
  playerLegendIdentityCode: string;
  opponentLegendIdentityCode?: string;
  deckFingerprint?: string;
  priorGameResult?: "win" | "loss";
};

type Direction = "in" | "out";

type RawCardEvidence = SideboardLabCard & {
  direction: Direction;
  opportunities: number;
  selected: number;
  selectedCopies: number;
  selectedWins: number;
  notSelectedWins: number;
  contributors: Set<string>;
  selectedContributors: Set<string>;
  notSelectedContributors: Set<string>;
  guidanceTallies: Map<string, { selected: number; notSelected: number }>;
  guidanceDecisions: Map<string, boolean>;
};

type RawEvidenceScope = {
  decisions: number;
  contributors: Set<string>;
  baselineByDirection: Record<Direction, number>;
  cards: Map<string, RawCardEvidence>;
};

/**
 * Builds a bounded daily drill pack while calculating every percentage from
 * all indexed, exact Game 2 decisions. The sampled deck supplies only a legal
 * practice surface; its original swaps, outcome, replay id, and contributor
 * identity never enter the public response.
 */
export function buildSideboardLabSnapshot(
  candidates: ObservedSideboardCandidate[],
  options: SideboardLabAggregateOptions = {},
): SideboardLabReadyResponse | null {
  const minimumDecisions = positiveInteger(options.minimumDecisions)
    ?? DEFAULT_SIDEBOARD_LAB_MINIMUM_DECISIONS;
  const minimumPlayers = positiveInteger(options.minimumPlayers)
    ?? DEFAULT_SIDEBOARD_LAB_MINIMUM_PLAYERS;
  const maxDrills = Math.min(48, positiveInteger(options.maxDrills) ?? 48);
  const generatedAt = options.generatedAt ?? new Date();
  const lifetimeHours = positiveInteger(options.lifetimeHours) ?? 36;
  const balanced = dedupeCandidates(candidates);

  const matchupGroups = new Map<string, ObservedSideboardCandidate[]>();
  const legendGroups = new Map<string, ObservedSideboardCandidate[]>();
  for (const candidate of balanced) {
    const matchup = matchupKey(candidate);
    matchupGroups.set(matchup, [...(matchupGroups.get(matchup) ?? []), candidate]);
    const legend = playerLegendGroupKey(candidate);
    legendGroups.set(legend, [...(legendGroups.get(legend) ?? []), candidate]);
  }

  const prepared = [...matchupGroups.entries()]
    .filter(([, group]) => {
      const sample = group[0];
      if (!sample) return false;
      return (
        (!options.targetPlayerLegendIdentityCode || playerLegendIdentityCode(sample) === options.targetPlayerLegendIdentityCode) &&
        (!options.targetOpponentLegendIdentityCode || opponentLegendKey(sample) === options.targetOpponentLegendIdentityCode) &&
        (!options.targetPriorGameResult || priorResultKey(sample) === options.targetPriorGameResult)
      );
    })
    .map(([groupKey, unsorted]) => {
    const group = [...unsorted].sort((left, right) => (
      left.observedDecisionId.localeCompare(right.observedDecisionId)
    ));
    const contributors = new Set(group.map((candidate) => candidate.contributorKey));
    const matchupEvidence = buildRawEvidence(group);
    const playerLegendEvidence = buildRawEvidence(legendGroups.get(playerLegendGroupKey(group[0]!)) ?? group);
    const evidence = publishEvidence(
      matchupEvidence,
      playerLegendEvidence,
      minimumDecisions,
      minimumPlayers,
    );
    const drillCandidates = group.filter((candidate) => (
      everyDeckCardHasEvidence(candidate.deck, evidence) &&
      (!options.targetDeckFingerprint || candidate.deck.fingerprint === options.targetDeckFingerprint)
    ));
    const evidenceTier = group.length >= 8 && contributors.size >= 4
      ? 2
      : group.length >= 3 && contributors.size >= 2
        ? 1
        : 0;
    return { groupKey, group, contributors, evidence, drillCandidates, evidenceTier };
  }).sort((left, right) => (
    right.evidenceTier - left.evidenceTier ||
    right.group.length - left.group.length ||
    left.groupKey.localeCompare(right.groupKey)
  ));

  const day = utcDayNumber(generatedAt);
  const rotated = rotateWithinEvidenceTiers(prepared, day);
  const drills: SideboardLabDrill[] = [];
  for (let candidateIndex = 0; drills.length < maxDrills; candidateIndex += 1) {
    let added = false;
    for (const item of rotated) {
      if (candidateIndex >= item.drillCandidates.length) continue;
      const offset = dailyCandidateOffset(day, item.groupKey, item.drillCandidates.length);
      const candidate = item.drillCandidates[(offset + candidateIndex) % item.drillCandidates.length];
      if (!candidate) continue;
      added = true;
      drills.push({
        id: `sl1_${digest([item.groupKey, candidate.observedDecisionId, candidate.deck.fingerprint]).slice(0, 32)}`,
        matchup: candidate.matchup,
        priorGameResult: candidate.observation.priorGameWon ? "win" : "loss",
        deck: candidate.deck,
        evidence: {
          status: item.group.length >= minimumDecisions && item.contributors.size >= minimumPlayers
            ? "sufficient"
            : "early",
          scope: "matchup",
          deckScope: "all-observed-decks",
          guidanceBasis: "community-selection-rate",
          outcomeInterpretation: "descriptive-not-causal",
          playerLegendIdentityCode: playerLegendIdentityCode(candidate),
          opponentLegendIdentityCode: opponentLegendKey(candidate),
          decisions: item.group.length,
          players: item.contributors.size,
        },
        cardEvidence: evidenceForDeck(candidate.deck, item.evidence),
      });
      if (drills.length >= maxDrills) break;
    }
    if (!added) break;
  }
  if (!drills.length) return null;

  const preseasonFacts = balanced.filter((candidate) => (
    candidate.observation.observedOn < CURRENT_SEASON_STARTED_ON
  )).length;
  const currentSeasonFacts = balanced.length - preseasonFacts;
  const response = {
    schema: "riftlite-sideboard-lab",
    version: 1,
    status: "ready",
    generatedAt: generatedAt.toISOString(),
    expiresAt: new Date(generatedAt.getTime() + lifetimeHours * 3_600_000).toISOString(),
    source: {
      kind: "precomputed-observed-replays",
      corpus: "anonymized-canonical-web-replays",
      minimumDecisions,
      minimumPlayers,
      observedFrom: observedDateBoundary(balanced, "first"),
      observedThrough: observedDateBoundary(balanced, "last"),
      includedFacts: balanced.length,
      coverageTruncated: options.coverageTruncated === true,
      coveragePolicy: "all-available-history",
      includedPeriods: [
        ...(preseasonFacts > 0 ? ["preseason" as const] : []),
        ...(currentSeasonFacts > 0 ? ["current-season" as const] : []),
      ],
      backfillComplete: options.backfillComplete === true,
      seasonCoverage: {
        currentSeasonStartedOn: CURRENT_SEASON_STARTED_ON,
        preseasonFacts,
        currentSeasonFacts,
      },
    },
    drills: drills.sort((left, right) => drillPriority(right) - drillPriority(left)),
  };
  while (response.drills.length > 1 && Buffer.byteLength(JSON.stringify(response), "utf8") > MAX_SNAPSHOT_JSON_BYTES) {
    response.drills.pop();
  }
  return SideboardLabReadyResponseSchema.parse(response);
}

/** Builds the additive Sideboard v2 pack used by targeted desktop queries. */
export function buildSideboardLabPack(
  candidates: ObservedSideboardCandidate[],
  target: SideboardLabPackTarget,
  options: SideboardLabAggregateOptions = {},
): SideboardLabPackReadyResponse | null {
  const minimumDecisions = positiveInteger(options.minimumDecisions)
    ?? DEFAULT_SIDEBOARD_LAB_MINIMUM_DECISIONS;
  const minimumPlayers = positiveInteger(options.minimumPlayers)
    ?? DEFAULT_SIDEBOARD_LAB_MINIMUM_PLAYERS;
  const balanced = dedupeCandidates(candidates);
  const exactDeckCohort = target.deckFingerprint
    ? balanced.filter((candidate) => (
      playerLegendIdentityCode(candidate) === target.playerLegendIdentityCode &&
      (!target.opponentLegendIdentityCode || opponentLegendKey(candidate) === target.opponentLegendIdentityCode) &&
      (!target.priorGameResult || priorResultKey(candidate) === target.priorGameResult) &&
      candidate.deck.fingerprint === target.deckFingerprint
    ))
    : [];
  const exactDeckKnown = exactDeckCohort.length > 0;
  const exactDeckPublishable = exactDeckCohort.length >= 8 &&
    new Set(exactDeckCohort.map((candidate) => candidate.contributorKey)).size >= 4;
  const snapshot = buildSideboardLabSnapshot(balanced, {
    ...options,
    maxDrills: Math.min(24, positiveInteger(options.maxDrills) ?? 12),
    targetPlayerLegendIdentityCode: target.playerLegendIdentityCode,
    targetOpponentLegendIdentityCode: target.opponentLegendIdentityCode,
    targetPriorGameResult: target.priorGameResult,
    targetDeckFingerprint: exactDeckPublishable ? target.deckFingerprint : undefined,
  });
  if (!snapshot) return null;

  const drills = snapshot.drills.map((drill) => {
    const group = balanced.filter((candidate) => (
      playerLegendIdentityCode(candidate) === cardIdentity(drill.matchup.playerLegend.cardCode) &&
      opponentLegendKey(candidate) === cardIdentity(drill.matchup.opponentLegend.cardCode) &&
      priorResultKey(candidate) === drill.priorGameResult
    ));
    return {
      ...drill,
      context: {
        nextInitiative: sideboardNextInitiative(group, drill.deck.fingerprint),
        format: "bo3" as const,
        provider: "atlas" as const,
        targetGameNumber: 2 as const,
      },
      decisionEvidence: sideboardDecisionEvidence(group),
      packages: sideboardPackages(group, minimumDecisions, minimumPlayers),
      cardEvidence: drill.cardEvidence.map((entry) => ({
        ...entry,
        quantity: sideboardQuantityEvidence(
          group,
          entry.direction,
          entry.identityCode,
          minimumDecisions,
          minimumPlayers,
        ),
        periods: {
          preseason: sideboardEvidenceSlice(
            group.filter((candidate) => candidate.observation.observedOn < CURRENT_SEASON_STARTED_ON),
            entry.direction,
            entry.identityCode,
            minimumDecisions,
            minimumPlayers,
          ),
          currentSeason: sideboardEvidenceSlice(
            group.filter((candidate) => candidate.observation.observedOn >= CURRENT_SEASON_STARTED_ON),
            entry.direction,
            entry.identityCode,
            minimumDecisions,
            minimumPlayers,
          ),
        },
      })),
    };
  });
  const exactDeckResolved = Boolean(exactDeckPublishable && target.deckFingerprint &&
    drills.some((drill) => drill.deck.fingerprint === target.deckFingerprint));
  const response: SideboardLabPackReadyResponse = {
    schema: "riftlite-sideboard-lab-pack",
    version: 1,
    status: "ready",
    generatedAt: snapshot.generatedAt,
    expiresAt: snapshot.expiresAt,
    query: {
      requested: {
        playerLegend: target.playerLegendIdentityCode,
        opponentLegend: target.opponentLegendIdentityCode ?? null,
        deckFingerprint: target.deckFingerprint ?? null,
        priorGameResult: target.priorGameResult ?? null,
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
      formatPolicy: {
        format: "bo3",
        // Canonical captures do not currently carry a ruleset identifier. The
        // current reference is therefore display guidance only; extraction
        // continues to accept structurally valid historical facts instead of
        // retroactively applying today's ten-card cap.
        observedRulesEpoch: "unknown",
        currentReference: {
          mainDeckCards: 40,
          sideboardMaximum: 10,
          swaps: "one-for-one",
          championChangesAllowed: true,
          fixedSections: ["legend", "runes", "battlefields"],
        },
        historicalValidation: "structural-only-no-retroactive-rules",
      },
    },
    drills,
  };
  while (response.drills.length > 1 && Buffer.byteLength(JSON.stringify(response), "utf8") > MAX_SNAPSHOT_JSON_BYTES) {
    response.drills.pop();
  }
  return SideboardLabPackReadyResponseSchema.parse(response);
}

function buildRawEvidence(group: ObservedSideboardCandidate[]): RawEvidenceScope {
  const cards = new Map<string, RawCardEvidence>();
  for (const candidate of [...group].sort((left, right) => (
    left.observedDecisionId.localeCompare(right.observedDecisionId)
  ))) {
    const selectedByDirection = {
      in: swapCounts(candidate.cardsIn),
      out: swapCounts(candidate.cardsOut),
    };
    for (const direction of ["out", "in"] as const) {
      const available = direction === "out" ? candidate.deck.mainDeck : candidate.deck.sideboard;
      // Cosmetic/alternate prints of one base card remain one decision
      // opportunity, even if a registered deck happens to contain both.
      const availableByIdentity = new Map<string, SideboardLabCard>();
      for (const card of available) {
        availableByIdentity.set(cardIdentity(card.cardCode), card);
      }
      for (const [identityCode, card] of availableByIdentity) {
        const key = evidenceKey(direction, identityCode);
        const selectedCopies = selectedByDirection[direction].get(identityCode) ?? 0;
        const entry = cards.get(key) ?? {
          cardCode: card.cardCode,
          name: card.name,
          direction,
          opportunities: 0,
          selected: 0,
          selectedCopies: 0,
          selectedWins: 0,
          notSelectedWins: 0,
          contributors: new Set<string>(),
          selectedContributors: new Set<string>(),
          notSelectedContributors: new Set<string>(),
          guidanceTallies: new Map<string, { selected: number; notSelected: number }>(),
          guidanceDecisions: new Map<string, boolean>(),
        };
        entry.opportunities += 1;
        entry.contributors.add(candidate.contributorKey);
        const tally = entry.guidanceTallies.get(candidate.contributorKey) ?? { selected: 0, notSelected: 0 };
        if (selectedCopies > 0) {
          entry.selected += 1;
          entry.selectedCopies += selectedCopies;
          entry.selectedContributors.add(candidate.contributorKey);
          tally.selected += 1;
          if (candidate.wonGame) entry.selectedWins += 1;
        } else {
          entry.notSelectedContributors.add(candidate.contributorKey);
          tally.notSelected += 1;
          if (candidate.wonGame) entry.notSelectedWins += 1;
        }
        entry.guidanceTallies.set(candidate.contributorKey, tally);
        cards.set(key, entry);
      }
    }
  }

  for (const entry of cards.values()) {
    for (const [contributor, tally] of entry.guidanceTallies) {
      if (tally.selected === tally.notSelected) continue;
      entry.guidanceDecisions.set(contributor, tally.selected > tally.notSelected);
    }
  }

  const baselineByDirection = { in: 0, out: 0 };
  for (const direction of ["in", "out"] as const) {
    const entries = [...cards.values()].filter((entry) => entry.direction === direction);
    const opportunities = entries.reduce((sum, entry) => sum + entry.guidanceDecisions.size, 0);
    const selected = entries.reduce((sum, entry) => (
      sum + [...entry.guidanceDecisions.values()].filter(Boolean).length
    ), 0);
    baselineByDirection[direction] = opportunities > 0 ? selected / opportunities : 0;
  }
  return {
    decisions: group.length,
    contributors: new Set(group.map((candidate) => candidate.contributorKey)),
    baselineByDirection,
    cards,
  };
}

function publishEvidence(
  matchup: RawEvidenceScope,
  playerLegend: RawEvidenceScope,
  minimumDecisions: number,
  minimumPlayers: number,
): Map<string, SideboardLabCardEvidence> {
  const result = new Map<string, SideboardLabCardEvidence>();
  for (const [key, matchupCard] of matchup.cards) {
    const reliableOpportunities = Math.max(CARD_GUIDANCE_MINIMUM_OPPORTUNITIES, minimumDecisions);
    const reliablePlayers = Math.max(CARD_GUIDANCE_MINIMUM_PLAYERS, minimumPlayers);
    const matchupReliable = matchupCard.opportunities >= reliableOpportunities
      && matchupCard.guidanceDecisions.size >= reliablePlayers;
    const matchupDeveloping = matchupCard.opportunities >= 8
      && matchupCard.guidanceDecisions.size >= 4;
    const broaderCard = playerLegend.cards.get(key) ?? matchupCard;
    const broaderReliable = broaderCard.opportunities >= reliableOpportunities
      && broaderCard.guidanceDecisions.size >= reliablePlayers;
    const broaderDeveloping = broaderCard.opportunities >= 8
      && broaderCard.guidanceDecisions.size >= 4;
    const materiallyBroader = broaderCard.opportunities >= matchupCard.opportunities * 2
      && broaderCard.guidanceDecisions.size >= matchupCard.guidanceDecisions.size * 2;
    const useBroader = !matchupReliable && (
      broaderReliable ||
      (!matchupDeveloping && broaderDeveloping) ||
      (matchupDeveloping && broaderDeveloping && materiallyBroader)
    );
    const scope = useBroader ? playerLegend : matchup;
    const entry = useBroader ? broaderCard : matchupCard;
    if (entry.guidanceDecisions.size === 0) continue;
    const notSelected = entry.opportunities - entry.selected;
    const guidancePlayers = entry.guidanceDecisions.size;
    const guidanceSelected = [...entry.guidanceDecisions.values()].filter(Boolean).length;
    const selectedWinRate = entry.selected > 0 ? entry.selectedWins / entry.selected : null;
    const notSelectedWinRate = notSelected > 0 ? entry.notSelectedWins / notSelected : null;
    const evidenceStatus = cardEvidenceStatus(
      entry.opportunities,
      guidancePlayers,
      reliableOpportunities,
      reliablePlayers,
    );
    result.set(key, {
      cardCode: entry.cardCode,
      identityCode: key.split(":")[1]!,
      name: entry.name,
      direction: entry.direction,
      scope: useBroader ? "player-legend" : "matchup",
      scopeDecisions: scope.decisions,
      scopePlayers: scope.contributors.size,
      opportunities: entry.opportunities,
      players: entry.contributors.size,
      selected: entry.selected,
      selectedPlayers: entry.selectedContributors.size,
      selectedCopies: entry.selectedCopies,
      selectedWins: entry.selectedWins,
      notSelectedWins: entry.notSelectedWins,
      selectionRate: entry.selected / entry.opportunities,
      baselineSelectionRate: scope.baselineByDirection[entry.direction],
      guidancePlayers,
      guidanceSelected,
      guidanceSelectionRate: guidanceSelected / guidancePlayers,
      selectedWinRate,
      notSelectedWinRate,
      winRateDelta: selectedWinRate !== null && notSelectedWinRate !== null
        ? selectedWinRate - notSelectedWinRate
        : null,
      guidance: communityGuidance(
        guidanceSelected,
        guidancePlayers,
        scope.baselineByDirection[entry.direction],
        evidenceStatus,
      ),
      evidenceStatus,
      outcomeStatus: outcomeEvidenceStatus(
        entry.selected,
        notSelected,
        entry.selectedContributors.size,
        entry.notSelectedContributors.size,
        evidenceStatus,
      ),
    });
  }
  return result;
}

function everyDeckCardHasEvidence(
  deck: SideboardLabDeck,
  evidence: Map<string, SideboardLabCardEvidence>,
): boolean {
  return deck.mainDeck.every((card) => evidence.has(evidenceKey("out", cardIdentity(card.cardCode))))
    && deck.sideboard.every((card) => evidence.has(evidenceKey("in", cardIdentity(card.cardCode))));
}

function evidenceForDeck(
  deck: SideboardLabDeck,
  evidence: Map<string, SideboardLabCardEvidence>,
): SideboardLabCardEvidence[] {
  return [
    ...deck.mainDeck.map((card) => ({ card, direction: "out" as const })),
    ...deck.sideboard.map((card) => ({ card, direction: "in" as const })),
  ].map(({ card, direction }) => ({
    ...evidence.get(evidenceKey(direction, cardIdentity(card.cardCode)))!,
    cardCode: card.cardCode,
    name: card.name,
  })).sort((left, right) => (
    left.direction.localeCompare(right.direction) || left.cardCode.localeCompare(right.cardCode)
  ));
}

function sideboardDecisionEvidence(group: ObservedSideboardCandidate[]) {
  const byCopies = new Map<number, { decisions: number; players: Set<string> }>();
  let noChangeDecisions = 0;
  const noChangePlayers = new Set<string>();
  const copySamples: number[] = [];
  for (const candidate of group) {
    const copies = candidate.cardsIn.reduce((sum, card) => sum + card.count, 0);
    copySamples.push(copies);
    const bucket = byCopies.get(copies) ?? { decisions: 0, players: new Set<string>() };
    bucket.decisions += 1;
    bucket.players.add(candidate.contributorKey);
    byCopies.set(copies, bucket);
    if (copies === 0) {
      noChangeDecisions += 1;
      noChangePlayers.add(candidate.contributorKey);
    }
  }
  return {
    decisions: group.length,
    players: new Set(group.map((candidate) => candidate.contributorKey)).size,
    noChangeDecisions,
    noChangePlayers: noChangePlayers.size,
    noChangeRate: noChangeDecisions / group.length,
    swapCountHistogram: [...byCopies.entries()]
      .sort(([left], [right]) => left - right)
      .map(([copies, bucket]) => ({
        copies,
        decisions: bucket.decisions,
        players: bucket.players.size,
      })),
    medianCopiesMoved: median(copySamples),
  };
}

function sideboardNextInitiative(
  group: ObservedSideboardCandidate[],
  deckFingerprint: string,
): "first" | "second" | "unknown" {
  const known = group.filter((candidate) => (
    candidate.deck.fingerprint === deckFingerprint &&
    (candidate.observation.nextInitiative === "first" || candidate.observation.nextInitiative === "second")
  ));
  if (new Set(known.map((candidate) => candidate.contributorKey)).size < 4) return "unknown";
  const values = new Set(known.map((candidate) => candidate.observation.nextInitiative));
  return values.size === 1 ? [...values][0] as "first" | "second" : "unknown";
}

function sideboardQuantityEvidence(
  group: ObservedSideboardCandidate[],
  direction: Direction,
  identityCode: string,
  minimumDecisions: number,
  minimumPlayers: number,
) {
  const buckets = new Map<number, { decisions: number; players: Set<string> }>();
  const selectedSamples: number[] = [];
  const opportunityPlayers = new Set<string>();
  let opportunities = 0;
  for (const candidate of group) {
    const available = direction === "out" ? candidate.deck.mainDeck : candidate.deck.sideboard;
    if (!available.some((card) => cardIdentity(card.cardCode) === identityCode)) continue;
    const selected = swapCounts(direction === "out" ? candidate.cardsOut : candidate.cardsIn)
      .get(identityCode) ?? 0;
    opportunities += 1;
    opportunityPlayers.add(candidate.contributorKey);
    if (selected > 0) selectedSamples.push(selected);
    const bucket = buckets.get(selected) ?? { decisions: 0, players: new Set<string>() };
    bucket.decisions += 1;
    bucket.players.add(candidate.contributorKey);
    buckets.set(selected, bucket);
  }
  return {
    histogram: [...buckets.entries()]
      .sort(([left], [right]) => left - right)
      .map(([copies, bucket]) => ({
        copies: Math.min(3, copies),
        decisions: bucket.decisions,
        players: bucket.players.size,
      })),
    selectedMedianCopies: median(selectedSamples),
    status: cardEvidenceStatus(
      opportunities,
      opportunityPlayers.size,
      Math.max(CARD_GUIDANCE_MINIMUM_OPPORTUNITIES, minimumDecisions),
      Math.max(CARD_GUIDANCE_MINIMUM_PLAYERS, minimumPlayers),
    ),
  };
}

function sideboardEvidenceSlice(
  group: ObservedSideboardCandidate[],
  direction: Direction,
  identityCode: string,
  minimumDecisions: number,
  minimumPlayers: number,
): SideboardLabEvidenceSlice | null {
  if (!group.length) return null;
  const scope = buildRawEvidence(group);
  const entry = scope.cards.get(evidenceKey(direction, identityCode));
  if (!entry || entry.opportunities < 8 || entry.guidanceDecisions.size < 4) return null;
  const guidancePlayers = entry.guidanceDecisions.size;
  const guidanceSelected = [...entry.guidanceDecisions.values()].filter(Boolean).length;
  const evidenceStatus = cardEvidenceStatus(
    entry.opportunities,
    guidancePlayers,
    Math.max(CARD_GUIDANCE_MINIMUM_OPPORTUNITIES, minimumDecisions),
    Math.max(CARD_GUIDANCE_MINIMUM_PLAYERS, minimumPlayers),
  );
  return {
    opportunities: entry.opportunities,
    players: entry.contributors.size,
    selected: entry.selected,
    selectedCopies: entry.selectedCopies,
    guidancePlayers,
    guidanceSelected,
    guidanceSelectionRate: guidanceSelected / guidancePlayers,
    guidance: communityGuidance(
      guidanceSelected,
      guidancePlayers,
      scope.baselineByDirection[direction],
      evidenceStatus,
    ),
    evidenceStatus,
  };
}

function sideboardPackages(
  group: ObservedSideboardCandidate[],
  minimumDecisions: number,
  minimumPlayers: number,
) {
  const packages = new Map<string, {
    cardsIn: SideboardLabSwapCard[];
    cardsOut: SideboardLabSwapCard[];
    decisions: number;
    players: Set<string>;
  }>();
  for (const candidate of group) {
    const cardsIn = canonicalPackageCards(candidate.cardsIn);
    const cardsOut = canonicalPackageCards(candidate.cardsOut);
    if (cardsIn.length === 0 && cardsOut.length === 0) continue;
    const key = JSON.stringify({
      in: cardsIn.map((card) => [card.cardCode, card.count]),
      out: cardsOut.map((card) => [card.cardCode, card.count]),
    });
    const entry = packages.get(key) ?? {
      cardsIn,
      cardsOut,
      decisions: 0,
      players: new Set<string>(),
    };
    entry.decisions += 1;
    entry.players.add(candidate.contributorKey);
    packages.set(key, entry);
  }
  return [...packages.values()]
    .filter((entry) => entry.decisions >= 8 && entry.players.size >= 4)
    .sort((left, right) => right.decisions - left.decisions || right.players.size - left.players.size)
    .slice(0, 8)
    .map((entry) => ({
      cardsIn: entry.cardsIn,
      cardsOut: entry.cardsOut,
      decisions: entry.decisions,
      players: entry.players.size,
      selectionRate: entry.decisions / group.length,
      evidenceStatus: entry.decisions >= Math.max(CARD_GUIDANCE_MINIMUM_OPPORTUNITIES, minimumDecisions) &&
        entry.players.size >= Math.max(CARD_GUIDANCE_MINIMUM_PLAYERS, minimumPlayers)
        ? "robust" as const
        : "developing" as const,
    }));
}

function canonicalPackageCards(cards: SideboardLabSwapCard[]): SideboardLabSwapCard[] {
  const counts = swapCounts(cards);
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([cardCode, count]) => {
    const metadata = mulliganCardMetadata(cardCode);
    return metadata ? [{ cardCode, name: metadata.name, count }] : [];
  });
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function swapCounts(cards: SideboardLabSwapCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const key = cardIdentity(card.cardCode);
    counts.set(key, (counts.get(key) ?? 0) + card.count);
  }
  return counts;
}

function cardEvidenceStatus(
  opportunities: number,
  players: number,
  reliableOpportunities: number,
  reliablePlayers: number,
): SideboardLabCardEvidence["evidenceStatus"] {
  if (opportunities < 8 || players < 4) return "limited";
  if (opportunities < reliableOpportunities || players < reliablePlayers) return "developing";
  return "robust";
}

function communityGuidance(
  selected: number,
  opportunities: number,
  baseline: number,
  status: SideboardLabCardEvidence["evidenceStatus"],
): SideboardLabCardEvidence["guidance"] {
  if (status !== "robust") return "unclear";
  const rate = selected / opportunities;
  const { lower, upper } = wilsonInterval(selected, opportunities, 1.959963984540054);
  if (rate >= 0.85 && lower > 0.5) return "strong_select";
  if (rate >= 0.65 && lower > 0.5 && rate > baseline) return "select";
  if (rate <= 0.15 && upper < 0.5) return "strong_avoid";
  if (rate <= 0.35 && upper < 0.5 && rate < baseline) return "avoid";
  return "mixed";
}

function outcomeEvidenceStatus(
  selected: number,
  notSelected: number,
  selectedPlayers: number,
  notSelectedPlayers: number,
  status: SideboardLabCardEvidence["evidenceStatus"],
): SideboardLabCardEvidence["outcomeStatus"] {
  if (status === "limited") return "sparse";
  return selected >= 25 && notSelected >= 25 && selectedPlayers >= 10 && notSelectedPlayers >= 10
    ? "comparable"
    : "one_sided";
}

function wilsonInterval(successes: number, trials: number, z: number) {
  const proportion = successes / trials;
  const zSquared = z * z;
  const denominator = 1 + zSquared / trials;
  const center = (proportion + zSquared / (2 * trials)) / denominator;
  const margin = z * Math.sqrt(
    (proportion * (1 - proportion) + zSquared / (4 * trials)) / trials,
  ) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function dedupeCandidates(candidates: ObservedSideboardCandidate[]): ObservedSideboardCandidate[] {
  return [...new Map(candidates.map((candidate) => [candidate.observedDecisionId, candidate])).values()];
}

function matchupKey(candidate: ObservedSideboardCandidate): string {
  return `${playerLegendIdentityCode(candidate)}|${opponentLegendKey(candidate)}|${priorResultKey(candidate)}`;
}

function playerLegendIdentityCode(candidate: ObservedSideboardCandidate): string {
  return cardIdentity(candidate.matchup.playerLegend.cardCode);
}

function playerLegendGroupKey(candidate: ObservedSideboardCandidate): string {
  return `${cardIdentity(candidate.matchup.playerLegend.cardCode)}|${priorResultKey(candidate)}`;
}

function opponentLegendKey(candidate: ObservedSideboardCandidate): string {
  return cardIdentity(candidate.matchup.opponentLegend.cardCode);
}

function priorResultKey(candidate: ObservedSideboardCandidate): "win" | "loss" {
  return candidate.observation.priorGameWon ? "win" : "loss";
}

function cardIdentity(cardCode: string): string {
  return mulliganCardIdentity(cardCode) ?? cardCode;
}

function evidenceKey(direction: Direction, identityCode: string): string {
  return `${direction}:${identityCode}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export { sideboardDeckFingerprint } from "@/lib/sideboard-lab/extract";

function observedDateBoundary(
  candidates: ObservedSideboardCandidate[],
  direction: "first" | "last",
): string | null {
  const days = candidates.map((candidate) => candidate.observation.observedOn).sort();
  return (direction === "first" ? days[0] : days.at(-1)) ?? null;
}

function utcDayNumber(value: Date): number {
  return Math.floor(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) / 86_400_000);
}

function dailyCandidateOffset(day: number, groupKey: string, length: number): number {
  return length <= 1 ? 0 : (day + Number.parseInt(digest(groupKey).slice(0, 8), 16)) % length;
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
    result.push(...rotate(bucket, bucket.length ? day % bucket.length : 0));
  }
  return result;
}

function drillPriority(drill: SideboardLabDrill): number {
  return drill.evidence.decisions * 100_000 + drill.evidence.players;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
