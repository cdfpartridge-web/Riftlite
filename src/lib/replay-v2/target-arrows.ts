import { isRecord, stringValue } from "@/lib/replay-v2/json";
import { stableId } from "@/lib/replay-v2/stable-id";
import type { ReplayState, ReplayTargetArrow } from "@/lib/replay-v2/types";

const BOARD_ZONES = ["base", "battlefieldA", "battlefieldB", "battlefieldC", "battlefieldToken", "champion", "legend"];
const BATTLEFIELD_PREFIX = "battlefield-marker:";
const BASE_PREFIX = "base-area-marker:";

/**
 * Read captured room state, never infer arrows from intents or future events.
 * Atlas persists arrows until an authoritative clear/removal, not a timer.
 * Anchors must exist in the currently projected public board or chain.
 */
export function getReplayTargetArrows(state: ReplayState): ReplayTargetArrow[] {
  if (!["in_game", "game_end", "series_end"].includes(state.phase)) return [];
  const byPlayer = state.room.fields.targetArrowsByPlayer;
  if (!isRecord(byPlayer)) return [];

  const boardIds = new Set<string>();
  const players = Object.values(state.players);
  const battlefieldZones = new Set(["battlefieldA", "battlefieldB"]);
  if (players.length > 2 || players.some(player => "battlefieldC" in player.zones)) battlefieldZones.add("battlefieldC");
  const sharedToken = state.room.fields.sharedBattlefieldToken;
  if (isRecord(sharedToken) && sharedToken.active === true && sharedToken.zone === "battlefieldToken") {
    battlefieldZones.add("battlefieldToken");
  }
  for (const player of players) {
    boardIds.add(`${BASE_PREFIX}${player.id}`);
    for (const zone of BOARD_ZONES) {
      if (zone.startsWith("battlefield") && !battlefieldZones.has(zone)) continue;
      for (const card of player.zones[zone] ?? []) {
        if (card.isPlaceholder || !publicCard(card.fields)) continue;
        boardIds.add(card.id);
      }
    }
  }
  for (const zone of battlefieldZones) boardIds.add(`${BATTLEFIELD_PREFIX}${zone}`);
  const chainIds = new Set(state.chain.flatMap(entry => {
    const card = entry.fields.card;
    return isRecord(card) && publicCard(card) && stringValue(card.id) ? [stringValue(card.id)] : [];
  }));
  const endpointExists = (id: string, anchor: "board" | "chain") => (
    (anchor === "board" ? boardIds : chainIds).has(id)
  );
  const arrows: ReplayTargetArrow[] = [];
  for (const player of players) {
    const entries = byPlayer[player.id];
    if (!Array.isArray(entries)) continue;
    const seen = new Set<string>();
    // Atlas retains the newest 20 arrows per player.
    for (const entry of entries.slice(-20)) {
      if (!isRecord(entry)) continue;
      const sourceCardId = stringValue(entry.sourceCardId);
      const targetCardId = stringValue(entry.targetCardId);
      const sourceAnchor = entry.sourceAnchor;
      const targetAnchor = entry.targetAnchor;
      if ((sourceAnchor !== "board" && sourceAnchor !== "chain") ||
        (targetAnchor !== "board" && targetAnchor !== "chain") ||
        (sourceCardId === targetCardId && sourceAnchor === targetAnchor) ||
        !endpointExists(sourceCardId, sourceAnchor) || !endpointExists(targetCardId, targetAnchor)) continue;
      const id = stableId("target-arrow", player.id, sourceAnchor, sourceCardId, targetAnchor, targetCardId);
      if (seen.has(id)) continue;
      seen.add(id);
      arrows.push({ id, actorPlayerId: player.id, sourceCardId, targetCardId, sourceAnchor, targetAnchor });
    }
  }
  return arrows;
}

function publicCard(fields: Record<string, unknown>): boolean {
  return fields.isPlaceholder !== true &&
    !(fields.hidden === true && fields.revealedToOpponent !== true) &&
    fields.analysisKnowledge !== "future_reveal";
}
