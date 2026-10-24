import type { JsonObject, JsonValue, ReplayState } from "../types";

export const ATLAS_POSTGAME_LIMITS = Object.freeze({
  maxInputBytes: 16 * 1024 * 1024,
  maxNodes: 100_000,
  maxEntries: 1_000_000,
  maxDepth: 48,
  maxFrames: 10_000,
  maxExpandedBytes: 512 * 1024 * 1024,
});

export class AtlasPostgameError extends Error {
  constructor(message: string) { super(message); this.name = "AtlasPostgameError"; }
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
export type AtlasJson = JsonValue;
