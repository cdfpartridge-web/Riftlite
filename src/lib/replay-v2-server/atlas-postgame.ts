import "server-only";

import { gzipSync, gunzipSync } from "node:zlib";
import type { Firestore } from "firebase-admin/firestore";
import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { identityUidsFor } from "@/lib/social/server";
import {
  decodeAtlasPostgameReplay, encodeAtlasPostgameReplay, matchAtlasPostgameReplay,
} from "@/lib/replay-v2/atlas-postgame";
import type { CanonicalReplayV2 } from "@/lib/replay-v2/types";
import { AtlasPostgameError, ATLAS_POSTGAME_MISMATCH_REASONS } from "@/lib/replay-v2/atlas-postgame/types";
import {
  deleteImmutableArtifact, readImmutableArtifact, storeImmutableArtifact,
} from "./artifacts";
import { MAX_CANONICAL_JSON_BYTES, REPLAY_COLLECTION } from "./constants";
import { ReplayV2Error } from "./errors";
import { createArtifactGeneration, sha256Hex } from "./ids";
import type { ReplayRecord } from "./model";
import { readReadableReplayMetadata } from "./service";
import type {
  AtlasPostgameGameMetadata, AtlasPostgameManifest, AtlasPostgameMetadataResponse, StoredAtlasPostgameGame,
} from "./atlas-postgame-model";

export const MAX_ATLAS_POSTGAME_REQUEST_BYTES = 4 * 1024 * 1024;
// Leave response-envelope space below the serverless response-body limit.
export const MAX_ATLAS_POSTGAME_TOTAL_BYTES = 3_900_000;
const SHA256 = /^[a-f0-9]{64}$/;
const SCHEMA = "riftlite-atlas-postgame-attachments";

export type AtlasPostgameReadResponse = AtlasPostgameMetadataResponse & {
  exports?: Array<{ gameId: string; replay: unknown }>;
};

function db(): Firestore {
  const value = getFirestoreAdmin();
  if (!value) throw new ReplayV2Error(503, "firebase_unavailable", "Replay storage is unavailable.");
  return value;
}
function boundedInteger(value: unknown, minimum = 0, maximum = 1_000_000): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}
function boundedTime(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= 86_400_000;
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f]/.test(value);
}
function manifest(value: unknown): AtlasPostgameManifest {
  if (value === undefined) return { schema: SCHEMA, version: 1, games: [] };
  const input = value as AtlasPostgameManifest;
  if (!input || input.schema !== SCHEMA || input.version !== 1 || !Array.isArray(input.games) || input.games.length > 3 ||
      input.games.some(game => !game || !text(game.gameId) || !boundedInteger(game.gameNumber, 1, 3) ||
        !boundedInteger(game.frameCount, 1, 100_000) || !boundedTime(game.firstElapsedMs) ||
        !boundedTime(game.lastElapsedMs, game.firstElapsedMs) ||
        !boundedInteger(game.matchedEventCount, 1) || !boundedInteger(game.firstMatchedEventIndex) ||
        !boundedInteger(game.lastMatchedEventIndex, game.firstMatchedEventIndex) ||
        !SHA256.test(game.sha256) || !SHA256.test(game.canonicalSha256) ||
        !boundedInteger(game.encodedBytes, 1, MAX_ATLAS_POSTGAME_TOTAL_BYTES) ||
        typeof game.shared !== "boolean" || typeof game.importedAt !== "string" || !Number.isFinite(Date.parse(game.importedAt)) ||
        !game.artifact || game.artifact.kind !== "raw") ||
      new Set(input.games.map(game => game.gameId)).size !== input.games.length ||
      new Set(input.games.map(game => game.gameNumber)).size !== input.games.length) {
    throw new ReplayV2Error(500, "postgame_metadata_invalid", "The saved Atlas attachment is unavailable.");
  }
  return input;
}
async function ownerUids(accountId: string, database: Firestore): Promise<Set<string>> {
  return accountId ? new Set([accountId, ...await identityUidsFor(accountId, database)]) : new Set();
}
function assertOwner(record: ReplayRecord, owners: Set<string>): void {
  if (!owners.has(record.ownerUid)) throw new ReplayV2Error(403, "postgame_owner_required", "Only the replay owner can change its Atlas import.");
}
function assertReady(record: ReplayRecord): void {
  if (record.platform !== "atlas" || record.status !== "ready" || !record.canonicalArtifact) {
    throw new ReplayV2Error(409, "postgame_replay_not_ready", "Import into a completed Atlas Web Replay.");
  }
}
function recordFromSnapshot(snapshot: { exists: boolean; data(): unknown }): ReplayRecord {
  const record = snapshot.data() as ReplayRecord | undefined;
  if (!snapshot.exists || !record) throw new ReplayV2Error(404, "replay_not_found", "Replay not found.");
  return record;
}
function gameMetadata(game: StoredAtlasPostgameGame): AtlasPostgameGameMetadata {
  return {
    gameId: game.gameId, gameNumber: game.gameNumber, frameCount: game.frameCount,
    firstElapsedMs: game.firstElapsedMs, lastElapsedMs: game.lastElapsedMs,
    matchedEventCount: game.matchedEventCount, firstMatchedEventIndex: game.firstMatchedEventIndex,
    lastMatchedEventIndex: game.lastMatchedEventIndex, sha256: game.sha256,
    importedAt: game.importedAt, shared: game.shared,
  };
}
function metadata(record: ReplayRecord, accountId: string, canManage: boolean): AtlasPostgameMetadataResponse {
  const games = manifest(record.atlasPostgame).games
    .filter(game => game.canonicalSha256 === record.canonicalArtifact?.sha256 && (canManage || game.shared))
    .sort((a, b) => a.gameNumber - b.gameNumber).map(gameMetadata);
  return { accountId: accountId || "public", canManage, available: games.length > 0,
    shared: games.length > 0 && games.every(game => game.shared), games };
}
function parseCanonical(bytes: Buffer): CanonicalReplayV2 {
  try {
    const value = JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_CANONICAL_JSON_BYTES }).toString("utf8"));
    if (!value || value.schema !== "riftlite-canonical-replay" || value.version !== 2) throw new Error();
    return value as CanonicalReplayV2;
  } catch {
    throw new ReplayV2Error(422, "postgame_canonical_invalid", "The original replay could not be checked.");
  }
}
function assertExpectedAccount(accountId: string, expectedAccountId: unknown): void {
  if (typeof expectedAccountId !== "string" || !expectedAccountId || expectedAccountId.length > 128 || /[\u0000-\u001f\u007f/]/.test(expectedAccountId)) {
    throw new ReplayV2Error(400, "postgame_account_invalid", "Reload the replay before changing its Atlas import.");
  }
  if (accountId !== expectedAccountId) throw new ReplayV2Error(409, "postgame_account_changed", "Your RiftLite account changed. Reload the replay before changing its Atlas import.");
}
function validatePut(input: unknown): { replay: unknown; expectedAccountId: unknown; expectedSha256?: string | null } {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !["replay", "expectedAccountId", "expectedSha256"].includes(key)) || !("replay" in input)) {
    throw new ReplayV2Error(400, "postgame_input_invalid", "Choose an Atlas replay export.");
  }
  const value = input as { replay: unknown; expectedAccountId: unknown; expectedSha256?: string | null };
  if (value.expectedSha256 !== undefined && value.expectedSha256 !== null && !SHA256.test(value.expectedSha256)) {
    throw new ReplayV2Error(400, "postgame_input_invalid", "The previous import version is invalid.");
  }
  return value;
}

export async function readAtlasPostgame(
  accountId: string, replayId: string, options: { metadataOnly?: boolean; gameId?: string } = {},
): Promise<AtlasPostgameReadResponse> {
  // Always check current original-replay access, including revoked hub access.
  const record = await readReadableReplayMetadata(replayId, accountId);
  const database = db();
  const owners = await ownerUids(accountId, database);
  const canManage = owners.has(record.ownerUid);
  const response = metadata(record, accountId, canManage);
  if (options.metadataOnly) return response;
  const visible = manifest(record.atlasPostgame).games.filter(game =>
    response.games.some(item => item.gameId === game.gameId) && (!options.gameId || options.gameId === game.gameId));
  const exports: Array<{ gameId: string; replay: unknown }> = [];
  let total = 0;
  for (const game of visible) {
    const compressed = await readImmutableArtifact(database, game.artifact);
    let bytes: Buffer;
    try { bytes = gunzipSync(compressed, { maxOutputLength: MAX_ATLAS_POSTGAME_TOTAL_BYTES }); }
    catch { throw new ReplayV2Error(500, "postgame_artifact_invalid", "The Atlas import could not be loaded."); }
    total += bytes.length;
    if (bytes.length !== game.encodedBytes || sha256Hex(bytes) !== game.sha256 || total > MAX_ATLAS_POSTGAME_TOTAL_BYTES) {
      throw new ReplayV2Error(500, "postgame_artifact_invalid", "The Atlas import could not be verified.");
    }
    try {
      const replay = JSON.parse(bytes.toString("utf8"));
      if (!replay || replay.format !== "riftatlas-replay" || replay.version !== 2) throw new Error();
      exports.push({ gameId: game.gameId, replay });
    } catch { throw new ReplayV2Error(500, "postgame_artifact_invalid", "The Atlas import could not be loaded."); }
  }
  // Storage reads can take time. Recheck the current access and sharing choice
  // before returning any hidden information, including an import replacement.
  if (exports.length) {
    const current = await readReadableReplayMetadata(replayId, accountId);
    const latest = metadata(current, accountId, owners.has(current.ownerUid));
    return { ...latest, exports: exports.filter(item => latest.games.some(game =>
      game.gameId === item.gameId && visible.some(before => before.gameId === game.gameId && before.sha256 === game.sha256))) };
  }
  // Do not leak private attachment existence, identifiers or file sizes.
  return { ...response, exports };
}

export async function saveAtlasPostgame(accountId: string, replayId: string, input: unknown): Promise<AtlasPostgameMetadataResponse> {
  const value = validatePut(input);
  assertExpectedAccount(accountId, value.expectedAccountId);
  const record = await readReadableReplayMetadata(replayId, accountId);
  const database = db(), owners = await ownerUids(accountId, database);
  assertOwner(record, owners); assertReady(record);
  const canonicalSha256 = record.canonicalArtifact!.sha256;
  const canonical = parseCanonical(await readImmutableArtifact(database, record.canonicalArtifact!));
  let source: ReturnType<typeof decodeAtlasPostgameReplay>;
  try { source = decodeAtlasPostgameReplay(value.replay); }
  catch { throw new ReplayV2Error(422, "postgame_export_invalid", "This must be a supported completed Atlas duel export with available card information."); }
  let alignment: ReturnType<typeof matchAtlasPostgameReplay>;
  try { alignment = matchAtlasPostgameReplay(canonical, source); }
  catch (error) {
    const counts: Record<string, number> = {};
    if (error instanceof AtlasPostgameError) {
      for (const key of ATLAS_POSTGAME_MISMATCH_REASONS) {
        const value = error.matchDiagnostics?.[key];
        if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) counts[key] = Math.min(value, 1_000_000);
      }
    }
    if (!Object.keys(counts).length) counts.unclassified = 1;
    console.warn("[atlas-postgame-match-diagnostic]", counts);
    throw new ReplayV2Error(409, "postgame_match_mismatch", "This Atlas export does not match the original replay. Choose the same game.");
  }
  // Re-encode the validated allowlisted source. Never persist the original
  // envelope, unused DAG nodes, credentials or an expanded per-frame JSON graph.
  const encoded = Buffer.from(JSON.stringify(encodeAtlasPostgameReplay(source)), "utf8");
  if (!encoded.length || encoded.length > MAX_ATLAS_POSTGAME_TOTAL_BYTES) {
    throw new ReplayV2Error(413, "postgame_too_large", "This Atlas import is too large.");
  }
  const sha256 = sha256Hex(encoded);
  const existing = manifest(record.atlasPostgame).games.find(game => game.gameId === alignment.gameId);
  if (value.expectedSha256 !== undefined && value.expectedSha256 !== (existing?.sha256 ?? null)) {
    throw new ReplayV2Error(409, "postgame_import_changed", "The Atlas import changed on another device. Reload before replacing it.");
  }
  if (existing?.sha256 === sha256 && existing.canonicalSha256 === canonicalSha256) return metadata(record, accountId, true);
  const artifact = await storeImmutableArtifact(database, {
    replayId, kind: "raw", generation: createArtifactGeneration("raw"), bytes: gzipSync(encoded),
  });
  let replaced: StoredAtlasPostgameGame | undefined, saved: ReplayRecord;
  try {
    saved = await database.runTransaction(async transaction => {
      const ref = database.collection(REPLAY_COLLECTION).doc(replayId);
      const current = recordFromSnapshot(await transaction.get(ref));
      assertOwner(current, owners); assertReady(current);
      if (current.canonicalArtifact!.sha256 !== canonicalSha256) {
        throw new ReplayV2Error(409, "postgame_original_changed", "The original replay changed. Reload before importing.");
      }
      const before = manifest(current.atlasPostgame);
      const previous = before.games.find(game => game.gameId === alignment.gameId);
      if (value.expectedSha256 !== undefined && value.expectedSha256 !== (previous?.sha256 ?? null)) {
        throw new ReplayV2Error(409, "postgame_import_changed", "The Atlas import changed on another device. Reload before replacing it.");
      }
      const game: StoredAtlasPostgameGame = {
        gameId: alignment.gameId, gameNumber: alignment.gameNumber, frameCount: alignment.frameCount,
        firstElapsedMs: alignment.firstElapsedMs, lastElapsedMs: alignment.lastElapsedMs,
        matchedEventCount: alignment.matchedEventCount, firstMatchedEventIndex: alignment.firstMatchedEventIndex,
        lastMatchedEventIndex: alignment.lastMatchedEventIndex,
        sha256, encodedBytes: encoded.length, canonicalSha256, importedAt: new Date().toISOString(), shared: false, artifact,
      };
      const games = [...before.games.filter(item => item.gameId !== game.gameId), game].sort((a, b) => a.gameNumber - b.gameNumber);
      if (games.length > 3 || new Set(games.map(item => item.gameNumber)).size !== games.length ||
          games.reduce((sum, item) => sum + item.encodedBytes, 0) > MAX_ATLAS_POSTGAME_TOTAL_BYTES) {
        throw new ReplayV2Error(413, "postgame_too_large", "The saved Atlas imports exceed this replay's size limit.");
      }
      const atlasPostgame: AtlasPostgameManifest = { schema: SCHEMA, version: 1, games };
      // Deliberately update no canonical/raw pointer, replay visibility, notes,
      // match data, discovery index or original timeline.
      transaction.update(ref, { atlasPostgame });
      replaced = previous;
      return { ...current, atlasPostgame };
    });
  } catch (error) {
    await deleteImmutableArtifact(database, artifact).catch(() => undefined);
    throw error;
  }
  if (replaced) await deleteImmutableArtifact(database, replaced.artifact).catch(() => undefined);
  return metadata(saved, accountId, true);
}

export async function shareAtlasPostgame(accountId: string, replayId: string, input: unknown): Promise<AtlasPostgameMetadataResponse> {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !["shared", "gameId", "expectedAccountId", "expectedSha256"].includes(key))) {
    throw new ReplayV2Error(400, "postgame_sharing_invalid", "Choose whether to share the Atlas import.");
  }
  const value = input as { shared?: unknown; gameId?: unknown; expectedAccountId?: unknown; expectedSha256?: unknown };
  assertExpectedAccount(accountId, value.expectedAccountId);
  if (typeof value.shared !== "boolean" || (value.gameId !== undefined && !text(value.gameId)) ||
      (value.shared && value.gameId === undefined) ||
      (value.gameId !== undefined && (typeof value.expectedSha256 !== "string" || !SHA256.test(value.expectedSha256)))) {
    throw new ReplayV2Error(400, "postgame_sharing_invalid", "Choose whether to share the Atlas import.");
  }
  const database = db(), owners = await ownerUids(accountId, database);
  const saved = await database.runTransaction(async transaction => {
    const ref = database.collection(REPLAY_COLLECTION).doc(replayId);
    const current = recordFromSnapshot(await transaction.get(ref));
    assertOwner(current, owners); assertReady(current);
    const before = manifest(current.atlasPostgame);
    const eligible = before.games.filter(game => game.canonicalSha256 === current.canonicalArtifact!.sha256 &&
      (value.gameId === undefined || value.gameId === game.gameId));
    if (!eligible.length) throw new ReplayV2Error(404, "postgame_import_missing", "Import that Atlas game first.");
    if (value.gameId !== undefined && eligible[0].sha256 !== value.expectedSha256) {
      throw new ReplayV2Error(409, "postgame_import_changed", "The Atlas import changed on another device. Reload before sharing it.");
    }
    const atlasPostgame: AtlasPostgameManifest = { ...before, games: before.games.map(game =>
      eligible.some(item => item.gameId === game.gameId) ? { ...game, shared: value.shared as boolean } : game) };
    transaction.update(ref, { atlasPostgame });
    return { ...current, atlasPostgame };
  });
  return metadata(saved, accountId, true);
}
