import { z } from "zod";

const CARD_CODE = /^[A-Z]{3}-\d{3}(?:[A-Z]|\*)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RATE = z.number().min(0).max(1);

export const MulliganLabCardSchema = z.object({
  cardCode: z.string().regex(CARD_CODE),
  name: z.string().trim().min(1).max(120),
}).strict();

export const MulliganLabDeckCardSchema = MulliganLabCardSchema.extend({
  count: z.number().int().min(1).max(3),
}).strict();

export const MulliganLabDeckSchema = z.object({
  fingerprint: z.string().regex(SHA256),
  mainDeck: z.array(MulliganLabDeckCardSchema).min(14).max(40),
}).strict().superRefine((deck, context) => {
  const total = deck.mainDeck.reduce((sum, card) => sum + card.count, 0);
  if (total !== 40) {
    context.addIssue({ code: "custom", message: "mainDeck must contain exactly 40 cards" });
  }
  if (new Set(deck.mainDeck.map((card) => card.cardCode)).size !== deck.mainDeck.length) {
    context.addIssue({ code: "custom", message: "mainDeck card codes must be unique" });
  }
});

export const MulliganLabObservationSchema = z.object({
  provider: z.enum(["atlas", "tcga"]),
  matchKey: z.string().regex(/^mm1_[a-f0-9]{32}$/),
  gameNumber: z.literal(1),
  eventKey: z.string().regex(/^me1_[a-f0-9]{32}$/),
  observedOn: z.iso.date(),
}).strict();

/**
 * Descriptive community evidence for one base card identity. `offered`,
 * `kept`, and `redrawn` count observed game-hand opportunities; player fields count
 * distinct anonymous contributors. Outcome rates are correlations, not an
 * estimate of the causal effect of keeping a card.
 */
export const MulliganLabCardEvidenceSchema = MulliganLabCardSchema.extend({
  identityCode: z.string().regex(CARD_CODE),
  scope: z.enum(["matchup", "player-legend"]),
  scopeHands: z.number().int().positive(),
  scopePlayers: z.number().int().positive(),
  offered: z.number().int().positive(),
  players: z.number().int().positive(),
  kept: z.number().int().nonnegative(),
  keptPlayers: z.number().int().nonnegative(),
  redrawn: z.number().int().nonnegative(),
  redrawnPlayers: z.number().int().nonnegative(),
  keptWins: z.number().int().nonnegative(),
  redrawnWins: z.number().int().nonnegative(),
  keepRate: RATE,
  baselineKeepRate: RATE,
  guidancePlayers: z.number().int().positive(),
  guidanceKept: z.number().int().nonnegative(),
  guidanceKeepRate: RATE,
  keptWinRate: RATE.nullable(),
  redrawnWinRate: RATE.nullable(),
  winRateDelta: z.number().min(-1).max(1).nullable(),
  guidance: z.enum(["strong_keep", "keep", "mixed", "redraw", "strong_redraw", "unclear"]),
  evidenceStatus: z.enum(["robust", "developing", "limited"]),
  outcomeStatus: z.enum(["comparable", "one_sided", "sparse"]),
}).strict().superRefine((evidence, context) => {
  if (evidence.kept + evidence.redrawn !== evidence.offered) {
    context.addIssue({ code: "custom", message: "kept plus redrawn must equal offered" });
  }
  if (evidence.keptWins > evidence.kept || evidence.redrawnWins > evidence.redrawn) {
    context.addIssue({ code: "custom", message: "wins cannot exceed their decision count" });
  }
  if (
    evidence.players > evidence.offered ||
    evidence.keptPlayers > evidence.kept ||
    evidence.redrawnPlayers > evidence.redrawn ||
    evidence.keptPlayers > evidence.players ||
    evidence.redrawnPlayers > evidence.players
  ) {
    context.addIssue({ code: "custom", message: "player counts cannot exceed their observation count" });
  }
  if ((evidence.kept === 0) !== (evidence.keptWinRate === null)) {
    context.addIssue({ code: "custom", message: "keptWinRate must be null exactly when there are no keeps" });
  }
  if ((evidence.redrawn === 0) !== (evidence.redrawnWinRate === null)) {
    context.addIssue({ code: "custom", message: "redrawnWinRate must be null exactly when there are no redraws" });
  }
  if ((evidence.kept === 0 || evidence.redrawn === 0) !== (evidence.winRateDelta === null)) {
    context.addIssue({ code: "custom", message: "winRateDelta requires both decision groups" });
  }
  if (evidence.offered > evidence.scopeHands || evidence.players > evidence.scopePlayers) {
    context.addIssue({ code: "custom", message: "card evidence cannot exceed its selected scope" });
  }
  if (
    evidence.guidancePlayers > evidence.players ||
    evidence.guidanceKept > evidence.guidancePlayers ||
    Math.abs(evidence.guidanceKeepRate - evidence.guidanceKept / evidence.guidancePlayers) > Number.EPSILON
  ) {
    context.addIssue({ code: "custom", message: "guidance rate must be one vote per contributing player" });
  }
  if (
    Math.abs(evidence.keepRate - evidence.kept / evidence.offered) > Number.EPSILON ||
    (evidence.kept > 0 && Math.abs((evidence.keptWinRate ?? -1) - evidence.keptWins / evidence.kept) > Number.EPSILON) ||
    (evidence.redrawn > 0 && Math.abs((evidence.redrawnWinRate ?? -1) - evidence.redrawnWins / evidence.redrawn) > Number.EPSILON) ||
    (evidence.winRateDelta !== null && Math.abs(
      evidence.winRateDelta - ((evidence.keptWinRate ?? 0) - (evidence.redrawnWinRate ?? 0)),
    ) > Number.EPSILON)
  ) {
    context.addIssue({ code: "custom", message: "published rates must equal their raw counts" });
  }
});

const MulliganLabLegendSchema = MulliganLabCardSchema;

export const MulliganLabDrillSchema = z.object({
  id: z.string().regex(/^ml2_[a-f0-9]{32}$/),
  matchup: z.object({
    playerLegend: MulliganLabLegendSchema,
    opponentLegend: MulliganLabLegendSchema,
  }).strict(),
  // Initiative describes the sampled real hand, but the main recommendation
  // pools both initiatives across the oriented legend matchup.
  initiative: z.enum(["first", "second"]),
  hand: z.array(MulliganLabCardSchema).length(4),
  deck: MulliganLabDeckSchema,
  evidence: z.object({
    status: z.enum(["sufficient", "early"]),
    scope: z.literal("matchup"),
    deckScope: z.literal("all-observed-decks"),
    guidanceBasis: z.literal("community-keep-rate"),
    outcomeInterpretation: z.literal("descriptive-not-causal"),
    playerLegendIdentityCode: z.string().regex(CARD_CODE),
    opponentLegendIdentityCode: z.string().regex(CARD_CODE),
    hands: z.number().int().positive(),
    players: z.number().int().positive(),
  }).strict(),
  cardEvidence: z.array(MulliganLabCardEvidenceSchema).min(1).max(4),
}).strict().superRefine((drill, context) => {
  const evidenceCodes = new Set(drill.cardEvidence.map((entry) => entry.cardCode));
  const handCodes = new Set(drill.hand.map((entry) => entry.cardCode));
  if ([...handCodes].some((code) => !evidenceCodes.has(code))) {
    context.addIssue({ code: "custom", message: "every hand card must have published evidence" });
  }

  const deckCounts = new Map(drill.deck.mainDeck.map((entry) => [entry.cardCode, entry.count]));
  const handCounts = new Map<string, number>();
  for (const card of drill.hand) handCounts.set(card.cardCode, (handCounts.get(card.cardCode) ?? 0) + 1);
  if ([...handCounts].some(([code, count]) => count > (deckCounts.get(code) ?? 0))) {
    context.addIssue({ code: "custom", message: "observed hand must be legal in its bound deck" });
  }
});

const MulliganLabSourceSchema = z.object({
  kind: z.literal("precomputed-observed-replays"),
  corpus: z.literal("anonymized-canonical-web-replays"),
  minimumHands: z.number().int().positive(),
  minimumPlayers: z.number().int().positive(),
  observedFrom: z.iso.date().nullable(),
  observedThrough: z.iso.date().nullable(),
  includedFacts: z.number().int().nonnegative(),
  coverageTruncated: z.boolean(),
}).strict();

const LegacyMulliganLabSourceSchema = MulliganLabSourceSchema.omit({
  observedFrom: true,
  observedThrough: true,
  includedFacts: true,
  coverageTruncated: true,
});

export const MulliganLabReadyResponseSchema = z.object({
  schema: z.literal("riftlite-mulligan-lab"),
  version: z.literal(2),
  status: z.literal("ready"),
  generatedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  source: MulliganLabSourceSchema,
  drills: z.array(MulliganLabDrillSchema).min(1).max(64),
}).strict();

export const MulliganLabUnavailableResponseSchema = z.object({
  schema: z.literal("riftlite-mulligan-lab"),
  version: z.literal(2),
  status: z.literal("unavailable"),
  generatedAt: z.null(),
  expiresAt: z.null(),
  source: MulliganLabSourceSchema,
  drills: z.tuple([]),
  reason: z.enum([
    "snapshot_not_configured",
    "snapshot_invalid",
    "snapshot_expired",
    "data_unavailable",
  ]),
}).strict();

const LegacyCardEvidenceSchema = MulliganLabCardSchema.extend({
  offered: z.number().int().positive(),
  kept: z.number().int().nonnegative(),
  redrawn: z.number().int().nonnegative(),
  keptWins: z.number().int().nonnegative(),
  redrawnWins: z.number().int().nonnegative(),
}).strict();

// Retain v1 reads during a rolling website/client deployment. New refreshes
// always publish v2 and no v1-specific fields influence v2 guidance.
const LegacyReadyResponseSchema = z.object({
  schema: z.literal("riftlite-mulligan-lab"),
  version: z.literal(1),
  status: z.literal("ready"),
  generatedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  source: LegacyMulliganLabSourceSchema,
  drills: z.array(z.object({
    id: z.string().regex(/^ml1_[a-f0-9]{32}$/),
    observedHandId: z.string().regex(/^mh1_[a-f0-9]{32}$/),
    observation: MulliganLabObservationSchema,
    matchup: z.object({
      playerLegend: MulliganLabLegendSchema,
      opponentLegend: MulliganLabLegendSchema,
    }).strict(),
    initiative: z.enum(["first", "second"]),
    hand: z.array(MulliganLabCardSchema).length(4),
    observedDecision: z.object({
      redrawnCardIndexes: z.array(z.number().int().min(0).max(3)).max(2),
      wonGame: z.boolean(),
    }).strict(),
    deck: MulliganLabDeckSchema,
    evidence: z.object({
      status: z.enum(["sufficient", "early"]),
      scope: z.literal("matchup-initiative"),
      hands: z.number().int().positive(),
      players: z.number().int().positive(),
    }).strict(),
    cardEvidence: z.array(LegacyCardEvidenceSchema).min(1).max(4),
  }).strict()).min(1).max(64),
}).strict();

const LegacyUnavailableResponseSchema = MulliganLabUnavailableResponseSchema.extend({
  version: z.literal(1),
  source: LegacyMulliganLabSourceSchema,
}).strict();

export const MulliganLabResponseSchema = z.union([
  MulliganLabReadyResponseSchema,
  MulliganLabUnavailableResponseSchema,
  LegacyReadyResponseSchema,
  LegacyUnavailableResponseSchema,
]);

export type MulliganLabCard = z.infer<typeof MulliganLabCardSchema>;
export type MulliganLabDeck = z.infer<typeof MulliganLabDeckSchema>;
export type MulliganLabObservation = z.infer<typeof MulliganLabObservationSchema>;
export type MulliganLabCardEvidence = z.infer<typeof MulliganLabCardEvidenceSchema>;
export type MulliganLabDrill = z.infer<typeof MulliganLabDrillSchema>;
export type MulliganLabReadyResponse = z.infer<typeof MulliganLabReadyResponseSchema>;
export type MulliganLabUnavailableReason = z.infer<typeof MulliganLabUnavailableResponseSchema>["reason"];
export type MulliganLabResponse = z.infer<typeof MulliganLabResponseSchema>;

export const DEFAULT_MULLIGAN_LAB_MINIMUM_HANDS = 25;
export const DEFAULT_MULLIGAN_LAB_MINIMUM_PLAYERS = 10;

export function unavailableMulliganLabResponse(
  reason: MulliganLabUnavailableReason,
): MulliganLabResponse {
  return {
    schema: "riftlite-mulligan-lab",
    version: 2,
    status: "unavailable",
    generatedAt: null,
    expiresAt: null,
    source: {
      kind: "precomputed-observed-replays",
      corpus: "anonymized-canonical-web-replays",
      minimumHands: DEFAULT_MULLIGAN_LAB_MINIMUM_HANDS,
      minimumPlayers: DEFAULT_MULLIGAN_LAB_MINIMUM_PLAYERS,
      observedFrom: null,
      observedThrough: null,
      includedFacts: 0,
      coverageTruncated: false,
    },
    drills: [],
    reason,
  };
}
