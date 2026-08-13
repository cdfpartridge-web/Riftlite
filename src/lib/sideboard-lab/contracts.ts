import { z } from "zod";

import registryData from "@/lib/mulligan-lab/card-registry-v1.json";

type RegistryCard = { basePrintId: string; name: string };

const REGISTRY = registryData.cards as Record<string, RegistryCard>;
const SHA256 = /^[a-f0-9]{64}$/;
const RATE = z.number().min(0).max(1);
const CARD_FIELDS = {
  cardCode: z.string().refine((code) => Boolean(REGISTRY[code]), {
    message: "cardCode must exist in the packaged card registry",
  }),
  name: z.string().trim().min(1).max(120),
};

function requireCanonicalCardName(
  card: { cardCode: string; name: string },
  context: z.RefinementCtx,
) {
  const expected = REGISTRY[card.cardCode]?.name;
  if (expected && card.name !== expected) {
    context.addIssue({ code: "custom", message: "card name must match the packaged card registry" });
  }
}

export const SideboardLabCardSchema = z.object(CARD_FIELDS).strict()
  .superRefine(requireCanonicalCardName);

export const SideboardLabDeckCardSchema = z.object({
  ...CARD_FIELDS,
  count: z.number().int().min(1).max(3),
}).strict().superRefine(requireCanonicalCardName);

export const SideboardLabDeckSchema = z.object({
  fingerprint: z.string().regex(SHA256),
  mainDeck: z.array(SideboardLabDeckCardSchema).min(14).max(40),
  sideboard: z.array(SideboardLabDeckCardSchema).min(1).max(40),
}).strict().superRefine((deck, context) => {
  if (deck.mainDeck.reduce((sum, card) => sum + card.count, 0) !== 40) {
    context.addIssue({ code: "custom", message: "mainDeck must contain exactly 40 shuffled cards" });
  }
  for (const section of [deck.mainDeck, deck.sideboard]) {
    if (new Set(section.map((card) => card.cardCode)).size !== section.length) {
      context.addIssue({ code: "custom", message: "deck section card codes must be unique" });
    }
  }
  const combined = new Map<string, number>();
  for (const card of [...deck.mainDeck, ...deck.sideboard]) {
    const identityCode = REGISTRY[card.cardCode]?.basePrintId ?? card.cardCode;
    combined.set(identityCode, (combined.get(identityCode) ?? 0) + card.count);
  }
  if ([...combined.values()].some((count) => count > 3)) {
    context.addIssue({ code: "custom", message: "combined deck copies cannot exceed three per card identity" });
  }
});

export const SideboardLabObservationSchema = z.object({
  provider: z.literal("atlas"),
  matchKey: z.string().regex(/^sm1_[a-f0-9]{32}$/),
  targetGameNumber: z.literal(2),
  eventKey: z.string().regex(/^se1_[a-f0-9]{32}$/),
  observedOn: z.iso.date(),
  priorGameWon: z.boolean(),
}).strict();

export const SideboardLabSwapCardSchema = z.object({
  ...CARD_FIELDS,
  count: z.number().int().min(1).max(3),
}).strict().superRefine(requireCanonicalCardName);

export const SideboardLabCardEvidenceSchema = SideboardLabCardSchema.extend({
  identityCode: z.string().refine((code) => REGISTRY[code]?.basePrintId === code, {
    message: "identityCode must be a packaged base-print card code",
  }),
  direction: z.enum(["in", "out"]),
  scope: z.enum(["matchup", "player-legend"]),
  scopeDecisions: z.number().int().positive(),
  scopePlayers: z.number().int().positive(),
  opportunities: z.number().int().positive(),
  players: z.number().int().positive(),
  selected: z.number().int().nonnegative(),
  selectedPlayers: z.number().int().nonnegative(),
  selectedCopies: z.number().int().nonnegative(),
  selectedWins: z.number().int().nonnegative(),
  notSelectedWins: z.number().int().nonnegative(),
  selectionRate: RATE,
  baselineSelectionRate: RATE,
  guidancePlayers: z.number().int().positive(),
  guidanceSelected: z.number().int().nonnegative(),
  guidanceSelectionRate: RATE,
  selectedWinRate: RATE.nullable(),
  notSelectedWinRate: RATE.nullable(),
  winRateDelta: z.number().min(-1).max(1).nullable(),
  guidance: z.enum(["strong_select", "select", "mixed", "avoid", "strong_avoid", "unclear"]),
  evidenceStatus: z.enum(["robust", "developing", "limited"]),
  outcomeStatus: z.enum(["comparable", "one_sided", "sparse"]),
}).strict().superRefine((evidence, context) => {
  const notSelected = evidence.opportunities - evidence.selected;
  if (
    evidence.selected > evidence.opportunities ||
    evidence.players > evidence.opportunities ||
    evidence.selectedPlayers > evidence.selected ||
    evidence.selectedPlayers > evidence.players ||
    evidence.selectedWins > evidence.selected ||
    evidence.notSelectedWins > notSelected ||
    evidence.opportunities > evidence.scopeDecisions ||
    evidence.players > evidence.scopePlayers
  ) {
    context.addIssue({ code: "custom", message: "sideboard evidence counts exceed their denominator" });
  }
  if ((evidence.selected === 0) !== (evidence.selectedWinRate === null)) {
    context.addIssue({ code: "custom", message: "selectedWinRate must be null exactly when no decisions selected the card" });
  }
  if ((notSelected === 0) !== (evidence.notSelectedWinRate === null)) {
    context.addIssue({ code: "custom", message: "notSelectedWinRate must be null exactly when every decision selected the card" });
  }
  if ((evidence.selected === 0 || notSelected === 0) !== (evidence.winRateDelta === null)) {
    context.addIssue({ code: "custom", message: "winRateDelta requires both decision branches" });
  }
  if (
    evidence.guidanceSelected > evidence.guidancePlayers ||
    Math.abs(evidence.guidanceSelectionRate - evidence.guidanceSelected / evidence.guidancePlayers) > Number.EPSILON ||
    Math.abs(evidence.selectionRate - evidence.selected / evidence.opportunities) > Number.EPSILON ||
    (evidence.selected > 0 && Math.abs((evidence.selectedWinRate ?? -1) - evidence.selectedWins / evidence.selected) > Number.EPSILON) ||
    (notSelected > 0 && Math.abs((evidence.notSelectedWinRate ?? -1) - evidence.notSelectedWins / notSelected) > Number.EPSILON) ||
    (evidence.winRateDelta !== null && Math.abs(
      evidence.winRateDelta - ((evidence.selectedWinRate ?? 0) - (evidence.notSelectedWinRate ?? 0))
    ) > Number.EPSILON)
  ) {
    context.addIssue({ code: "custom", message: "published sideboard rates must equal their raw counts" });
  }
});

const SideboardLabLegendSchema = SideboardLabCardSchema;

export const SideboardLabDrillSchema = z.object({
  id: z.string().regex(/^sl1_[a-f0-9]{32}$/),
  matchup: z.object({
    playerLegend: SideboardLabLegendSchema,
    opponentLegend: SideboardLabLegendSchema,
  }).strict(),
  priorGameResult: z.enum(["win", "loss"]),
  deck: SideboardLabDeckSchema,
  evidence: z.object({
    status: z.enum(["sufficient", "early"]),
    scope: z.literal("matchup"),
    deckScope: z.literal("all-observed-decks"),
    guidanceBasis: z.literal("community-selection-rate"),
    outcomeInterpretation: z.literal("descriptive-not-causal"),
    playerLegendIdentityCode: z.string().refine((code) => REGISTRY[code]?.basePrintId === code, {
      message: "player legend identity must be a packaged base-print code",
    }),
    opponentLegendIdentityCode: z.string().refine((code) => REGISTRY[code]?.basePrintId === code, {
      message: "opponent legend identity must be a packaged base-print code",
    }),
    decisions: z.number().int().positive(),
    players: z.number().int().positive(),
  }).strict(),
  cardEvidence: z.array(SideboardLabCardEvidenceSchema).min(1).max(80),
}).strict().superRefine((drill, context) => {
  const expected = new Set([
    ...drill.deck.mainDeck.map((card) => `out:${card.cardCode}`),
    ...drill.deck.sideboard.map((card) => `in:${card.cardCode}`),
  ]);
  const actual = new Set(drill.cardEvidence.map((entry) => `${entry.direction}:${entry.cardCode}`));
  if ([...expected].some((key) => !actual.has(key)) || actual.size !== expected.size) {
    context.addIssue({ code: "custom", message: "every available deck card must have directional evidence" });
  }
});

const SideboardLabSourceSchema = z.object({
  kind: z.literal("precomputed-observed-replays"),
  corpus: z.literal("anonymized-canonical-web-replays"),
  minimumDecisions: z.number().int().positive(),
  minimumPlayers: z.number().int().positive(),
  observedFrom: z.iso.date().nullable(),
  observedThrough: z.iso.date().nullable(),
  includedFacts: z.number().int().nonnegative(),
  coverageTruncated: z.boolean(),
  coveragePolicy: z.literal("all-available-history"),
  includedPeriods: z.array(z.enum(["preseason", "current-season"])).max(2),
  backfillComplete: z.boolean(),
  seasonCoverage: z.object({
    currentSeasonStartedOn: z.literal("2026-07-31"),
    preseasonFacts: z.number().int().nonnegative(),
    currentSeasonFacts: z.number().int().nonnegative(),
  }).strict(),
}).strict().superRefine((source, context) => {
  if (source.seasonCoverage.preseasonFacts + source.seasonCoverage.currentSeasonFacts !== source.includedFacts) {
    context.addIssue({ code: "custom", message: "season fact counts must sum to includedFacts" });
  }
  const expected = [
    ...(source.seasonCoverage.preseasonFacts > 0 ? ["preseason" as const] : []),
    ...(source.seasonCoverage.currentSeasonFacts > 0 ? ["current-season" as const] : []),
  ];
  if (expected.length !== source.includedPeriods.length || expected.some((period, index) => period !== source.includedPeriods[index])) {
    context.addIssue({ code: "custom", message: "includedPeriods must match non-empty season counts" });
  }
});

export const SideboardLabReadyResponseSchema = z.object({
  schema: z.literal("riftlite-sideboard-lab"),
  version: z.literal(1),
  status: z.literal("ready"),
  generatedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  source: SideboardLabSourceSchema,
  drills: z.array(SideboardLabDrillSchema).min(1).max(48),
}).strict();

export const SideboardLabUnavailableResponseSchema = z.object({
  schema: z.literal("riftlite-sideboard-lab"),
  version: z.literal(1),
  status: z.literal("unavailable"),
  generatedAt: z.null(),
  expiresAt: z.null(),
  source: SideboardLabSourceSchema,
  drills: z.tuple([]),
  reason: z.enum(["snapshot_not_configured", "snapshot_invalid", "snapshot_expired", "data_unavailable"]),
}).strict();

export const SideboardLabResponseSchema = z.union([
  SideboardLabReadyResponseSchema,
  SideboardLabUnavailableResponseSchema,
]);

export type SideboardLabCard = z.infer<typeof SideboardLabCardSchema>;
export type SideboardLabDeckCard = z.infer<typeof SideboardLabDeckCardSchema>;
export type SideboardLabDeck = z.infer<typeof SideboardLabDeckSchema>;
export type SideboardLabObservation = z.infer<typeof SideboardLabObservationSchema>;
export type SideboardLabSwapCard = z.infer<typeof SideboardLabSwapCardSchema>;
export type SideboardLabCardEvidence = z.infer<typeof SideboardLabCardEvidenceSchema>;
export type SideboardLabDrill = z.infer<typeof SideboardLabDrillSchema>;
export type SideboardLabReadyResponse = z.infer<typeof SideboardLabReadyResponseSchema>;
export type SideboardLabUnavailableReason = z.infer<typeof SideboardLabUnavailableResponseSchema>["reason"];
export type SideboardLabResponse = z.infer<typeof SideboardLabResponseSchema>;

export const DEFAULT_SIDEBOARD_LAB_MINIMUM_DECISIONS = 25;
export const DEFAULT_SIDEBOARD_LAB_MINIMUM_PLAYERS = 10;

export function unavailableSideboardLabResponse(
  reason: SideboardLabUnavailableReason,
): SideboardLabResponse {
  return {
    schema: "riftlite-sideboard-lab",
    version: 1,
    status: "unavailable",
    generatedAt: null,
    expiresAt: null,
    source: {
      kind: "precomputed-observed-replays",
      corpus: "anonymized-canonical-web-replays",
      minimumDecisions: DEFAULT_SIDEBOARD_LAB_MINIMUM_DECISIONS,
      minimumPlayers: DEFAULT_SIDEBOARD_LAB_MINIMUM_PLAYERS,
      observedFrom: null,
      observedThrough: null,
      includedFacts: 0,
      coverageTruncated: false,
      coveragePolicy: "all-available-history",
      includedPeriods: [],
      backfillComplete: false,
      seasonCoverage: {
        currentSeasonStartedOn: "2026-07-31",
        preseasonFacts: 0,
        currentSeasonFacts: 0,
      },
    },
    drills: [],
    reason,
  };
}
