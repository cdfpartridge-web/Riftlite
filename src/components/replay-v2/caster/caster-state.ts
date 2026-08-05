import {
  cloneReplayState,
  type CanonicalReplayV2,
  type ReplayCardState,
  type ReplayState,
} from "@/lib/replay-v2";

import { resolveReplayPlayers } from "../model";

type CollaborativeReplayMetadata = {
  informationPolicy?: unknown;
  mode?: unknown;
  schema?: unknown;
};

function isOpenInformationReplay(replay: CanonicalReplayV2): boolean {
  const collaboration = (
    replay as unknown as { collaboration?: CollaborativeReplayMetadata }
  ).collaboration;
  return collaboration?.informationPolicy === "consented_full_information" && (
    collaboration.mode === "dual-perspective" ||
    collaboration.schema === "riftlite-dual-perspective"
  );
}

function isHandZone(zone: string): boolean {
  return zone.toLowerCase().replace(/[^a-z0-9]+/g, "").includes("hand");
}

function maskedHandCard(card: ReplayCardState, playerId: string, zone: string): ReplayCardState {
  const ownerPlayerId = card.ownerPlayerId || playerId;
  const source = card.source || zone;
  return {
    id: card.id,
    name: "",
    ownerPlayerId,
    source,
    exhausted: false,
    isPlaceholder: true,
    fields: {
      ownerPlayerId,
      source,
      isPlaceholder: true,
      casterSpoilerMask: true,
    },
  };
}

/**
 * Re-resolve a pinned spotlight card against the projected frame. Keeping the
 * old object would allow identity or art learned later in the replay to remain
 * visible after the caster rewinds behind that reveal.
 */
export function casterSpotlightCardAtState(
  state: ReplayState,
  pinnedCard: ReplayCardState | null,
): ReplayCardState | null {
  if (!pinnedCard) return null;
  for (const player of Object.values(state.players)) {
    for (const cards of Object.values(player.zones)) {
      const currentCard = cards.find((card) => card.id === pinnedCard.id);
      if (currentCard) return currentCard;
    }
  }
  return null;
}

/**
 * Combined replays deliberately contain both players' private information.
 * Caster Studio defaults back to the capture-player view so a clean recording
 * cannot accidentally reveal the opponent's hand before the game did.
 */
export function casterSpoilerSafeState(
  replay: CanonicalReplayV2,
  state: ReplayState,
): ReplayState {
  if (!isOpenInformationReplay(replay)) return state;
  const masked = cloneReplayState(state);
  const players = resolveReplayPlayers(replay, masked);
  const opponent = masked.players[players.top.id];
  if (!opponent) return masked;

  for (const [zone, cards] of Object.entries(opponent.zones)) {
    if (!isHandZone(zone)) continue;
    opponent.zones[zone] = cards.map((card) => maskedHandCard(card, opponent.id, zone));
  }
  return masked;
}
