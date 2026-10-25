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
  /** Absent on legacy imports whose stored false was the old default. */
  sharingPreferenceVersion?: 1;
  encodedBytes: number;
  canonicalSha256: string;
  artifact: ReplayArtifactPointer;
};

/**
 * All existing imports now share with the original replay's permitted viewers.
 * Legacy records cannot distinguish the former default false from an owner
 * choice. Versioned preferences preserve every choice made under this policy.
 */
export function atlasPostgameGameIsShared(game: Pick<StoredAtlasPostgameGame, "shared" | "sharingPreferenceVersion">): boolean {
  return game.sharingPreferenceVersion === undefined || (game.sharingPreferenceVersion === 1 && game.shared);
}

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
