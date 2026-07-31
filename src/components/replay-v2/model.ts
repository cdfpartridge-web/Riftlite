import type {
  CanonicalReplayV2,
  JsonObject,
  JsonValue,
  ReplayCardState,
  ReplayEvent,
  ReplayPlayerState,
  ReplayState,
} from "@/lib/replay-v2";

const HAND_ZONE_ALIASES = ["hand", "cardsinhand"];
const DECK_ZONE_ALIASES = ["deck", "library", "drawpile", "drawdeck"];
const DISCARD_ZONE_ALIASES = ["discard", "trash", "graveyard", "recycle", "recyclepile"];
const BANISHED_ZONE_ALIASES = [
  "banish",
  "banished",
  "exile",
  "exiled",
  "exilehidden",
  "removed",
  "removedfromgame",
];
const SIDEBOARD_ZONE_ALIASES = ["sideboard", "sideboardcards"];
const TRUSTED_CARD_IMAGE_HOSTS = new Set([
  "cdn.piltoverarchive.com",
  "piltoverarchive.com",
  "www.piltoverarchive.com",
]);
const RIFT_ATLAS_TOKEN_IMAGE_URLS: Record<string, string> = {
  bird: "https://play.riftatlas.com/tokens/Bird.webp",
  gold: "https://play.riftatlas.com/tokens/Gold.webp",
  mech: "https://play.riftatlas.com/tokens/Mech.webp",
  recruit: "https://play.riftatlas.com/tokens/Recruit.webp",
  sandsoldier: "https://play.riftatlas.com/tokens/SandSoldier.webp",
  sprite: "https://play.riftatlas.com/tokens/Sprite.webp",
};
const CANONICAL_RUNE_CARD_CODES: Record<string, string> = {
  bodyrune: "OGN-126",
  calmrune: "OGN-042",
  chaosrune: "OGN-166",
  furyrune: "OGN-007",
  mindrune: "OGN-089",
  orderrune: "OGN-214",
};
const CANONICAL_RUNE_CARD_CODES_BY_PRINT_NUMBER: Record<string, string> = {
  "01": "OGN-007",
  "02": "OGN-042",
  "03": "OGN-089",
  "04": "OGN-126",
  "05": "OGN-166",
  "06": "OGN-214",
};
const NON_BOARD_ZONE_ALIASES = [
  ...HAND_ZONE_ALIASES,
  ...DECK_ZONE_ALIASES,
  ...DISCARD_ZONE_ALIASES,
  ...SIDEBOARD_ZONE_ALIASES,
  ...BANISHED_ZONE_ALIASES,
  "battlefield",
  "champion",
  "hidden",
  "legend",
  "rune",
  "token",
  "unknown",
];
const BATTLEFIELD_CARD_CODES: Record<string, string> = {
  abandonedhall: "UNL-205",
  acedemy: "UNL-216",
  altarofblood: "UNL-206",
  altartounity: "OGN-275",
  amateurrecital: "UNL-207",
  ancienthenge: "SFD-117",
  academy: "UNL-216",
  aspirantsclimb: "OGN-276",
  backalleybar: "OGN-277",
  bandletree: "OGN-278",
  blackflamealtar: "UNL-208",
  dreamingtree: "OGN-292",
  duskroselab: "UNL-209",
  emperorsdais: "SFD-207",
  forbiddingwaste: "UNL-210",
  forgeofthefluft: "SFD-208",
  forgottenlibrary: "UNL-211",
  forgottenmonument: "SFD-209",
  fortifiedposition: "OGN-279",
  frozenfortress: "UNL-212",
  gardensofbecoming: "UNL-213",
  groveofthegodwillow: "OGN-280",
  halloflegend: "SFD-210",
  halloflegends: "SFD-210",
  hallowedtomb: "OGN-281",
  maraispire: "SFD-211",
  minefield: "SFD-212",
  monasteryofhirana: "OGN-282",
  navorifightingpit: "OGN-283",
  obeliskofpower: "OGN-284",
  ornnsforge: "SFD-213",
  powernexus: "SFD-214",
  ravenbloomconservatory: "SFD-215",
  ravensbloomconservatory: "SFD-215",
  reaversrow: "OGN-285",
  reckonersarena: "OGN-286",
  rippersbay: "UNL-214",
  rockfallpath: "SFD-216",
  seatofpower: "SFD-217",
  sigilofthestorm: "OGN-287",
  starspring: "UNL-215",
  startippedpeak: "OGN-288",
  sunkentemple: "SFD-218",
  targonspeak: "OGN-289",
  theacedemy: "UNL-216",
  theacademy: "UNL-216",
  thearenasgreatest: "OGN-290",
  thecandlelitsanctum: "OGN-291",
  thedreamingtree: "OGN-292",
  thegrandplaza: "OGN-293",
  thepapertree: "SFD-219",
  trappinggrounds: "UNL-217",
  treasurehoard: "SFD-220",
  trifarianwarcamp: "OGN-294",
  vaultofhelia: "UNL-219",
  vaultsofhelia: "UNL-219",
  valleyofidols: "UNL-218",
  veiledtemple: "SFD-221",
  vilemawslair: "OGN-295",
  voidgate: "OGN-296",
  windswepthillock: "OGN-297",
  zaunwarrens: "OGN-298",
};
const BATTLEFIELD_CARD_CODE_SET = new Set(Object.values(BATTLEFIELD_CARD_CODES));

export type ReplayPlayerPair = {
  bottom: ReplayPlayerState;
  top: ReplayPlayerState;
};

export type ReplayBattlefieldZoneKey = "battlefieldA" | "battlefieldB";

export type ReplayBoardZone = {
  key: string;
  label: string;
  cards: ReplayCardState[];
};

export type ReplayAttachedCardGroup = {
  host: ReplayCardState;
  attachments: ReplayCardState[];
};

export type ReplayCounterField = "whiteCounter" | "redCounter";

export type ReplayTurnMarker = {
  turn: number;
  atMs: number;
  eventIndex: number;
};

export type ReplaySceneKind =
  | "matchup"
  | "battlefields"
  | "initiative"
  | "first_player"
  | "mulligan"
  | "opening"
  | "game_start"
  | "sideboarding"
  | "game_transition"
  | "game_end"
  | null;

export function resolveReplayPlayers(replay: CanonicalReplayV2, state: ReplayState): ReplayPlayerPair {
  const statePlayers = Object.values(state.players);
  const participants = replay.series.participants;
  const perspectivePlayerId = replay.series.perspectivePlayerId;
  const localParticipant = participants.find((participant) => {
    const role = `${participant.role ?? ""} ${stringField(participant.fields, "role")}`.toLowerCase();
    return (
      participant.fields.isLocal === true ||
      participant.fields.isSelf === true ||
      participant.fields.isCapturingPlayer === true ||
      participant.isPerspective ||
      /(?:local|self|captur|owner|viewer)/.test(role)
    );
  });
  const bottomId =
    perspectivePlayerId ??
    localParticipant?.id ??
    participants[0]?.id ??
    statePlayers[0]?.id ??
    "player-bottom";
  const topId =
    participants.find((participant) => participant.id !== bottomId)?.id ??
    statePlayers.find((player) => player.id !== bottomId)?.id ??
    "player-top";

  return {
    bottom: playerForId(bottomId, replay, state, "You"),
    top: playerForId(topId, replay, state, "Opponent"),
  };
}

function playerForId(
  id: string,
  replay: CanonicalReplayV2,
  state: ReplayState,
  fallbackName: string,
): ReplayPlayerState {
  const live = state.players[id];
  if (live) return live;
  const participant = replay.series.participants.find((entry) => entry.id === id);
  return {
    id,
    name: participant?.name || fallbackName,
    seat: participant?.seat,
    fields: participant?.fields ?? {},
    boardFields: {},
    zones: {},
  };
}

export function zoneCards(player: ReplayPlayerState, aliases: string[]): ReplayCardState[] {
  const normalizedAliases = new Set(aliases.map(normalizeKey));
  const exact = Object.entries(player.zones).find(([key]) => normalizedAliases.has(normalizeKey(key)));
  if (exact) return exact[1];
  const partial = Object.entries(player.zones).find(([key]) => {
    const normalized = normalizeKey(key);
    return aliases.some((alias) => normalized.includes(normalizeKey(alias)));
  });
  return partial?.[1] ?? [];
}

export function handCards(player: ReplayPlayerState): ReplayCardState[] {
  return zoneCards(player, HAND_ZONE_ALIASES);
}

export function deckCards(player: ReplayPlayerState): ReplayCardState[] {
  return zoneCards(player, DECK_ZONE_ALIASES);
}

export function discardCards(player: ReplayPlayerState): ReplayCardState[] {
  return zoneCards(player, DISCARD_ZONE_ALIASES);
}

export function banishedCards(player: ReplayPlayerState): ReplayCardState[] {
  const aliases = BANISHED_ZONE_ALIASES.map(normalizeKey);
  const seen = new Set<string>();
  return Object.entries(player.zones).flatMap(([key, cards]) => {
    const normalized = normalizeKey(key);
    if (!aliases.some((alias) => normalized === alias || normalized.includes(alias))) return [];
    return cards.filter((card) => {
      if (seen.has(card.id)) return false;
      seen.add(card.id);
      return true;
    });
  });
}

export type ReplayBanishedTransition = {
  playerId: string;
  playerName: string;
  cards: ReplayCardState[];
};

export function banishedTransitions(
  previous: ReplayState,
  current: ReplayState,
): ReplayBanishedTransition[] {
  return Object.values(current.players).flatMap((player) => {
    const previousIds = new Set(
      banishedCards(previous.players[player.id] ?? {
        id: player.id,
        name: player.name,
        fields: {},
        boardFields: {},
        zones: {},
      }).map((card) => card.id),
    );
    const cards = banishedCards(player).filter((card) => !previousIds.has(card.id));
    return cards.length
      ? [{ playerId: player.id, playerName: player.name, cards }]
      : [];
  });
}

export function sideboardCards(player: ReplayPlayerState): ReplayCardState[] {
  return zoneCards(player, SIDEBOARD_ZONE_ALIASES);
}

export function boardZones(player: ReplayPlayerState): ReplayBoardZone[] {
  const zones = Object.entries(player.zones)
    .filter(([key, cards]) => {
      if (!cards.length) return false;
      const normalized = normalizeKey(key);
      return !NON_BOARD_ZONE_ALIASES.some((alias) => normalized.includes(normalizeKey(alias)));
    })
    .map(([key, cards]) => ({ key, label: titleCase(key), cards }));

  if (zones.length) return zones.slice(0, 4);
  return [{ key: "board", label: "Board", cards: [] }];
}

export function cardName(card: ReplayCardState): string {
  if (card.isPlaceholder) return "Hidden card";
  return card.name || card.cardCode || "Unknown card";
}

export function isDuplicateCard(card: ReplayCardState | undefined): boolean {
  const value = card?.fields.isDuplicate;
  return (
    value === true ||
    value === 1 ||
    (typeof value === "string" && value.trim().toLowerCase() === "true")
  );
}

export function customCardLabels(card: ReplayCardState | undefined): string[] {
  const labels = card?.fields.customLabels;
  if (!Array.isArray(labels)) return [];
  return labels.flatMap((label) => {
    if (typeof label !== "string") return [];
    const trimmed = label.trim();
    return trimmed ? [trimmed] : [];
  });
}

/**
 * Reads the two explicit Atlas counter fields without inferring a counter from
 * action text or any other card value. `null` means the field was present but
 * malformed, allowing the UI to keep a visible diagnostic badge instead of
 * accidentally hiding an explicit zero-like value.
 */
export function cardCounterValue(
  card: ReplayCardState | undefined,
  field: ReplayCounterField,
): number | null | undefined {
  if (!card || !Object.prototype.hasOwnProperty.call(card.fields, field)) return undefined;
  return numberValue(card.fields[field]) ?? null;
}

export function attachedToCardId(card: ReplayCardState | undefined): string | undefined {
  const value = card?.fields.attachedToCardId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Keeps attached cards in the same projected row as their host while ensuring
 * every card is rendered exactly once. The normal Atlas shape is one direct
 * child, but the traversal also handles multiple children, nested attachments,
 * or malformed cycles without losing a card.
 */
export function groupCardsWithAttachments(cards: ReplayCardState[]): ReplayAttachedCardGroup[] {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const childrenByHost = new Map<string, ReplayCardState[]>();
  const parentIdByCard = new Map<string, string>();

  for (const card of cards) {
    const parentId = attachedToCardId(card);
    if (!parentId || parentId === card.id || !cardsById.has(parentId)) continue;
    parentIdByCard.set(card.id, parentId);
    const children = childrenByHost.get(parentId) ?? [];
    children.push(card);
    childrenByHost.set(parentId, children);
  }

  const visited = new Set<string>();
  const buildGroup = (host: ReplayCardState): ReplayAttachedCardGroup => {
    visited.add(host.id);
    const attachments: ReplayCardState[] = [];
    const collectChildren = (hostId: string) => {
      for (const child of childrenByHost.get(hostId) ?? []) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        attachments.push(child);
        collectChildren(child.id);
      }
    };
    collectChildren(host.id);
    return { host, attachments };
  };

  const groups = cards
    .filter((card) => !parentIdByCard.has(card.id))
    .map(buildGroup);

  // Malformed cycles have no root. Keep their first unseen card as a host so a
  // bad relationship cannot make otherwise valid projected cards disappear.
  for (const card of cards) {
    if (!visited.has(card.id)) groups.push(buildGroup(card));
  }

  return groups;
}

export function isBattlefieldCard(card: ReplayCardState | undefined): boolean {
  if (!card) return false;

  const sourceMarkers = [
    card.source,
    card.fields.source,
    card.fields.type,
    card.fields.cardType,
    card.fields.kind,
  ];
  if (
    sourceMarkers.some((value) => {
      if (typeof value !== "string") return false;
      const normalized = normalizeKey(value);
      return normalized === "battlefield" || normalized === "battlefieldcard";
    })
  ) {
    return true;
  }

  const code = cardCodeFromValue(card.cardCode) || card.cardCode;
  return (
    Boolean(BATTLEFIELD_CARD_CODES[normalizeKey(card.name)]) ||
    Boolean(code && BATTLEFIELD_CARD_CODE_SET.has(code.toUpperCase()))
  );
}

export function cardImageUrl(card: ReplayCardState | undefined): string | undefined {
  if (!card || card.isPlaceholder) return undefined;
  const fields = card.fields;
  const direct = firstString(
    fields.imageUrl,
    fields.image_url,
    fields.image,
    fields.artUrl,
    fields.art_url,
    fields.src,
  );
  const tokenImage = riftAtlasTokenImageUrl(card, direct);
  if (tokenImage) return tokenImage;
  const sourceCode =
    cardCodeFromValue(card.cardCode) ||
    cardCodeFromValue(direct) ||
    cardCodeFromValue(card.id) ||
    cardCodeFromValue(card.name);
  const canonicalCode = canonicalCardArtCode(card, sourceCode);
  if (canonicalCode && canonicalCode !== sourceCode) {
    return publicCardImageUrl(canonicalCode);
  }
  const safeDirect = safeCardImageUrl(direct);
  if (safeDirect) return safeDirect;
  const code = canonicalCode || BATTLEFIELD_CARD_CODES[normalizeKey(card.name)];
  return code ? publicCardImageUrl(code) : undefined;
}

function canonicalCardArtCode(
  card: ReplayCardState,
  sourceCode: string | undefined,
): string | undefined {
  const runeCode = CANONICAL_RUNE_CARD_CODES[normalizeKey(card.name)];
  if (runeCode) return runeCode;
  const runePrintNumber = sourceCode
    ?.match(/^[A-Z]{2,5}-R(\d{1,3})[A-Z]?$/)?.[1]
    ?.padStart(2, "0");
  if (runePrintNumber && CANONICAL_RUNE_CARD_CODES_BY_PRINT_NUMBER[runePrintNumber]) {
    return CANONICAL_RUNE_CARD_CODES_BY_PRINT_NUMBER[runePrintNumber];
  }
  return canonicalCardPrintCode(sourceCode);
}

function publicCardImageUrl(code: string): string {
  return `https://cdn.piltoverarchive.com/cards/${encodeURIComponent(code)}.webp`;
}

function riftAtlasTokenImageUrl(
  card: ReplayCardState,
  direct: string | undefined,
): string | undefined {
  const source = normalizeKey(firstString(
    card.source,
    card.fields.source,
    card.fields.type,
    card.fields.cardType,
  ) ?? "");
  const directTokenFile = direct?.match(/^\/tokens\/([a-z0-9_-]+\.webp)$/i)?.[1];
  const directTokenName = directTokenFile?.slice(0, -".webp".length);
  const canonicalDirect = directTokenName
    ? RIFT_ATLAS_TOKEN_IMAGE_URLS[normalizeKey(directTokenName)]
    : undefined;
  if (canonicalDirect) return canonicalDirect;
  if (source === "token" && directTokenFile) {
    return `https://play.riftatlas.com/tokens/${directTokenFile}`;
  }

  const tokenName = source === "token" ? card.name : undefined;
  return tokenName ? RIFT_ATLAS_TOKEN_IMAGE_URLS[normalizeKey(tokenName)] : undefined;
}

export function safeCardImageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\/(?![\\/])/.test(value)) return value;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !TRUSTED_CARD_IMAGE_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function cardCodeFromValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/\b([A-Z]{2,5}-(?:R\d{1,3}|\d{1,4})[A-Z]?)\b/i);
  if (!match) return undefined;
  return match[1].toUpperCase();
}

export function canonicalCardPrintCode(value: string | undefined): string | undefined {
  return cardCodeFromValue(value)?.replace(
    /^([A-Z]{2,5}-(?:R\d{1,3}|\d{1,4}))[A-Z]$/,
    "$1",
  );
}

export function cardsShareCanonicalIdentity(
  left: ReplayCardState,
  right: ReplayCardState,
): boolean {
  const leftCode = canonicalCardPrintCode(left.cardCode);
  const rightCode = canonicalCardPrintCode(right.cardCode);
  if (leftCode && rightCode && leftCode === rightCode) return true;
  const leftName = normalizeKey(left.name);
  const rightName = normalizeKey(right.name);
  return Boolean(leftName && rightName && leftName === rightName);
}

export function legendCard(player: ReplayPlayerState): ReplayCardState | undefined {
  return identityCard(player, {
    fieldCandidates: [
      player.fields.legend,
      player.fields.legendCard,
      player.boardFields.legend,
      player.boardFields.legendCard,
    ],
    kind: "legend",
  });
}

export function championCard(player: ReplayPlayerState): ReplayCardState | undefined {
  return identityCard(player, {
    fieldCandidates: [
      player.fields.champion,
      player.fields.championCard,
      player.fields.signatureUnit,
      player.boardFields.champion,
      player.boardFields.championCard,
    ],
    kind: "champion",
  });
}

/**
 * The card physically occupying the live champion zone.
 *
 * `championCard` is intentionally broader because matchup/opening scenes still
 * need identity art after a champion has moved elsewhere. Board rendering must
 * not use that fallback: `source: "champion"` describes where a card originated,
 * not where it currently is.
 */
export function championZoneCard(player: ReplayPlayerState): ReplayCardState | undefined {
  return zoneCards(player, ["champion"]).find((card) => !card.isPlaceholder);
}

export function battlefieldZoneForPlayer(
  player: ReplayPlayerState,
  fallback: ReplayBattlefieldZoneKey,
): ReplayBattlefieldZoneKey {
  // TCGA's B1/B2 values are owner-relative and `turnOrderPosition` is not a
  // physical seat. CentralArena projects each player's zone onto the physical
  // battlefield; this helper only arranges the two selected battlefield cards.
  const providerValue = player.fields.provider ?? player.boardFields.provider;
  const provider = typeof providerValue === "string" ? normalizeKey(providerValue) : "";
  if (provider === "tcga") return fallback;

  const seat = player.seat ?? player.fields.seat ?? player.boardFields.seat;
  const seatNumber = numberValue(seat);
  if (seatNumber === 0) return "battlefieldA";
  if (seatNumber === 1) return "battlefieldB";

  const seatLabel = typeof seat === "string" ? normalizeKey(seat) : "";
  if (["a", "seata", "left"].includes(seatLabel)) return "battlefieldA";
  if (["b", "seatb", "right"].includes(seatLabel)) return "battlefieldB";
  return fallback;
}

export function battlefieldCards(
  state: ReplayState,
  players: ReplayPlayerPair,
): Array<ReplayCardState | undefined> {
  const playerOrder = [players.bottom, players.top];
  const catalog = battlefieldCatalog(playerOrder);
  const selected = playerOrder.map((player, index) => {
    const value = firstDefined(
      player.boardFields.selectedBattlefield,
      player.fields.selectedBattlefield,
      player.boardFields.battlefieldCard,
      player.fields.battlefieldCard,
      player.boardFields.battlefield,
      player.fields.battlefield,
    );
    const card = looseCard(value, `battlefield-selected-${player.id}-${index}`);
    return card ? enrichBattlefieldCard(card, catalog) : undefined;
  });

  // The two player selections are positional. Do not collapse them if both
  // players legitimately chose the same battlefield.
  if (selected.every(Boolean)) return selected;

  for (const key of ["selectedBattlefields", "battlefields", "battlefieldCards"]) {
    const value = state.room.fields[key];
    if (value === undefined) continue;
    const candidates = looseCards(value, `battlefield-room-${key}`)
      .slice(0, 2)
      .map((card) => enrichBattlefieldCard(card, catalog));
    if (candidates.length >= 2) {
      if (!selected[0]) selected[0] = candidates[0];
      if (!selected[1]) selected[1] = candidates[1];
    } else if (candidates[0]) {
      const missingIndex = selected.findIndex((card) => !card);
      if (missingIndex >= 0) selected[missingIndex] = candidates[0];
    }
    if (selected.every(Boolean)) return selected;
  }

  // During sideboarding and battlefield selection, option lists are not
  // evidence that a battlefield was chosen. Keep unresolved ownership slots
  // empty until a per-player or room selection is actually observed.
  if (state.phase === "sideboarding" || state.phase === "battlefield_pick") return selected;

  // Option lists are diagnostic fallbacks only. Fill the corresponding
  // player's missing slot without moving the other player's selection.
  for (const [index, player] of playerOrder.entries()) {
    if (selected[index]) continue;
    const value = player.boardFields.battlefieldOptions ?? player.fields.battlefieldOptions;
    if (value === undefined) continue;
    const candidates = looseCards(value, `battlefield-options-${player.id}`)
      .map((card) => enrichBattlefieldCard(card, catalog));
    const otherSelection = selected[index === 0 ? 1 : 0];
    const otherIdentity = otherSelection ? battlefieldIdentity(otherSelection) : "";
    selected[index] = candidates.find((card) => battlefieldIdentity(card) !== otherIdentity) ?? candidates[0];
  }

  return selected;
}

export function initiativeRoll(player: ReplayPlayerState, state: ReplayState): number | undefined {
  const roomRolls = state.room.fields.initiativeRolls;
  if (isRecord(roomRolls)) {
    const direct = numberValue(roomRolls[player.id]);
    if (direct !== undefined) return direct;
    const byName = numberValue(roomRolls[player.name]);
    if (byName !== undefined) return byName;
  }
  return firstNumber(
    player.fields.initiativeRoll,
    player.fields.initiative,
    player.fields.dieRoll,
    player.boardFields.initiativeRoll,
  );
}

export function activeScene(
  replay: CanonicalReplayV2,
  state: ReplayState,
  currentMs: number,
): ReplaySceneKind {
  switch (state.phase) {
    case "matchup":
    case "lobby":
      return "matchup";
    case "battlefield_pick":
      return "battlefields";
    case "initiative_roll":
      return "initiative";
    case "first_player_choice":
      return "first_player";
    case "mulligan":
      return "mulligan";
    case "sideboarding":
      return "sideboarding";
    case "game_end":
    case "series_end":
      return "game_end";
    default:
      break;
  }

  const appliedEvents = replay.events.slice(0, Math.max(0, state.appliedEventIndex + 1));
  const lastBoundary = [...appliedEvents].reverse().find((event) => event.kind === "game_boundary");
  if (lastBoundary?.kind === "game_boundary" && lastBoundary.boundary === "end" && currentMs - lastBoundary.atMs < 2_200) {
    return "game_transition";
  }

  if (state.phase === "in_game") {
    const latestGameStart = [...appliedEvents]
      .reverse()
      .find((event) => event.kind === "phase" && event.phase === "in_game" && event.gameId === state.gameId);
    if (latestGameStart && currentMs - latestGameStart.atMs < 2_400) return "opening";
  }

  if (currentMs < 2_400 && state.appliedEventIndex <= 0) return "matchup";
  return null;
}

export function turnMarkers(replay: CanonicalReplayV2): ReplayTurnMarker[] {
  const markers: ReplayTurnMarker[] = [];
  let previousTurn: number | undefined;

  for (const event of replay.events) {
    let turn: number | undefined;
    if (event.kind === "snapshot") {
      turn = event.snapshot.room.turnNumber;
    } else if (event.kind === "action") {
      turn = firstNumber(event.action.turnNumber, event.action.turn, event.action.round);
      if (turn === undefined) {
        const roomPatch = event.patch.operations.find((operation) => operation.op === "set_room_fields");
        if (roomPatch?.op === "set_room_fields") {
          turn = firstNumber(roomPatch.fields.turnNumber, roomPatch.fields.turn, roomPatch.fields.round);
        }
      }
    }
    if (turn === undefined || turn === previousTurn) continue;
    markers.push({ turn, atMs: event.atMs, eventIndex: event.index });
    previousTurn = turn;
  }

  if (!markers.length) {
    for (const checkpoint of replay.checkpoints) {
      const turn = checkpoint.state.room.turnNumber;
      if (turn === undefined || turn === previousTurn) continue;
      markers.push({ turn, atMs: checkpoint.atMs, eventIndex: checkpoint.eventIndex });
      previousTurn = turn;
    }
  }
  return markers;
}

export function replayDurationMs(replay: CanonicalReplayV2): number {
  const finalEvent = replay.events.at(-1)?.atMs ?? 0;
  const finalCheckpoint = replay.checkpoints.at(-1)?.atMs ?? 0;
  const seriesDuration = Math.max(0, replay.series.endedAt - replay.series.startedAt);
  return Math.max(1, finalEvent, finalCheckpoint, seriesDuration);
}

export function eventLabel(event: ReplayEvent | undefined): string {
  if (!event) return "Replay ready";
  switch (event.kind) {
    case "action":
      return titleCase(event.actionType || "Action");
    case "chat":
      return event.entries.at(-1)?.text || "Chat message";
    case "log":
      return event.entries.at(-1)?.text || "Match log";
    case "interaction":
      return event.interactionType === "card_ping" ? "Card ping" : "Board emote";
    case "game_boundary":
      return `${event.boundary === "start" ? "Game" : "Game complete"} ${event.gameNumber}`;
    case "phase":
      return titleCase(event.phase);
    case "snapshot":
      return "Board synchronized";
    case "unknown":
      return titleCase(event.packetType || "Unknown event");
    default:
      return "Replay event";
  }
}

export function visibleCardFields(card: ReplayCardState): Array<[string, string]> {
  const fields: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(card.fields)) {
    if (/^(?:image|imageurl|image_url|src|arturl|art_url|analysisknowledge|analysisstatus)$/i.test(key)) continue;
    const formatted = displayValue(value);
    if (!formatted) continue;
    fields.push([titleCase(key), formatted]);
    if (fields.length >= 7) break;
  }
  return fields;
}

export function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function gameForState(replay: CanonicalReplayV2, state: ReplayState) {
  return (
    replay.series.games.find((game) => game.id === state.gameId) ??
    replay.series.games.find((game) => game.ordinal === state.gameOrdinal) ??
    replay.series.games[0]
  );
}

export function isRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function identityCard(
  player: ReplayPlayerState,
  options: { fieldCandidates: Array<JsonValue | undefined>; kind: "legend" | "champion" },
): ReplayCardState | undefined {
  const exactZone = zoneCards(player, [options.kind]).find((card) => !card.isPlaceholder);
  if (exactZone) return exactZone;

  for (const candidate of options.fieldCandidates) {
    const card = looseCard(candidate, `${player.id}-${options.kind}`);
    if (card) return card;
  }

  const movedIdentity = Object.values(player.zones)
    .flat()
    .find((card) => {
      const source = firstString(card.source, card.fields.source, card.fields.type);
      return source ? normalizeKey(source) === options.kind : false;
    });
  if (movedIdentity) return movedIdentity;

  for (const deckKey of ["deck", "submittedDeck", "registeredDeck"]) {
    const deck = player.fields[deckKey];
    if (!isRecord(deck) || !isRecord(deck.sections)) continue;
    const section = Object.entries(deck.sections).find(([key]) => normalizeKey(key) === options.kind)?.[1];
    if (section === undefined) continue;
    const card = looseCards(section, `${player.id}-${options.kind}-deck`)[0];
    if (card) return card;
  }
  return undefined;
}

function battlefieldCatalog(players: ReplayPlayerState[]): Map<string, ReplayCardState> {
  const catalog = new Map<string, ReplayCardState>();
  for (const player of players) {
    for (const deckKey of ["deck", "submittedDeck", "registeredDeck"]) {
      const deck = player.fields[deckKey];
      if (!isRecord(deck) || !isRecord(deck.sections)) continue;
      const section = Object.entries(deck.sections)
        .find(([key]) => normalizeKey(key) === "battlefields")?.[1];
      if (section === undefined) continue;
      for (const card of looseCards(section, `${player.id}-battlefield-deck`)) {
        catalog.set(normalizeKey(card.name), card);
      }
    }
  }
  return catalog;
}

function enrichBattlefieldCard(
  card: ReplayCardState,
  catalog: Map<string, ReplayCardState>,
): ReplayCardState {
  const key = normalizeKey(card.name);
  const catalogCard = catalog.get(key);
  const cardCode =
    card.cardCode ||
    catalogCard?.cardCode ||
    cardCodeFromValue(card.name) ||
    BATTLEFIELD_CARD_CODES[key];
  return {
    ...catalogCard,
    ...card,
    cardCode,
    source: "battlefield",
    fields: { ...(catalogCard?.fields ?? {}), ...card.fields },
  };
}

function battlefieldIdentity(card: ReplayCardState): string {
  return normalizeKey(card.cardCode || card.name || card.id);
}

function firstDefined(...values: Array<JsonValue | undefined>): JsonValue | undefined {
  return values.find((value) => value !== undefined && value !== null);
}

function looseCards(value: JsonValue, idPrefix: string): ReplayCardState[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => looseCards(entry, `${idPrefix}-${index}`));
  }
  const card = looseCard(value, idPrefix);
  if (card) return [card];
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, entry]) => looseCards(entry, `${idPrefix}-${key}`));
}

function looseCard(value: JsonValue | undefined, fallbackId: string): ReplayCardState | undefined {
  if (typeof value === "string") {
    if (!value.trim()) return undefined;
    return {
      id: fallbackId,
      name: value,
      cardCode: cardCodeFromValue(value),
      fields: {},
    };
  }
  if (!isRecord(value)) return undefined;
  const name = firstString(value.name, value.cardName, value.title, value.label);
  const code = firstString(value.cardCode, value.code, value.card_id, value.cardId);
  const id = firstString(value.instanceId, value.cardInstanceId, value.id) || code || fallbackId;
  if (!name && !code) return undefined;
  return {
    id,
    name: name || code || "Unknown card",
    cardCode: cardCodeFromValue(code) || code || cardCodeFromValue(name),
    isPlaceholder: value.isPlaceholder === true || value.hidden === true,
    exhausted: value.exhausted === true || value.tapped === true,
    fields: value,
  };
}

function displayValue(value: JsonValue): string {
  if (typeof value === "string") return value.length > 70 ? `${value.slice(0, 67)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.length <= 5) {
    return value.map((entry) => displayValue(entry)).filter(Boolean).join(", ");
  }
  return "";
}

function stringField(fields: JsonObject, key: string): string {
  const value = fields[key];
  return typeof value === "string" ? value : "";
}

function firstString(...values: Array<JsonValue | undefined>): string | undefined {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim();
}

function numberValue(value: JsonValue | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function firstNumber(...values: Array<JsonValue | undefined>): number | undefined {
  for (const value of values) {
    const number = numberValue(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
