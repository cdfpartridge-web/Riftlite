import type { JsonObject, JsonValue, ReplayCardState, ReplayState } from "../types";

export const ATLAS_POSTGAME_LIMITS = Object.freeze({
  maxInputBytes: 16 * 1024 * 1024,
  maxNodes: 100_000,
  maxEntries: 1_000_000,
  maxDepth: 48,
  maxFrames: 10_000,
  maxExpandedBytes: 512 * 1024 * 1024,
});

export const ATLAS_POSTGAME_MISMATCH_REASONS = ["metadata", "game_identity_or_time", "room_or_turn", "room_timestamp", "player", "score", "resource", "zone_count", "hidden_slot_id", "card_id", "card_identity", "status", "chain", "public_anchor_count", "sequence_overlap", "insufficient_matching_positions", "unclassified"] as const;
export type AtlasPostgameMismatchReason = typeof ATLAS_POSTGAME_MISMATCH_REASONS[number];
export type AtlasPostgameMatchDiagnostics = Partial<Record<AtlasPostgameMismatchReason, number>>;
export class AtlasPostgameError extends Error {
  constructor(message: string, public readonly matchDiagnostics?: AtlasPostgameMatchDiagnostics) { super(message); this.name = "AtlasPostgameError"; }
}

export type AtlasPostgamePlayer = JsonObject & { id: string; name: string; board: JsonObject };
export type AtlasPostgameFrame = JsonObject & {
  index: number; sequence: number; elapsedMs: number; actionType: string;
  state: JsonObject & { roomCode: string; players: AtlasPostgamePlayer[] };
};
export type AtlasPostgameView = JsonObject & {
  replayId: string; viewerPlayerId: string; players: (JsonObject & { id: string })[];
  canSwitchPerspective: true; createdAt: number; completedAt: number;
  frames: AtlasPostgameFrame[];
};
export type AtlasPostgameMetadata = {
  replayId: string; roomCode: string; participantIds: string[]; viewerPlayerId: string;
  createdAt: number; completedAt: number; gameNumber: number; frameCount: number;
};
export type AtlasPostgameSource = { view: AtlasPostgameView; metadata: AtlasPostgameMetadata };
type EncodedValue = string | number | boolean | null | { r: number };
export type AtlasPostgameEnvelopeV2 = {
  format: "riftatlas-replay"; version: 2;
  nodes: (["a", EncodedValue[]] | ["o", [string, EncodedValue][]])[];
  root: { r: number };
};
export type AtlasPostgameAlignment = {
  gameId: string; gameNumber: number; frameCount: number;
  firstElapsedMs: number; lastElapsedMs: number;
  matchedEventCount: number; firstMatchedEventIndex: number; lastMatchedEventIndex: number;
  frameByEventIndex: Record<number, number>;
};
export type AtlasPostgameProjection = {
  state: ReplayState; available: boolean; frameIndex?: number; reason?: string;
};
export type AtlasMulliganDraw = JsonObject & {
  id: string; cardId: string; handCountBeforeDraw: number; kind: "refill" | "opening";
};
export type AtlasMulliganPlayback = JsonObject & { redrawCount: number; draws: AtlasMulliganDraw[] };
export type AtlasMulliganSummary = {
  gameId: string;
  players: Record<string, { kept: ReplayCardState[]; replacements: ReplayCardState[]; returnedCount: number }>;
};
export type AtlasJson = JsonValue;
