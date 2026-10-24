import type { ReplayArtifactPointer } from "./model";

export type AtlasPostgameGameMetadata = {
  gameId: string;
  gameNumber: number;
  frameCount: number;
  firstElapsedMs: number;
  lastElapsedMs: number;
  matchedEventCount: number;
  firstMatchedEventIndex: number;
  lastMatchedEventIndex: number;
  sha256: string;
  importedAt: string;
  shared: boolean;
};

export type StoredAtlasPostgameGame = AtlasPostgameGameMetadata & {
  encodedBytes: number;
  canonicalSha256: string;
  artifact: ReplayArtifactPointer;
};

export type AtlasPostgameManifest = {
  schema: "riftlite-atlas-postgame-attachments";
  version: 1;
  games: StoredAtlasPostgameGame[];
};

export type AtlasPostgameMetadataResponse = {
  accountId: string;
  canManage: boolean;
  available: boolean;
  shared: boolean;
  games: AtlasPostgameGameMetadata[];
};

/** Only attachment pointers are returned; existing raw/canonical artifacts are independent. */
export function atlasPostgameArtifactPointers(value: unknown): ReplayArtifactPointer[] {
  if (!value || typeof value !== "object") return [];
  const games = (value as { games?: unknown }).games;
  if (!Array.isArray(games) || games.length > 3) return [];
  return games.flatMap((game) => {
    const artifact = game && typeof game === "object" ? game.artifact : null;
    return artifact && typeof artifact === "object" && artifact.kind === "raw"
      ? [artifact as ReplayArtifactPointer] : [];
  });
}
