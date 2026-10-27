import { isRecord } from "../json";
import type { JsonObject } from "../types";
import { ATLAS_POSTGAME_LIMITS, AtlasPostgameError, type AtlasMulliganDraw, type AtlasMulliganPlayback, type AtlasPostgameSource, type AtlasPostgameView } from "./types";

export const ATLAS_CARD_ZONES = ["deck", "hand", "base", "trash", "discard", "banished", "battlefieldA", "battlefieldB", "battlefieldToken", "champion", "legend", "runeDeck", "runeArea", "sideboard", "removed"] as const;
const REQUIRED_ZONES = ["deck", "hand", "base", "trash", "battlefieldA", "battlefieldB", "champion", "legend", "runeDeck", "runeArea"];
const fail = (message: string): never => { throw new AtlasPostgameError(message); };
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;
const time = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);

/** Optional evidence is deliberately small. Invalid metadata never disables the ordinary replay. */
export function sanitizeAtlasMulliganPlayback(value: unknown, participantIds: string[]): Record<string, AtlasMulliganPlayback> | null {
  if (!isRecord(value) || participantIds.length !== 2 || new Set(participantIds).size !== 2
    || !sameIds(Object.keys(value), participantIds)) return null;
  const result: Record<string, AtlasMulliganPlayback> = Object.create(null);
  for (const playerId of participantIds) {
    if (!text(playerId) || ["__proto__", "prototype", "constructor"].includes(playerId)) return null;
    const entry = value[playerId];
    if (!isRecord(entry) || !integer(entry.redrawCount) || entry.redrawCount > 4 || !Array.isArray(entry.draws) || entry.draws.length > 5) return null;
    const draws: AtlasMulliganDraw[] = [];
    for (const draw of entry.draws) {
      if (!isRecord(draw) || !text(draw.id) || /[\s\u0000-\u001f\u007f]/.test(draw.id)
        || !text(draw.cardId) || /[\s\u0000-\u001f\u007f]/.test(draw.cardId) || !integer(draw.handCountBeforeDraw)
        || draw.handCountBeforeDraw > 4 || (draw.kind !== "refill" && draw.kind !== "opening")) return null;
      draws.push({ id: draw.id, cardId: draw.cardId, handCountBeforeDraw: draw.handCountBeforeDraw, kind: draw.kind });
    }
    result[playerId] = { redrawCount: entry.redrawCount, draws };
  }
  return result;
}

/** Imported files are user-supplied evidence, not authenticated Atlas or dual-player consent. */
export function validateAtlasPostgameView(value: JsonObject): AtlasPostgameSource {
  if (!text(value.replayId) || !text(value.viewerPlayerId) || !Array.isArray(value.players) || value.players.length !== 2) return fail("Only completed two-player Atlas games can be attached.");
  const ids = value.players.map((player) => isRecord(player) && text(player.id) ? player.id : "");
  if (new Set(ids).size !== 2 || ids.includes("") || !ids.includes(value.viewerPlayerId)) return fail("Invalid Atlas replay participants.");
  if (value.canSwitchPerspective !== true || value.canFork !== true || value.forkBlockedReason != null || (value.privateDeckPlayerIds != null && (!Array.isArray(value.privateDeckPlayerIds) || value.privateDeckPlayerIds.length > 0))) return fail("This Atlas export restricts hidden cards. It cannot enable All cards.");
  if (!time(value.createdAt) || !time(value.completedAt) || value.completedAt < value.createdAt) return fail("The Atlas replay is not a completed game.");
  if (!Array.isArray(value.frames) || value.frames.length < 2 || value.frames.length > ATLAS_POSTGAME_LIMITS.maxFrames) return fail("The Atlas replay has an unsupported number of frames.");
  let previousSequence = -1, previousElapsed = -1, roomCode = "", roomCreatedAt = 0, historyStartedAt = 0, gameNumber = 0;
  let archivedBo3Game = value.completedAt <= Date.now() + 60_000, seriesStartedAt = 0;
  const boardsChecked = new WeakSet<object>();
  const cardsChecked = new WeakSet<object>();
  for (const [index, frame] of value.frames.entries()) {
    if (!isRecord(frame) || frame.index !== index || !integer(frame.sequence) || frame.sequence < previousSequence || typeof frame.elapsedMs !== "number" || !Number.isFinite(frame.elapsedMs) || frame.elapsedMs < previousElapsed || frame.elapsedMs < 0 || !text(frame.actionType) || !isRecord(frame.state)) return fail("The Atlas replay timeline is malformed.");
    if (frame.elapsedMs > value.completedAt - value.createdAt + 1000) return fail("The Atlas replay timestamps do not match its completion.");
    previousSequence = frame.sequence; previousElapsed = frame.elapsedMs;
    const state = frame.state;
    if (state.rewindProtocolVersion !== 5 || state.gameVariant !== "duel" || !text(state.roomCode) || !time(state.createdAt) || !time(state.gameHistoryStartedAt) || !Array.isArray(state.players) || state.players.length !== 2 || !["bo1", "bo3"].includes(state.matchFormat as string) || ![undefined, "multiplayer"].includes(state.roomMode as string | undefined) || state.testMode !== false || state.teamIdByPlayerId != null) return fail("This Atlas game mode or replay protocol is not supported.");
    // Atlas calls normal online rooms 'multiplayer'; actual four-player/team rooms are rejected above.
    if (!["sideboarding", "battlefield_pick", "initiative_roll", "first_player_choice", "mulligan", "in_game"].includes(state.phase as string)) return fail("The Atlas replay contains an unsupported game phase.");
    if (state.matchFormat === "bo3" && state.gameNumber === undefined) return fail("This BO3 export does not identify its game number. Attach an export with an explicit game number.");
    const number = state.gameNumber ?? 1;
    if (!integer(number) || number < 1 || number > 3 || (state.matchFormat === "bo1" && number !== 1)) return fail("Invalid Atlas game number.");
    if (!index) { roomCode = state.roomCode; roomCreatedAt = state.createdAt; historyStartedAt = state.gameHistoryStartedAt; gameNumber = number; }
    if (state.roomCode !== roomCode || state.createdAt !== roomCreatedAt || state.gameHistoryStartedAt !== historyStartedAt || number !== gameNumber) return fail("Attach one Atlas game at a time.");
    if (state.gameHistoryStartedAt !== value.createdAt) return fail("The Atlas replay game timestamps do not match.");
    if (!index && time(state.seriesStartedAt)) seriesStartedAt = state.seriesStartedAt;
    // Atlas archives earlier BO3 games when the next room is created. Those
    // completed exports retain no terminal room fields and their final captured
    // action precedes the envelope's completedAt. Keep that exact native shape;
    // never manufacture a winner, terminal frame or end timestamp.
    archivedBo3Game &&= state.matchFormat === "bo3" && number < 3
      && time(state.seriesStartedAt) && state.seriesStartedAt === seriesStartedAt && state.seriesStartedAt <= historyStartedAt
      && state.gameOutcome === undefined && state.gameHistoryEndedAt === undefined;
    if (!sameIds(ids, state.players.map(player => isRecord(player) && text(player.id) ? player.id : ""))) return fail("The Atlas replay participants changed during the game.");
    for (const player of state.players) {
      if (!isRecord(player) || !isRecord(player.board)) return fail("Invalid Atlas player board.");
      const board = player.board;
      if (boardsChecked.has(board)) continue;
      boardsChecked.add(board);
      if (typeof board.score !== "number" || !Number.isFinite(board.score) || REQUIRED_ZONES.some(zone => !Array.isArray(board[zone]))) return fail("The Atlas replay is missing board information.");
      if ((Array.isArray(board.battlefieldC) && board.battlefieldC.length) || (Array.isArray(board.additionalLegends) && board.additionalLegends.length)) return fail("Only two-player Atlas games are supported.");
      const cardIds = new Set<string>();
      for (const zone of ATLAS_CARD_ZONES) {
        const cards = board[zone];
        if (cards === undefined) continue;
        if (!Array.isArray(cards) || cards.length > 500) return fail("Invalid Atlas card zone.");
        for (const card of cards) {
          if (!isRecord(card) || !text(card.id) || cardIds.has(card.id)) return fail("Invalid or duplicate Atlas card instance.");
          cardIds.add(card.id);
          if (cardsChecked.has(card)) continue;
          cardsChecked.add(card);
          if (!text(card.name) || card.isPlaceholder === true || card.id.startsWith("__hidden_zone__:") || (card.ownerPlayerId !== undefined && !ids.includes(card.ownerPlayerId as string))) return fail("This Atlas export contains hidden placeholders. It cannot enable All cards.");
          if (card.cardCode !== undefined && !text(card.cardCode)) return fail("Invalid Atlas card identity.");
        }
      }
    }
  }
  const finalFrame = value.frames[value.frames.length - 1] as JsonObject;
  const finalState = finalFrame.state as JsonObject;
  const outcome = finalState.gameOutcome;
  if (!archivedBo3Game && (!isRecord(outcome) || !["score", "concession"].includes(outcome.reason as string) || !Array.isArray(outcome.winnerPlayerIds) || outcome.winnerPlayerIds.length !== 1 || !ids.includes(outcome.winnerPlayerIds[0] as string))) return fail("Finish the Atlas game before importing its replay.");
  if (!archivedBo3Game && Math.abs(previousElapsed - (value.completedAt - value.createdAt)) > 1000) return fail("The Atlas replay is missing its completed ending.");
  const view = value as AtlasPostgameView;
  return { view, metadata: { replayId: view.replayId, roomCode, participantIds: ids, viewerPlayerId: view.viewerPlayerId, createdAt: view.createdAt, completedAt: view.completedAt, gameNumber, frameCount: view.frames.length } };
}
