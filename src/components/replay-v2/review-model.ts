import { createInitialReplayState, reduceReplayEvent } from "@/lib/replay-v2/project-state";
import type { CanonicalReplayV2, JsonObject, ReplayCardState, ReplayEvent, ReplayGame, ReplayPatchOperation, ReplayState } from "@/lib/replay-v2/types";
import { totalBattlefieldMight, type BattlefieldMight } from "./battlefield-might";
import { cardStatuses, cardStatusText } from "./card-status";
import { isExplicitlyRevealedHandCard } from "./hand-visibility";
import { battlefieldCards, battlefieldZoneForPlayer, resolveReplayPlayers, sharedBattlefieldCard } from "./model";

export type ReplayReviewKind = "play" | "move" | "combat" | "score" | "mulligan" | "turn" | "status" | "reveal" | "opening" | "end";
export type ReplayReviewEntry = {
  id: string;
  eventIndex: number;
  atMs: number;
  gameId: string;
  gameNumber: number;
  kind: ReplayReviewKind;
  label: string;
  summary: string;
  cardNames: string[];
  searchText: string;
};
export type ReplayReviewMoment = ReplayReviewEntry & { prompt: string; combatId?: string };
export type ReplayCombatBoard = {
  sides: {
    playerId: string;
    label: string;
    cards: { id: string; name: string; statuses: string[]; equipment: string[]; might?: number; exhausted: boolean; hidden: boolean }[];
    might?: BattlefieldMight;
  }[];
};
export type ReplayCombat = {
  id: string;
  gameId: string;
  gameNumber: number;
  label: string;
  startEventIndex: number;
  endEventIndex: number;
  startMs: number;
  endMs: number;
  before: ReplayCombatBoard;
  after: ReplayCombatBoard;
  changes: ReplayReviewEntry[];
  incomplete: boolean;
};
export type ReplayReviewIndex = {
  entries: ReplayReviewEntry[];
  moments: ReplayReviewMoment[];
  combats: ReplayCombat[];
  games: { id: string; number: number; partial: boolean }[];
};

type CardAt = { card: ReplayCardState; playerId: string; zone: string };
type LocatedEntry = { entry: ReplayReviewEntry; lanes: Set<string> };
type OpenCombat = { combat: ReplayCombat; lane: string };
const LANES = ["battlefielda", "battlefieldb", "battlefieldtoken"] as const;
const PRIVATE_ZONES = new Set(["deck", "maindeck", "runedeck", "sideboard", "side", "exilehidden", "banishedhidden"]);
const PUBLIC_ZONES = new Set(["base", "board", "battlefielda", "battlefieldb", "battlefieldtoken", "trash", "discard", "graveyard", "banished", "exile", "champion", "championzone", "legend", "runes", "rune", "runepool", "chain"]);
const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const searchNormalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en").replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const CARD_FIELDS = new Set(["id", "name", "cardCode", "ownerPlayerId", "source", "exhausted", "isPlaceholder", "hidden", "revealedToOpponent", "analysisKnowledge", "type", "might", "text", "whiteCounter", "redCounter", "temporaryMightBuff", "customLabels", "attachedToCardId"]);
const PLAYER_FIELDS = new Set(["name", "provider", "seat", "score", "selectedBattlefield", "battlefieldCard", "battlefield"]);
const ROOM_FIELDS = new Set(["phase", "gameNumber", "activeTurnPlayerId", "firstPlayerId", "turnNumber", "selectedBattlefields", "battlefieldCards", "battlefields", "sharedBattlefieldToken", "pendingBattlefieldConquerAssist"]);

/** One chronological projection; never looks ahead for card identity or indexes raw action/log text. */
export function buildReplayReview(replay: CanonicalReplayV2): ReplayReviewIndex {
  const result: ReplayReviewIndex = { entries: [], moments: [], combats: [], games: [] };
  const games = new Map(replay.series.games.map((game) => [game.id, game]));
  const gameEntries = new Map<string, ReplayReviewEntry[]>();
  const openings = new Map<string, ReplayReviewEntry>();
  const openingFallbacks = new Map<string, ReplayReviewEntry>();
  const lastEvents = new Map<string, ReplayEvent>();
  const endBoundaries = new Map<string, ReplayEvent>();
  const lastBoardEvents = new Map<string, ReplayEvent>();
  const sawMulligan = new Set<string>();
  const ownMulligans = new Set<string>();
  const openCombats = new Map<string, OpenCombat>();
  const scoreWeights = new Map<string, number>();
  const labels = new WeakMap<ReplayState, Map<string, string>>();
  const laneLabel = (atState: ReplayState, lane: string): string => {
    let cached = labels.get(atState);
    if (!cached) { cached = new Map(); labels.set(atState, cached); }
    let label = cached.get(lane);
    if (!label) { label = battlefieldLabel(replay, atState, lane); cached.set(lane, label); }
    return label;
  };
  const locationLabel = (atState: ReplayState, at: CardAt) => isLane(at.zone) ? laneLabel(atState, physicalLane(replay, at.playerId, at.zone)) : zoneLabel(at.zone);
  const initialState = () => createInitialReplayState({ ...replay.series, participants: replay.series.participants.map((participant) => ({ ...participant, fields: pickFields(participant.fields, PLAYER_FIELDS) })) });
  let state = initialState();
  let currentGameId: string | null = null;
  let haveBoard = false;
  const emit = (entry: ReplayReviewEntry) => {
    result.entries.push(entry);
    const list = gameEntries.get(entry.gameId) ?? [];
    list.push(entry);
    gameEntries.set(entry.gameId, list);
    return entry;
  };
  const closeCombat = (open: OpenCombat, event: ReplayEvent, next: ReplayState, incomplete: boolean) => {
    const combat = open.combat;
    combat.endEventIndex = event.index;
    combat.endMs = event.atMs;
    combat.after = combatBoard(replay, next, open.lane);
    combat.incomplete ||= incomplete;
    result.combats.push(combat);
    openCombats.delete(open.lane);
  };

  for (const event of replay.events) {
    const game = event.gameId ? games.get(event.gameId) : undefined;
    if (!game) continue;
    if (event.gameId !== currentGameId) {
      const last = currentGameId ? lastEvents.get(currentGameId) : undefined;
      if (last) for (const open of [...openCombats.values()]) closeCombat(open, last, state, true);
      // A game boundary must not carry Game 1 hands, counters or scores into Game 2.
      state = initialState();
      currentGameId = game.id;
      haveBoard = false;
    }
    const previous = state;
    // Chat and free-text logs are irrelevant here and can grow large. They are
    // deliberately excluded from this private projection and from the index.
    if (event.kind === "chat" || event.kind === "log" || event.kind === "unknown" || event.kind === "interaction") {
      lastEvents.set(game.id, event);
      continue;
    }
    state = reduceReplayEvent(previous, reviewProjectionEvent(event));
    state.chat = [];
    state.log = [];
    lastEvents.set(game.id, event);
    const boardEvent = event.kind === "snapshot" || event.kind === "action";
    if (boardEvent) lastBoardEvents.set(game.id, event);
    if (event.kind === "game_boundary" && event.boundary === "end") endBoundaries.set(game.id, event);
    const located: LocatedEntry[] = [];
    const add = (kind: ReplayReviewKind, label: string, summary: string, names: string[] = [], lanes: string[] = [], terms: string[] = []) => {
      const entry = makeEntry(event, game, kind, label, summary, names, located.length, terms);
      located.push({ entry: emit(entry), lanes: new Set(lanes) });
      return entry;
    };
    const beforeCards = boardEvent ? cardsAt(previous) : new Map<string, CardAt>();
    const afterCards = boardEvent ? cardsAt(state) : new Map<string, CardAt>();

    if (boardEvent && !openings.has(game.id) && Object.values(state.players).some((player) => Object.values(player.zones).some((cards) => cards.length))) {
      const inOpening = state.phase === "mulligan" || state.phase === "initiative_roll" || state.phase === "first_player_choice";
      const hasHand = [...afterCards.values()].some((at) => isHand(at.zone));
      const names = [...afterCards.values()].filter((at) => isHand(at.zone) && visibleIdentity(replay, at)).map((at) => displayName(at.card));
      if (inOpening && hasHand) {
        const entry = add("opening", "Opening hand", "Review the hand visible at this point in the opening.", names);
        openings.set(game.id, entry);
      } else if (!openingFallbacks.has(game.id)) {
        // Setup often records selected battlefields before either opening hand.
        // Hold a fallback without selecting it until the whole game is indexed.
        openingFallbacks.set(game.id, makeEntry(event, game, "opening", "First recorded position", "The recording first shows the board here. Earlier decisions may not be captured.", names, 998));
      }
    }

    const actionType = event.kind === "action" ? normalize(event.actionType) : "";
    if ((state.phase === "mulligan" && previous.phase !== "mulligan") || actionType === "submitmulligan" || actionType === "mulligan") {
      sawMulligan.add(game.id);
      const names = [...afterCards.values()].filter((at) => isHand(at.zone) && visibleIdentity(replay, at)).map((at) => displayName(at.card));
      const entry = add("mulligan", actionType === "submitmulligan" ? "Mulligan submitted" : "Mulligan", "Review the captured opening choices. Unseen cards remain hidden.", names);
      if (event.kind === "action" && event.actorPlayerId === perspectiveId(replay)) ownMulligans.add(entry.id);
    }

    if (boardEvent && haveBoard) {
      for (const key of new Set([...beforeCards.keys(), ...afterCards.keys()])) {
        const before = beforeCards.get(key);
        const after = afterCards.get(key);
        const beforeVisible = before && visibleIdentity(replay, before);
        const afterVisible = after && visibleIdentity(replay, after);
        const visible = afterVisible ? after : beforeVisible ? before : undefined;
        const names = visible ? [displayName(visible.card)] : [];
        const name = names[0] ?? "Hidden card";
        const lanes = [before, after].filter((at): at is CardAt => Boolean(at && isLane(at.zone))).map((at) => physicalLane(replay, at.playerId, at.zone));
        const beforeZone = before ? locationLabel(previous, before) : undefined;
        const afterZone = after ? locationLabel(state, after) : undefined;
        const relevantBefore = before && observableZone(before.zone);
        const relevantAfter = after && observableZone(after.zone);
        const moved = before && after && (normalize(before.zone) !== normalize(after.zone) || before.playerId !== after.playerId);
        if (moved && (relevantBefore || relevantAfter)) {
          const kind = isHand(before.zone) && isInPlay(after.zone) ? "play" : "move";
          add(kind, `${name}: ${beforeZone} → ${afterZone}`, event.kind === "snapshot"
            ? "Position changed between recorded boards; the intervening actions may not be captured."
            : `Recorded move from ${beforeZone} to ${afterZone}.`, names, lanes, statusTerms(visible?.card));
        } else if (!before && after && relevantAfter) {
          // A snapshot insert does not establish that the card was played.
          add(event.kind === "action" && isInPlay(after.zone) ? "play" : "reveal", `${name} appeared in ${afterZone}`, event.kind === "snapshot"
            ? "Present in the next recorded board; the action that put it here may not be captured."
            : `Recorded addition to ${afterZone}.`, names, lanes, statusTerms(visible?.card));
        } else if (before && !after && relevantBefore) {
          add("move", `${name} left ${beforeZone}`, "The card is no longer in this recorded zone. This alone does not establish how it left.", names, lanes);
        } else if (before && after && !moved) {
          if (!beforeVisible && afterVisible) add("reveal", `${name} revealed`, "The card identity becomes visible at this point.", names, lanes, statusTerms(after.card));
          const changes = cardChanges(before, after, Boolean(beforeVisible), Boolean(afterVisible));
          if (changes.length && (relevantBefore || relevantAfter)) add("status", `${name}: ${changes.join("; ")}`, "Recorded card state changed; these markers do not calculate combat damage or resolve card rules.", names, lanes, statusTerms(afterVisible ? after.card : undefined));
        }
      }
      const changes = Object.values(state.players).flatMap((player) => {
        const before = score(previous, player.id);
        const after = score(state, player.id);
        return before !== undefined && after !== undefined && before !== after ? [{ playerId: player.id, before, after }] : [];
      });
      if (changes.length) {
        const correction = /rewind|undo|restore|reset/.test(actionType) || (finite(previous.room.turnNumber) && finite(state.room.turnNumber) && state.room.turnNumber < previous.room.turnNumber);
        const increased = !correction && changes.length === 1 && changes[0].after > changes[0].before;
        const entry = add("score", increased ? `${sideLabel(replay, changes[0].playerId)} scored` : "Score updated", changes.map((change) => `${sideLabel(replay, change.playerId)}: ${change.before} → ${change.after}`).join(" · "), [], [...openCombats.keys()], ["points", "score"]);
        scoreWeights.set(entry.id, increased ? changes[0].after - changes[0].before : 0);
      }
      if ((state.room.activeTurnPlayerId && state.room.activeTurnPlayerId !== previous.room.activeTurnPlayerId) || (state.room.turnNumber !== undefined && state.room.turnNumber !== previous.room.turnNumber)) {
        add("turn", `Turn${finite(state.room.turnNumber) ? ` ${state.room.turnNumber}` : " changed"}`, state.room.activeTurnPlayerId ? `${sideLabel(replay, state.room.activeTurnPlayerId)} is the active player.` : "The recorded turn changed.");
      }
      const beforeChain = chainCards(previous);
      const afterChain = chainCards(state);
      for (const id of new Set([...beforeChain.keys(), ...afterChain.keys()])) {
        const before = beforeChain.get(id);
        const after = afterChain.get(id);
        if (Boolean(before) === Boolean(after)) continue;
        const at = after ?? before!;
        const names = visibleIdentity(replay, at) ? [displayName(at.card)] : [];
        const name = names[0] ?? "Hidden card";
        const label = after ? `${name} added to chain` : actionType === "chainresolve" ? `Chain resolved: ${name}` : `${name} left chain`;
        const spell = typeof at.card.fields.type === "string" && /(?:^|\s)spell(?:$|\s)/i.test(at.card.fields.type);
        add(after ? "play" : "status", label, "Recorded chain action. A chain action during a battlefield contest is shown for context; its targets and effects are not inferred.", names, [...openCombats.keys()], ["chain", ...(after ? ["played"] : ["resolved"]), ...(spell ? ["spell"] : [])]);
      }
    }

    if (event.kind === "action" && ["battlefieldconquerconfirm", "battlefieldconquerpassfocus", "battlefieldconquercancel"].includes(actionType)) {
      const lane = pendingConquestLane(state) ?? pendingConquestLane(previous);
      const label = lane ? laneLabel(state, lane) : "Battlefield";
      const operation = actionType === "battlefieldconquerconfirm" ? "conquest confirmed" : actionType === "battlefieldconquerpassfocus" ? "focus passed" : "conquest cancelled";
      add("combat", `${label}: ${operation}`, "Recorded battlefield action. Control and scoring follow the captured state; this does not establish that units fought.", [], lane ? [lane] : [], ["battlefield", "control", "conquest"]);
    }

    const turnChanged = haveBoard && boardEvent && ((previous.room.activeTurnPlayerId && state.room.activeTurnPlayerId !== previous.room.activeTurnPlayerId) || (previous.room.turnNumber !== undefined && state.room.turnNumber !== previous.room.turnNumber));
    const endBoundary = event.kind === "game_boundary" && event.boundary === "end";
    const ending = endBoundary || state.phase === "game_end" || state.phase === "series_end";
    for (const lane of LANES) {
      const contested = boardEvent && laneContested(replay, state, lane);
      let open = openCombats.get(lane);
      if (!open && contested && !ending) {
        const names = Object.keys(state.players).flatMap((playerId) => laneCards(replay, state, playerId, lane)
          .filter((card) => visibleIdentity(replay, { card, playerId, zone: lane }))
          .map(displayName));
        const entry = add("combat", `${laneLabel(state, lane)} contest`, haveBoard && !laneContested(replay, previous, lane)
          ? "Both sides now have units at this battlefield. Follow the recorded changes."
          : "Both sides have units here when the recording resumes; the start of this contest may be missing.", names, [lane], ["combat", "fight", "battle"]);
        open = { lane, combat: {
          id: `combat-${game.id}-${event.index}-${lane}`, gameId: game.id, gameNumber: game.gameNumber,
          label: `${laneLabel(state, lane)} contest`, startEventIndex: event.index, endEventIndex: event.index,
          startMs: event.atMs, endMs: event.atMs,
          before: combatBoard(replay, state, lane), after: combatBoard(replay, state, lane), changes: [],
          incomplete: !haveBoard || laneContested(replay, previous, lane),
        } };
        // Keep the first simultaneous-board frame, including the arriving unit.
        open.combat.changes.push(entry);
        openCombats.set(lane, open);
      }
      if (open) {
        for (const locatedEntry of located) {
          if (locatedEntry.lanes.has(lane) && !open.combat.changes.includes(locatedEntry.entry)) open.combat.changes.push(locatedEntry.entry);
        }
        open.combat.endEventIndex = event.index;
        open.combat.endMs = event.atMs;
        if (boardEvent) open.combat.after = combatBoard(replay, state, lane);
        // Normalization can emit game_end before the same-packet final board
        // patch. Keep an existing contest open through that patch and close at
        // its observed end or the explicit boundary, never at the early phase.
        if ((boardEvent && !contested) || turnChanged || endBoundary) closeCombat(open, event, state, Boolean((turnChanged && contested) || (endBoundary && (!game.result || contested))));
      }
    }
    if (boardEvent && (event.kind === "snapshot" || afterCards.size > 0)) haveBoard = true;
  }
  for (const open of [...openCombats.values()]) {
    const last = lastEvents.get(open.combat.gameId);
    if (last) closeCombat(open, last, state, true);
  }
  for (const game of replay.series.games) {
    const entries = gameEntries.get(game.id) ?? [];
    // A result identifier is not always an event identifier. An explicit end
    // boundary follows the final authoritative patch even when timestamps tie.
    const last = endBoundaries.get(game.id) ?? lastBoardEvents.get(game.id) ?? lastEvents.get(game.id);
    if (last) {
      entries.push(makeEntry(last, game, "end", game.result ? "Game result" : "Recording ends", game.result ? "A game result was captured. Compare the final board with the decisions you reviewed." : "No confirmed game result is available. The final outcome may be missing.", [], 999));
      // The entries array is also in gameEntries; only the global list needs appending.
      result.entries.push(entries.at(-1)!);
    }
    const opening = openings.get(game.id) ?? openingFallbacks.get(game.id);
    if (opening && !openings.has(game.id)) {
      entries.push(opening);
      result.entries.push(opening);
    }
    result.games.push({ id: game.id, number: game.gameNumber, partial: !sawMulligan.has(game.id) || !game.result });
    const choices: { entry: ReplayReviewEntry; prompt: string; combatId?: string }[] = [];
    if (opening) choices.push({ entry: opening, prompt: opening.label === "Opening hand" ? "What was your plan for this hand?" : "What was your plan from this position? Earlier opening decisions may be missing." });
    const mulligans = entries.filter((entry) => entry.kind === "mulligan" && entry.eventIndex > (opening?.eventIndex ?? -1));
    const mulligan = mulligans.find((entry) => entry.label === "Mulligan submitted" && ownMulligans.has(entry.id)) ?? mulligans.find((entry) => entry.label === "Mulligan submitted") ?? mulligans[0];
    if (mulligan) choices.push({ entry: mulligan, prompt: "Which cards supported your opening plan, and which were you hoping to replace?" });
    const combats = result.combats.filter((combat) => combat.gameId === game.id);
    for (const combat of [combats[0], ...(combats.length > 1 ? [combats.at(-1)] : [])]) {
      if (!combat) continue;
      const entry = entries.find((entry) => entry.kind === "combat" && entry.eventIndex === combat.startEventIndex && entry.label === combat.label);
      if (entry) choices.push({ entry, combatId: combat.id, prompt: "What were you trying to gain from this contest? Compare the units and changes in the breakdown." });
    }
    const scoring = entries.filter((entry) => entry.kind === "score" && (scoreWeights.get(entry.id) ?? 0) > 0).sort((a, b) => (scoreWeights.get(b.id) ?? 0) - (scoreWeights.get(a.id) ?? 0) || a.eventIndex - b.eventIndex)[0];
    if (scoring) choices.push({ entry: scoring, prompt: "What led to this score change? Was there a different battlefield you could have contested?" });
    const end = entries.find((entry) => entry.kind === "end");
    if (end) choices.push({ entry: end, prompt: game.result ? "What is one decision you would repeat or change next game?" : "What can you learn from the captured portion? The final result is not available." });
    // Stable same-frame order keeps the opening before its choice and the end
    // reflection last, while seeks still use the exact canonical event index.
    result.moments.push(...choices.sort((a, b) => a.entry.eventIndex - b.entry.eventIndex).map(({ entry, prompt, combatId }) => ({ ...entry, prompt, ...(combatId ? { combatId } : {}) })));
  }
  result.entries.sort((a, b) => a.eventIndex - b.eventIndex || a.id.localeCompare(b.id));
  result.combats.sort((a, b) => a.startEventIndex - b.startEventIndex || a.id.localeCompare(b.id));
  return result;
}

export function searchReplayReview(index: ReplayReviewIndex, query: string, gameId?: string, kind?: ReplayReviewKind | "all"): ReplayReviewEntry[] {
  const words = searchNormalize(query).split(" ").filter(Boolean);
  return index.entries.filter((entry) => (!gameId || entry.gameId === gameId) && (!kind || kind === "all" || entry.kind === kind) && words.every((word) => entry.searchText.includes(word)));
}

function makeEntry(event: ReplayEvent, game: ReplayGame, kind: ReplayReviewKind, label: string, summary: string, names: string[], ordinal: number, terms: string[] = []): ReplayReviewEntry {
  const cardNames = [...new Set(names)];
  return { id: `review-${game.id}-${event.index}-${kind}-${ordinal}`, eventIndex: event.index, atMs: event.atMs, gameId: game.id, gameNumber: game.gameNumber, kind, label, summary, cardNames, searchText: searchNormalize([kind, label, summary, ...cardNames, ...terms].join(" ")) };
}
function cardsAt(state: ReplayState): Map<string, CardAt> {
  const result = new Map<string, CardAt>();
  for (const player of Object.values(state.players)) for (const [zone, cards] of Object.entries(player.zones)) for (const card of cards) result.set(`${player.id}:${card.id}`, { card, playerId: player.id, zone });
  return result;
}
function visibleIdentity(replay: CanonicalReplayV2, at: CardAt): boolean {
  const { card, playerId, zone } = at;
  if (card.isPlaceholder || card.fields.isPlaceholder || card.fields.analysisKnowledge === "future_reveal" || card.fields.analysisKnowledge === "previous_reveal") return false;
  const key = normalize(zone);
  if (PRIVATE_ZONES.has(key) || !observableZone(zone)) return false;
  const own = playerId === perspectiveId(replay);
  const combined = replay.collaboration?.informationPolicy === "consented_full_information";
  if (isHand(zone) && !own && !combined && !isExplicitlyRevealedHandCard(card)) return false;
  if (card.fields.hidden === true && !own && !combined && card.fields.revealedToOpponent !== true) return false;
  return Boolean(card.name?.trim() || card.cardCode?.trim());
}
function perspectiveId(replay: CanonicalReplayV2): string | undefined {
  return replay.series.perspectivePlayerId ?? replay.series.participants.find((player) => player.isPerspective)?.id;
}
function sideLabel(replay: CanonicalReplayV2, playerId: string): string {
  const perspective = perspectiveId(replay);
  if (perspective) return playerId === perspective ? "Our side" : "Enemy side";
  return `Player ${Math.max(1, replay.series.participants.findIndex((player) => player.id === playerId) + 1)}`;
}
function displayName(card: ReplayCardState): string { return (card.name?.trim() || card.cardCode?.trim() || "Unknown card").slice(0, 180); }
function isHand(zone: string): boolean { return ["hand", "handcards"].includes(normalize(zone)); }
function isLane(zone: string): boolean { return (LANES as readonly string[]).includes(normalize(zone)); }
function observableZone(zone: string): boolean { return isHand(zone) || PUBLIC_ZONES.has(normalize(zone)); }
function isInPlay(zone: string): boolean { return ["base", "board", ...LANES, "champion", "championzone", "runes", "runepool"].includes(normalize(zone)); }
function zoneLabel(zone: string): string {
  const labels: Record<string, string> = { battlefielda: "Battlefield A", battlefieldb: "Battlefield B", battlefieldtoken: "Shared battlefield", base: "Base", board: "Board", hand: "Hand", handcards: "Hand", deck: "Deck", maindeck: "Deck", runedeck: "Rune deck", sideboard: "Sideboard", trash: "Discard", discard: "Discard", graveyard: "Discard", banished: "Banished", exile: "Banished", champion: "Champion zone", championzone: "Champion zone", legend: "Legend", runes: "Runes", rune: "Runes", runepool: "Runes", chain: "Chain" };
  return labels[normalize(zone)] ?? "another zone";
}
function statusTerms(card?: ReplayCardState): string[] { return cardStatuses(card).filter((status) => status.kind !== "custom").map(cardStatusText); }
function cardChanges(before: CardAt, after: CardAt, beforeVisible: boolean, afterVisible: boolean): string[] {
  if (!beforeVisible && !afterVisible) return [];
  if (!afterVisible) return ["identity is now hidden"];
  if (!beforeVisible) return [];
  const result: string[] = [];
  if (Boolean(before.card.exhausted) !== Boolean(after.card.exhausted)) result.push(after.card.exhausted ? "exhausted" : "ready");
  const prior = statusTerms(before.card);
  const next = statusTerms(after.card);
  for (const status of next) if (!prior.includes(status)) result.push(status);
  for (const status of prior) if (!next.includes(status)) result.push(`${status} removed`);
  for (const [field, label] of [["whiteCounter", "might counter"], ["redCounter", "red counter"]] as const) {
    const value = after.card.fields[field];
    if (before.card.fields[field] !== value && finite(value)) result.push(`${label} ${value}`);
    else if (finite(before.card.fields[field]) && !finite(value)) result.push(`${label} cleared`);
  }
  if (before.card.fields.attachedToCardId !== after.card.fields.attachedToCardId) result.push(after.card.fields.attachedToCardId ? "equipped" : "detached");
  return result;
}
function score(state: ReplayState, playerId: string): number | undefined {
  const player = state.players[playerId];
  const value = player?.score ?? player?.boardFields.score ?? player?.fields.score;
  return finite(value) && value >= 0 ? value : undefined;
}
function physicalLane(replay: CanonicalReplayV2, playerId: string, zone: string): string {
  const lane = normalize(zone);
  if (replay.source.schema !== "riftlite-tcga-raw-capture" || playerId === (perspectiveId(replay) ?? replay.series.participants[0]?.id)) return lane;
  return lane === "battlefielda" ? "battlefieldb" : lane === "battlefieldb" ? "battlefielda" : lane;
}
function laneCards(replay: CanonicalReplayV2, state: ReplayState, playerId: string, lane: string): ReplayCardState[] {
  return Object.entries(state.players[playerId]?.zones ?? {}).filter(([zone]) => physicalLane(replay, playerId, zone) === lane).flatMap(([, cards]) => cards);
}
function laneContested(replay: CanonicalReplayV2, state: ReplayState, lane: string): boolean {
  return Object.keys(state.players).filter((playerId) => {
    const visible = laneCards(replay, state, playerId, lane).filter((card) => card.fields.hidden !== true && visibleIdentity(replay, { card, playerId, zone: lane }));
    // Atlas's existing might model also recognizes catalog units without a
    // captured type; TCGA uses its captured unit type. Unknowns do not invent combat.
    return visible.some((card) => !card.fields.attachedToCardId && typeof card.fields.type === "string" && /(?:^|\s)unit(?:$|\s)/i.test(card.fields.type)) || (replay.source.schema !== "riftlite-tcga-raw-capture" && totalBattlefieldMight(visible).unitCount > 0);
  }).length >= 2;
}
function combatBoard(replay: CanonicalReplayV2, state: ReplayState, lane: string): ReplayCombatBoard {
  const playerIds = [...new Set([...replay.series.participants.map((player) => player.id), ...Object.keys(state.players)])];
  const perspective = perspectiveId(replay);
  playerIds.sort((a, b) => (a === perspective ? -1 : b === perspective ? 1 : 0));
  return { sides: playerIds.map((playerId) => {
    const cards = laneCards(replay, state, playerId, lane);
    const visible = cards.filter((card) => visibleIdentity(replay, { card, playerId, zone: lane }));
    const displayed = cards.filter((card) => !card.fields.attachedToCardId || !cards.some((host) => host.id === card.fields.attachedToCardId));
    return {
      playerId, label: sideLabel(replay, playerId),
      cards: displayed.map((card) => {
        const known = visibleIdentity(replay, { card, playerId, zone: lane });
        const attachments = cards.filter((item) => item.fields.attachedToCardId === card.id);
        const might = known && replay.source.schema !== "riftlite-tcga-raw-capture" ? totalBattlefieldMight([card, ...attachments.filter((item) => visible.includes(item))]) : undefined;
        return { id: card.id, name: known ? displayName(card) : "Hidden card", statuses: known ? statusTerms(card) : [], equipment: attachments.map((item) => visibleIdentity(replay, { card: item, playerId, zone: lane }) ? displayName(item) : "Hidden card"), ...(might?.unitCount && !might.unknownCount ? { might: might.total } : {}), exhausted: Boolean(card.exhausted), hidden: !known || card.fields.hidden === true };
      }),
      ...(replay.source.schema !== "riftlite-tcga-raw-capture" ? { might: totalBattlefieldMight(visible) } : {}),
    };
  }) };
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function pendingConquestLane(state: ReplayState): string | undefined {
  const value = state.room.fields.pendingBattlefieldConquerAssist;
  const zone = record(value) ? value.zone : undefined;
  return typeof zone === "string" && isLane(zone) ? normalize(zone) : undefined;
}
function chainCards(state: ReplayState): Map<string, CardAt> {
  const result = new Map<string, CardAt>();
  for (const entry of state.chain) {
    const raw = entry.fields.card;
    if (!record(raw)) continue;
    // Do not copy arbitrary chain fields, source text, actor name or action data.
    const card: ReplayCardState = {
      id: entry.id, name: typeof raw.name === "string" ? raw.name : "",
      ...(typeof raw.cardCode === "string" ? { cardCode: raw.cardCode } : {}),
      isPlaceholder: raw.isPlaceholder === true,
      fields: { hidden: raw.hidden === true, revealedToOpponent: raw.revealedToOpponent === true, ...(typeof raw.type === "string" ? { type: raw.type } : {}), ...(typeof raw.analysisKnowledge === "string" ? { analysisKnowledge: raw.analysisKnowledge } : {}) },
    };
    const playerId = typeof raw.ownerPlayerId === "string" ? raw.ownerPlayerId : typeof entry.fields.byPlayerId === "string" ? entry.fields.byPlayerId : "";
    result.set(entry.id, { card, playerId, zone: "chain" });
  }
  return result;
}
function battlefieldLabel(replay: CanonicalReplayV2, state: ReplayState, lane: string): string {
  if (lane === "battlefieldtoken") {
    const shared = sharedBattlefieldCard(state);
    return shared && !shared.isPlaceholder ? displayName(shared) : zoneLabel(lane);
  }
  const players = resolveReplayPlayers(replay, state);
  const preferredTop = battlefieldZoneForPlayer(players.top, "battlefieldB");
  const bottom = replay.source.schema === "riftlite-tcga-raw-capture" ? "battlefieldA" : battlefieldZoneForPlayer(players.bottom, preferredTop === "battlefieldA" ? "battlefieldB" : "battlefieldA");
  const index = normalize(bottom) === lane ? 0 : 1;
  const player = index === 0 ? players.bottom : players.top;
  const hasSelection = [player.boardFields.selectedBattlefield, player.fields.selectedBattlefield, player.boardFields.battlefieldCard, player.fields.battlefieldCard, player.boardFields.battlefield, player.fields.battlefield, state.room.fields.selectedBattlefields, state.room.fields.battlefieldCards, state.room.fields.battlefields].some((value) => value !== undefined);
  if (hasSelection) {
    const card = battlefieldCards(state, players)[index];
    if (card && !card.isPlaceholder) return displayName(card);
  }
  return zoneLabel(lane);
}

function pickFields(fields: JsonObject, allow: ReadonlySet<string>): JsonObject {
  return Object.fromEntries(Object.entries(fields).filter(([key]) => allow.has(key)));
}
function reviewCard(card: ReplayCardState): ReplayCardState { return { ...card, fields: pickFields(card.fields, CARD_FIELDS) }; }
/** Retain only the projection fields this index reads, avoiding repeatedly cloning private decklists, artwork and historic logs. */
function reviewProjectionEvent(event: ReplayEvent): ReplayEvent {
  if (event.kind === "snapshot") return { ...event, snapshot: {
    room: { ...event.snapshot.room, fields: pickFields(event.snapshot.room.fields, ROOM_FIELDS) },
    players: Object.fromEntries(Object.entries(event.snapshot.players).map(([id, player]) => [id, {
      ...player, fields: pickFields(player.fields, PLAYER_FIELDS), boardFields: pickFields(player.boardFields, PLAYER_FIELDS),
      zones: Object.fromEntries(Object.entries(player.zones).map(([zone, cards]) => [zone, cards.map(reviewCard)])),
    }])),
    chain: event.snapshot.chain.map((entry) => ({ id: entry.id, fields: pickFields(entry.fields, new Set(["card", "byPlayerId"])) })), log: [],
  } };
  if (event.kind !== "action") return event;
  const operations: ReplayPatchOperation[] = [];
  for (const operation of event.patch.operations) {
    switch (operation.op) {
      case "zone_insert": operations.push({ ...operation, cards: operation.cards.map(reviewCard) }); break;
      case "zone_move": operations.push({ ...operation, ...(operation.card ? { card: reviewCard(operation.card) } : {}) }); break;
      case "patch_card_fields": operations.push({ ...operation, fields: pickFields(operation.fields, CARD_FIELDS) }); break;
      case "unset_card_fields": operations.push({ ...operation, fields: operation.fields.filter((field) => CARD_FIELDS.has(field)) }); break;
      case "set_player_fields": case "set_board_fields": operations.push({ ...operation, fields: pickFields(operation.fields, PLAYER_FIELDS) }); break;
      case "set_room_fields": operations.push({ ...operation, fields: pickFields(operation.fields, ROOM_FIELDS) }); break;
      case "unset_room_fields": operations.push({ ...operation, fields: operation.fields.filter((field) => ROOM_FIELDS.has(field)) }); break;
      case "chain_insert": operations.push({ ...operation, entries: operation.entries.map((entry) => ({ id: entry.id, fields: pickFields(entry.fields, new Set(["card", "byPlayerId"])) })) }); break;
      case "zone_remove": case "chain_remove": operations.push(operation); break;
      case "unknown": case "log_insert": case "log_remove": break;
    }
  }
  return { ...event, action: {}, patch: { ...event.patch, operations } };
}
