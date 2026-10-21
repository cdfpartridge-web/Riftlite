import type { ReplayCardState, ReplayEvent } from "@/lib/replay-v2";

export const REPLAY_CARD_MOVEMENT_MAX_CUES = 8;
const MAX_CROSSED_EVENTS = 128;
const MAX_OPERATIONS = 512;
const MAX_CARD_REFERENCES = 2_048;

type Location = { playerId: string; zone: string };
export type ReplayCardMovementCue = {
  id: string;
  eventIndex: number;
  gameId: string;
  cardId: string;
  from: Location;
  to: Location;
  kind: "trash" | "rune-recycle";
  destinationZone: "discard" | "runeDeck";
  /** Never construct new artwork from a cue: use the previously rendered visual. */
  forceCardBack: boolean;
};

export type ReplayMovementSource = {
  events: readonly ReplayEvent[];
  series: { perspectivePlayerId?: string };
};

export type ReplayCardMovementRange = {
  fromExclusiveIndex: number;
  toInclusiveIndex: number;
  gameId: string | null;
  suppressMotion: boolean;
  perspectivePlayerId?: string;
};

type Movement = { cardId: string; from: Location; to: Location; card?: ReplayCardState; order: number };
const zoneKey = (zone: string) => zone.toLowerCase().replace(/[^a-z0-9]/g, "");
const TRASH_ZONES = new Set(["discard", "trash", "graveyard", "recycle", "recyclepile"]);
const RUNE_ZONES = new Set(["runearea", "runepool", "runerow", "rune", "runes"]);
const PRIVATE_ZONES = new Set([
  "deck", "maindeck", "library", "drawpile", "drawdeck", "runedeck", "sideboard",
  "sideboardcards", "hidden", "unknown", "exilehidden", "banishedhidden",
]);
const sameLocation = (a: Location, b: Location) => a.playerId === b.playerId && zoneKey(a.zone) === zoneKey(b.zone);

/** Canonical operations prove a move. Snapshot differences and action prose do not. */
export function explicitReplayCardMovements(
  event: ReplayEvent,
  { perspectivePlayerId }: { perspectivePlayerId?: string } = {},
): ReplayCardMovementCue[] {
  if (event.kind !== "action" || !event.gameId ||
    event.confirmation.status !== "confirmed" || event.confirmation.authority !== "authoritative_patch_commit" ||
    event.patch.operations.length > MAX_OPERATIONS) return [];

  const direct: Movement[] = [];
  const removed = new Map<string, Location[]>();
  const inserted = new Map<string, { location: Location; card: ReplayCardState; order: number }[]>();
  let references = 0;
  for (const [order, operation] of event.patch.operations.entries()) {
    if (operation.op === "zone_move") {
      direct.push({ cardId: operation.cardId, from: operation.from, to: operation.to, card: operation.card, order });
      references += 1;
    } else if (operation.op === "zone_remove") {
      references += operation.cardIds.length;
      if (references > MAX_CARD_REFERENCES) return [];
      for (const id of operation.cardIds) {
        const locations = removed.get(id) ?? [];
        locations.push({ playerId: operation.playerId, zone: operation.zone });
        removed.set(id, locations);
      }
    } else if (operation.op === "zone_insert") {
      references += operation.cards.length;
      if (references > MAX_CARD_REFERENCES) return [];
      for (const card of operation.cards) {
        const locations = inserted.get(card.id) ?? [];
        locations.push({ location: { playerId: operation.playerId, zone: operation.zone }, card, order });
        inserted.set(card.id, locations);
      }
    }
  }
  const ambiguous = new Set<string>();
  for (const id of new Set([...removed.keys(), ...inserted.keys()])) {
    const from = removed.get(id) ?? [];
    const to = inserted.get(id) ?? [];
    if (from.length !== 1 || to.length !== 1) {
      ambiguous.add(id);
      continue;
    }
    direct.push({ cardId: id, from: from[0], to: to[0].location, card: to[0].card, order: to[0].order });
  }

  const byCard = new Map<string, Movement[]>();
  for (const move of direct.sort((a, b) => a.order - b.order)) {
    if (!move.cardId || !move.from.playerId || !move.to.playerId || !move.from.zone || !move.to.zone || ambiguous.has(move.cardId)) continue;
    const moves = byCard.get(move.cardId) ?? [];
    if (!moves.some((previous) => sameLocation(previous.from, move.from) && sameLocation(previous.to, move.to))) moves.push(move);
    byCard.set(move.cardId, moves);
  }

  const cues: ReplayCardMovementCue[] = [];
  for (const moves of byCard.values()) {
    // Collapse an explicit same-action path; never animate an intermediate trash
    // visit when the final operation puts the card somewhere else again.
    if (moves.some((move, index) => index > 0 && !sameLocation(moves[index - 1].to, move.from))) continue;
    const first = moves[0];
    const last = moves[moves.length - 1];
    if (sameLocation(first.from, last.to)) continue;
    const fromZone = zoneKey(first.from.zone);
    const toZone = zoneKey(last.to.zone);
    const kind = TRASH_ZONES.has(toZone) && !TRASH_ZONES.has(fromZone)
      ? "trash"
      : toZone === "runedeck" && RUNE_ZONES.has(fromZone) && first.from.playerId === last.to.playerId
        ? "rune-recycle"
        : null;
    if (!kind) continue;
    const hidden = moves.some(({ card }) => card?.isPlaceholder || card?.fields.isPlaceholder === true ||
      card?.fields.faceDown === true || (card?.fields.hidden === true && card.fields.revealedToOpponent !== true));
    const opponentHand = ["hand", "cardsinhand", "handcards"].includes(fromZone) && first.from.playerId !== perspectivePlayerId;
    cues.push({
      id: `${event.id}:${first.cardId}:${kind}`,
      eventIndex: event.index,
      gameId: event.gameId,
      cardId: first.cardId,
      from: { playerId: first.from.playerId, zone: first.from.zone },
      to: { playerId: last.to.playerId, zone: last.to.zone },
      kind,
      destinationZone: kind === "trash" ? "discard" : "runeDeck",
      forceCardBack: Boolean(hidden || PRIVATE_ZONES.has(fromZone) || opponentHand),
    });
  }
  return cues.slice(-REPLAY_CARD_MOVEMENT_MAX_CUES);
}

/** A bounded forward playback window, not a seek or a reconstruction animation. */
export function replayCardMovementCues(
  replay: ReplayMovementSource,
  range: ReplayCardMovementRange,
): ReplayCardMovementCue[] {
  const { fromExclusiveIndex: from, toInclusiveIndex: to, gameId, suppressMotion } = range;
  if (suppressMotion || !gameId || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 ||
    to <= from || to >= replay.events.length || to - from > MAX_CROSSED_EVENTS ||
    replay.events[from]?.gameId !== gameId || replay.events[to]?.gameId !== gameId) return [];
  const baseline = replay.events[from];
  if ((baseline.kind === "phase" && baseline.phase !== "in_game") ||
    (baseline.kind === "snapshot" && baseline.snapshot.room.phase !== "in_game")) return [];
  const cues = new Map<string, ReplayCardMovementCue>();
  for (let index = from + 1; index <= to; index += 1) {
    const event = replay.events[index];
    if (event.gameId !== gameId || event.kind === "game_boundary" ||
      (event.kind === "phase" && event.phase !== "in_game")) return [];
    if (event.kind === "snapshot") {
      if (event.snapshot.room.phase !== "in_game") return [];
      // A resync establishes a new visual baseline. Do not fly stale pre-resync cards.
      cues.clear();
      continue;
    }
    if (event.kind === "action") {
      // A later move can undo an earlier exit before this playback frame renders.
      if (event.patch.operations.length > MAX_OPERATIONS) return [];
      let references = 0;
      for (const operation of event.patch.operations) {
        references += operation.op === "zone_remove" ? operation.cardIds.length : operation.op === "zone_insert" ? operation.cards.length : 1;
        if (references > MAX_CARD_REFERENCES) return [];
        if (operation.op === "zone_move") cues.delete(operation.cardId);
        if (operation.op === "zone_remove") operation.cardIds.forEach((id) => cues.delete(id));
        if (operation.op === "zone_insert") operation.cards.forEach((card) => cues.delete(card.id));
      }
    }
    for (const cue of explicitReplayCardMovements(event, {
      perspectivePlayerId: range.perspectivePlayerId ?? replay.series.perspectivePlayerId,
    })) {
      cues.delete(cue.cardId);
      cues.set(cue.cardId, cue);
    }
  }
  return [...cues.values()].slice(-REPLAY_CARD_MOVEMENT_MAX_CUES);
}
