import { isRecord } from "../json";
import { createInitialReplayState, reduceReplayEvent } from "../project-state";
import type { CanonicalReplayV2, JsonObject, ReplayCardState, ReplayEvent, ReplayState } from "../types";
import { AtlasPostgameError, type AtlasPostgameAlignment, type AtlasPostgameFrame, type AtlasPostgameProjection, type AtlasPostgameSource, type AtlasPostgameMismatchReason, type AtlasPostgameMatchDiagnostics } from "./types";
import { ATLAS_CARD_ZONES } from "./validation";

const STATUS_FIELDS = ["exhausted", "hidden", "attachedToCardId", "banishedByCardId", "temporaryMightBuff", "whiteCounter", "redCounter", "customLabels"];
const IDENTITY_FIELDS = ["name", "cardCode", "type", "domains", "text", "energyCost", "powerCost", "might", "keywords", "subtypes", "rarity", "set"];
const HIDDEN_ZONES = new Set(["deck", "hand", "runeDeck", "sideboard"]);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);

function isMaskedSlot(card: ReplayCardState, playerId: string, zone: string, index: number): boolean {
  return HIDDEN_ZONES.has(zone) && card.isPlaceholder === true && card.fields.isPlaceholder === true
    && card.name === "" && !card.cardCode && !card.fields.name && !card.fields.cardCode
    && card.id === `__hidden_zone__:${playerId}:${zone}:${index}`
    && (card.fields.id === undefined || card.fields.id === card.id)
    && (card.ownerPlayerId === undefined || card.ownerPlayerId === playerId)
    && (card.fields.ownerPlayerId === undefined || card.fields.ownerPlayerId === playerId);
}

/** Exact sequence plus the captured board is the anchor; elapsed time alone is never an alignment. */
function positionMismatch(state: ReplayState, frame: AtlasPostgameFrame): AtlasPostgameMismatchReason | null {
  const raw = frame.state;
  if (state.room.rawPhase !== raw.phase || state.room.turnNumber !== raw.turnNumber || state.room.activeTurnPlayerId !== raw.activeTurnPlayerId || state.room.gameNumber !== (raw.gameNumber ?? 1)) return "room_or_turn";
  // Public canonical artifacts deliberately omit room codes. The captured
  // game's exact history start remains mandatory for every matching position.
  if (state.room.fields.gameHistoryStartedAt !== raw.gameHistoryStartedAt) return "room_timestamp";
  for (const key of ["createdAt", "gameHistoryStartedAt", "gameHistoryEndedAt"]) {
    if (state.room.fields[key] !== undefined && raw[key] !== state.room.fields[key]) return "room_timestamp";
  }
  if (!sameIds(Object.keys(state.players), raw.players.map(player => player.id))) return "player";
  let anchoredCards = 0;
  for (const player of raw.players) {
    const captured = state.players[player.id];
    if (!captured) return "player";
    if (captured.score !== player.board.score) return "score";
    for (const field of ["floatingEnergy", "floatingPower", "legendXp"]) {
      if (captured.boardFields[field] !== undefined && !equal(captured.boardFields[field], player.board[field])) return "resource";
    }
    for (const zone of ATLAS_CARD_ZONES) {
      const cards = (player.board[zone] ?? []) as JsonObject[];
      const existing = captured.zones[zone] ?? [];
      if (existing.length !== cards.length) return "zone_count";
      for (let index = 0; index < cards.length; index++) {
        const a = existing[index], b = cards[index];
        if (isMaskedSlot(a, player.id, zone, index)) {
          // Atlas masks live private zones by owner/zone/slot. The exact game,
          // authoritative sequence and public board anchor this one position;
          // a masked slot is never itself evidence of a matching card identity.
          continue;
        }
        if (a.id !== b.id) return a.id.startsWith("__hidden_zone__:") ? "hidden_slot_id" : "card_id";
        if (!HIDDEN_ZONES.has(zone)) anchoredCards++;
        if (a.name && a.name !== b.name || a.cardCode && a.cardCode !== b.cardCode) return "card_identity";
        for (const field of STATUS_FIELDS) {
          if (a.fields[field] !== undefined && !equal(a.fields[field], b[field])) return "status";
        }
      }
    }
  }
  const chain = raw.chainEntries;
  if (!Array.isArray(chain) || chain.length !== state.chain.length) return "chain";
  for (let index = 0; index < chain.length; index++) {
    const entry = chain[index], existing = state.chain[index];
    if (!isRecord(entry) || existing.id !== entry.id || !isRecord(entry.card) || !isRecord(existing.fields.card) || existing.fields.card.id !== entry.card.id) return "chain";
  }
  return anchoredCards >= 2 ? null : "public_anchor_count";
}
function samePosition(state: ReplayState, frame: AtlasPostgameFrame): boolean { return positionMismatch(state, frame) === null; }

function preservesMatchedPosition(event: ReplayEvent, matchedSourceMessageId: string | undefined): boolean {
  if (["log", "chat", "interaction", "phase", "game_boundary"].includes(event.kind)) return true;
  if (event.kind !== "unknown") return false;
  // This Atlas message only updates the confirmation prompt; the eventual
  // rewind changes the board through a separate authoritative commit/snapshot.
  if (event.reason === "unsupported_packet" && event.packetType === "rewind_confirmation_state") return true;
  // Atlas handles pong solely as a heartbeat acknowledgement, before any board
  // reducers. Other unrecognized packet types still invalidate the held frame.
  if (event.reason === "unsupported_packet" && event.packetType === "pong") return true;
  // The normalizer appends diagnostics after the action at the same timestamp.
  // Its post-operation board has already matched this exact Atlas frame. Never
  // carry across a diagnostic from a different or unverified source message.
  return event.reason === "unknown_patch_operation" && event.packetType === "authoritative_patch_commit"
    && matchedSourceMessageId !== undefined && event.sourceMessageId === matchedSourceMessageId;
}

export function matchAtlasPostgameReplay(canonical: CanonicalReplayV2, source: AtlasPostgameSource): AtlasPostgameAlignment {
  const sanitizedRoomIdentity = canonical.series.roomCode === "" && canonical.source.roomCode === "" && canonical.source.captureSessionId === "";
  if (canonical.source.schema !== "riftreplay-raw-capture" || (!sanitizedRoomIdentity && canonical.series.roomCode !== source.metadata.roomCode) || !sameIds(canonical.series.participants.map(player => player.id), source.metadata.participantIds)) throw new AtlasPostgameError("This Atlas file belongs to a different replay.", { metadata: 1 });
  if (canonical.series.format !== "unknown" && canonical.series.format !== source.view.frames[0].state.matchFormat) throw new AtlasPostgameError("The Atlas export and captured replay have different match formats.", { metadata: 1 });
  const candidates = canonical.series.games.filter(game => game.gameNumber === source.metadata.gameNumber && game.startedAt <= source.metadata.completedAt + 15_000 && game.endedAt >= source.metadata.createdAt - 15_000);
  if (candidates.length !== 1) throw new AtlasPostgameError("The Atlas file could not be matched to one game in this replay.", { game_identity_or_time: 1 });
  const game = candidates[0];
  const bySequence = new Map<number, AtlasPostgameFrame[]>();
  for (const frame of source.view.frames) bySequence.set(frame.sequence, [...(bySequence.get(frame.sequence) ?? []), frame]);
  const frameByEventIndex: Record<number, number> = {};
  const matchedFrames = new Set<number>();
  const diagnostics: AtlasPostgameMatchDiagnostics = {};
  const count = (reason: AtlasPostgameMismatchReason) => { diagnostics[reason] = Math.min(1_000_000, (diagnostics[reason] ?? 0) + 1); };
  let state = createInitialReplayState(canonical), lastMatched: AtlasPostgameFrame | undefined;
  let matchedSourceMessageId: string | undefined;
  for (const event of canonical.events) {
    if (event.index > game.eventEndIndex) break;
    // Logs/chat never change board identity. Avoid repeatedly cloning growing log histories during matching.
    if (!["log", "chat", "interaction", "unknown"].includes(event.kind)) {
      state = reduceReplayEvent(state, event); state.log = []; state.chat = [];
    } else state = { ...state, appliedEventIndex: event.index };
    if (state.gameId !== game.id || event.index < game.eventStartIndex) { lastMatched = undefined; matchedSourceMessageId = undefined; continue; }
    const sequence = event.kind === "snapshot" ? event.sequence : event.kind === "action" ? event.patch.sequence : undefined;
    if (sequence !== undefined) {
      const candidates = bySequence.get(sequence) ?? [];
      if (!candidates.length) count("sequence_overlap");
      const frames = candidates.filter(frame => {
        const mismatch = positionMismatch(state, frame);
        if (mismatch) count(mismatch);
        return mismatch === null;
      });
      lastMatched = frames.length === 1 ? frames[0] : undefined;
      matchedSourceMessageId = lastMatched ? event.sourceMessageId : undefined;
      if (lastMatched) matchedFrames.add(lastMatched.index);
    } else if (!preservesMatchedPosition(event, matchedSourceMessageId)) lastMatched = undefined;
    if (lastMatched && samePosition(state, lastMatched)) frameByEventIndex[event.index] = lastMatched.index;
    else { lastMatched = undefined; matchedSourceMessageId = undefined; }
  }
  if (matchedFrames.size < 2) {
    count("insufficient_matching_positions");
    throw new AtlasPostgameError("This file does not have enough matching captured positions. Your original replay has been kept.", diagnostics);
  }
  const indices = Object.keys(frameByEventIndex).map(Number).sort((a, b) => a - b);
  return {
    gameId: game.id, gameNumber: game.gameNumber, frameCount: source.view.frames.length,
    firstElapsedMs: source.view.frames[0].elapsedMs,
    lastElapsedMs: source.view.frames[source.view.frames.length - 1].elapsedMs,
    matchedEventCount: indices.length,
    firstMatchedEventIndex: indices[0], lastMatchedEventIndex: indices[indices.length - 1], frameByEventIndex,
  };
}

function enrichCard(original: ReplayCardState, source: JsonObject): ReplayCardState {
  const fields = { ...original.fields };
  for (const key of IDENTITY_FIELDS) if (source[key] !== undefined) fields[key] = source[key];
  // isPlaceholder is a renderer identity marker. Original hidden/revealed flags remain unchanged.
  fields.isPlaceholder = false;
  return { ...original, name: source.name as string, ...(typeof source.cardCode === "string" ? { cardCode: source.cardCode } : {}), isPlaceholder: false, fields };
}

export function projectAtlasPostgameState(state: ReplayState, source: AtlasPostgameSource, alignment: AtlasPostgameAlignment): AtlasPostgameProjection {
  const frameIndex = alignment.frameByEventIndex[state.appliedEventIndex];
  const frame = frameIndex === undefined ? undefined : source.view.frames[frameIndex];
  if (state.gameId !== alignment.gameId || !frame || !samePosition(state, frame)) return { state, available: false, reason: "All cards is unavailable at this captured position. The original replay is shown." };
  const players = { ...state.players };
  for (const player of frame.state.players) {
    const original = players[player.id];
    const zones = { ...original.zones };
    for (const zone of ATLAS_CARD_ZONES) {
      const cards = player.board[zone] as JsonObject[] | undefined;
      if (cards?.length) zones[zone] = zones[zone].map((card, index) => enrichCard(card, cards[index]));
    }
    players[player.id] = { ...original, zones };
  }
  return { state: { ...state, players }, available: true, frameIndex };
}
