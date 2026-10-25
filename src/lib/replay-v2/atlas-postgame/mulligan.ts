import { isRecord } from "../json";
import { projectReplayState } from "../project-state";
import type { CanonicalReplayV2, JsonObject, ReplayCardState } from "../types";
import { projectAtlasPostgameState } from "./matching";
import { sanitizeAtlasMulliganPlayback } from "./validation";
import type { AtlasMulliganSummary, AtlasPostgameAlignment, AtlasPostgameSource } from "./types";

function summaryCard(card: JsonObject, playerId: string): ReplayCardState {
  return { id: card.id as string, name: card.name as string, ownerPlayerId: playerId,
    ...(typeof card.cardCode === "string" ? { cardCode: card.cardCode } : {}),
    isPlaceholder: false, fields: structuredClone(card) };
}

/** Exact post-mulligan evidence, never a reconstruction of the unknown returned cards. */
export function buildAtlasMulliganSummary(source: AtlasPostgameSource, alignment: AtlasPostgameAlignment, canonical: CanonicalReplayV2): AtlasMulliganSummary | null {
  const frame = source.view.frames[0], game = canonical.series.games.find(item => item.id === alignment.gameId);
  if (!frame || frame.index !== 0 || frame.elapsedMs !== 0 || frame.actionType !== "game_start" || frame.state.phase !== "in_game"
    || frame.state.gameHistoryStartedAt !== source.metadata.createdAt || source.view.createdAt !== source.metadata.createdAt
    || !game || game.gameNumber !== source.metadata.gameNumber || game.gameNumber !== alignment.gameNumber
    || (frame.state.gameNumber ?? 1) !== game.gameNumber || alignment.firstElapsedMs !== 0
    || canonical.source.schema !== "riftreplay-raw-capture" || source.view.canSwitchPerspective !== true || source.view.canFork !== true
    || source.view.forkBlockedReason != null || (source.view.privateDeckPlayerIds != null && (!Array.isArray(source.view.privateDeckPlayerIds) || source.view.privateDeckPlayerIds.length))) return null;
  const sanitizedRoom = canonical.series.roomCode === "" && canonical.source.roomCode === "" && canonical.source.captureSessionId === "";
  if (!sanitizedRoom && canonical.series.roomCode !== source.metadata.roomCode) return null;
  const playback = sanitizeAtlasMulliganPlayback(frame.state.mulliganPlaybackByPlayerId, source.metadata.participantIds);
  if (!playback) return null;

  const anchor = canonical.events.find(event => event.gameId === game.id && event.index >= game.eventStartIndex && event.index <= game.eventEndIndex
    && alignment.frameByEventIndex[event.index] === 0
    && (event.kind === "snapshot" ? event.sequence === frame.sequence : event.kind === "action" && event.patch.sequence === frame.sequence));
  if (!anchor || !canonical.events.some(event => event.gameId === game.id && event.index >= game.eventStartIndex && event.index < anchor.index
    && (event.kind === "phase" ? event.phase === "mulligan" : event.kind === "snapshot" && event.snapshot.room.rawPhase === "mulligan"))) return null;
  const captured = projectReplayState(canonical, anchor.index);
  if (!projectAtlasPostgameState(captured, source, alignment).available) return null;

  const players: AtlasMulliganSummary["players"] = Object.create(null);
  for (const player of frame.state.players) {
    const evidence = playback[player.id], hand = player.board.hand;
    if (!evidence || !Array.isArray(hand)) return null;
    const refills = evidence.draws.filter(draw => draw.kind === "refill"), openings = evidence.draws.filter(draw => draw.kind === "opening");
    const keptCount = 4 - evidence.redrawCount;
    if (refills.length !== evidence.redrawCount || openings.length > 1 || hand.length !== 4 + openings.length
      || new Set(evidence.draws.map(draw => draw.cardId)).size !== evidence.draws.length
      || new Set(evidence.draws.map(draw => draw.id)).size !== evidence.draws.length) return null;
    if (hand.some(card => !isRecord(card) || typeof card.id !== "string" || !card.id || typeof card.name !== "string" || !card.name
      || card.isPlaceholder === true || card.id.startsWith("__hidden_zone__:") || (card.ownerPlayerId !== undefined && card.ownerPlayerId !== player.id))
      || new Set(hand.map(card => (card as JsonObject).id)).size !== hand.length) return null;
    const cards = hand as JsonObject[];
    for (const [index, draw] of evidence.draws.entries()) {
      if (draw.kind === "refill") {
        if (index >= refills.length || draw.handCountBeforeDraw !== keptCount + index || cards[keptCount + index]?.id !== draw.cardId) return null;
      } else {
        // Atlas's opening-draw animation reports 3 in current exports, although
        // the card is the fifth final-hand card. It is never part of the mulligan.
        if (index !== evidence.draws.length - 1 || player.id !== frame.state.firstPlayerId
          || ![3, 4].includes(draw.handCountBeforeDraw) || cards[4]?.id !== draw.cardId) return null;
      }
    }
    const drawIds = new Set(evidence.draws.map(draw => draw.cardId));
    const kept = cards.filter(card => !drawIds.has(card.id as string));
    if (kept.length !== keptCount) return null;
    players[player.id] = { kept: kept.map(card => summaryCard(card, player.id)),
      replacements: refills.map(draw => summaryCard(cards.find(card => card.id === draw.cardId)!, player.id)), returnedCount: evidence.redrawCount };
  }
  return { gameId: game.id, players };
}
