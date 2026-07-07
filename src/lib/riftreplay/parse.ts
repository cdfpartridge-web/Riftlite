import type {
  RawReplayMessage,
  ReplayCard,
  ReplayDiagnostic,
  ReplayFrame,
  ReplayPlayer,
  ReplayRoomState,
  ReplayTimelineEvent,
  ReplayZone,
  RiftReplayViewModel,
} from "@/lib/riftreplay/types";
import { BATTLEFIELDS } from "@/lib/constants";

type UnknownRecord = Record<string, unknown>;

const ZONE_LABELS: Record<string, string> = {
  base: "Base",
  battlefield: "Battlefield",
  board: "Board",
  champion: "Champion",
  chain: "Chain",
  deck: "Deck",
  discard: "Discard",
  hand: "Hand",
  mainDeck: "Deck",
  played: "Played",
  removed: "Removed",
  runeDeck: "Rune deck",
  sideboard: "Sideboard",
  stack: "Stack",
  trash: "Trash",
};

const KNOWN_CARD_CODES_BY_NAME: Record<string, string> = {
  altartounity: "OGN-275",
  aspirantsclimb: "OGN-276",
  duskroselab: "UNL-209",
  targonspeak: "OGN-289",
  thearenasgreatest: "OGN-290",
  thegrandplaza: "OGN-293",
  trifarianwarcamp: "OGN-294",
  windswepthillock: "OGN-297",
  zaunwarrens: "OGN-298",
  starspring: "UNL-215",
};

export function parseRiftReplayInput(input: string): RiftReplayViewModel {
  const parsed = JSON.parse(input) as unknown;
  return parseRiftReplayPayload(parsed);
}

export function parseRiftReplayPayload(payload: unknown): RiftReplayViewModel {
  const root = asRecord(payload);
  if (!root) {
    throw new Error("Replay payload must be a JSON object.");
  }

  if (root.schema === "riftreplay-custom") {
    return parseCustomReplay(root);
  }

  const rawMessages = extractRawMessages(root);
  if (rawMessages.length) {
    return parseRawCapture(root, rawMessages);
  }

  throw new Error("That JSON does not look like a RiftLite/RiftReplay raw capture.");
}

function parseRawCapture(root: UnknownRecord, rawMessages: RawReplayMessage[]): RiftReplayViewModel {
  const capture = asRecord(root.capture);
  const identity = asRecord(capture?.identity);
  const lifecycle = asRecord(capture?.lifecycle);
  const sorted = rawMessages
    .map((message, index) => ({ ...message, seq: typeof message.seq === "number" ? message.seq : index }))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  const players = new Map<string, ReplayPlayer>();
  const zones = new Map<string, ReplayZone>();
  const timeline: ReplayTimelineEvent[] = [];
  const frames: ReplayFrame[] = [];
  const diagnostics: ReplayDiagnostic[] = [];
  const packetCounts: Record<string, number> = {};
  const roomState: ReplayRoomState = {
    initiativeRolls: {},
    mulliganPlaybackByPlayerId: {},
  };
  let lastPhase = stringValue(lifecycle?.lastPhase);
  let lastGameNumber = numberValue(lifecycle?.lastGameNumber);
  let matchFormat = "";

  const pushEvent = (event: ReplayTimelineEvent) => {
    timeline.push(event);
    frames.push(frameFromEvent(event, frames.length, players, zones, roomState));
  };

  sorted.forEach((message, index) => {
    const parsed = parseMessagePacket(message);
    if (!parsed.packet) {
      diagnostics.push({
        id: `diag-${index}`,
        severity: "warn",
        message: "Skipped an unreadable WebSocket frame.",
        context: parsed.error,
      });
      return;
    }

    const packet = parsed.packet;
    const packetType = stringValue(packet.type) || "unknown";
    packetCounts[packetType] = (packetCounts[packetType] ?? 0) + 1;

    if (packetType === "room_shell_sync") {
      const sessionDoc = asRecord(packet.sessionDoc) ?? {};
      lastPhase = stringValue(sessionDoc.phase) || lastPhase;
      lastGameNumber = numberValue(sessionDoc.gameNumber) ?? lastGameNumber;
      mergeRoomState(roomState, sessionDoc);
      matchFormat =
        stringValue(sessionDoc.matchFormat) ||
        stringValue(sessionDoc.format) ||
        stringValue(sessionDoc.queueType) ||
        matchFormat;
      collectSessionPlayers(sessionDoc, players);
      pushEvent(makeEvent(index, message, packetType, phaseLabel(lastPhase, lastGameNumber), {
        detail: roomDetail(sessionDoc),
        raw: packet,
      }));
      return;
    }

    if (packetType === "authoritative_snapshot") {
      const snapshot = asRecord(packet.snapshot);
      collectSnapshot(snapshot, players, zones);
      pushEvent(makeEvent(index, message, packetType, "Board snapshot", {
        detail: snapshotSummary(snapshot),
        raw: packet,
      }));
      return;
    }

    if (packetType === "authoritative_patch_commit") {
      const events = collectPatchEvents(index, message, packet, players);
      applyPatchCommit(packet, players, zones, roomState);
      events.forEach(pushEvent);
      return;
    }

    if (packetType === "chat_append") {
      const entry = firstRecord(packet.entries) ?? asRecord(packet.entry);
      const playerId = stringValue(entry?.authorPlayerId);
      pushEvent(
        makeEvent(index, message, packetType, "Chat message", {
          detail: stringValue(entry?.message) || stringValue(entry?.text) || "Chat update",
          playerId,
          playerName: playerId ? players.get(playerId)?.name : undefined,
          raw: packet,
        }),
      );
      return;
    }

    pushEvent(makeEvent(index, message, packetType, prettifyType(packetType), { raw: packet }));
  });

  const playerList = materializePlayers(players, zones);

  const firstSeenAt = numberValue(identity?.firstSeenAt) ?? sorted.find((message) => message.ts)?.ts;
  const lastSeenAt = numberValue(identity?.lastSeenAt) ?? [...sorted].reverse().find((message) => message.ts)?.ts;
  const roomCode = stringValue(identity?.roomCode) || inferRoomCode(sorted);
  const title = buildTitle(playerList, roomCode);

  return {
    title,
    source: "raw-capture",
    roomCode,
    captureSessionId: stringValue(capture?.captureSessionId),
    startedAt: firstSeenAt,
    endedAt: lastSeenAt,
    lastPhase,
    lastGameNumber,
    matchFormat,
    messageCount: sorted.length,
    players: playerList,
    timeline,
    frames,
    roomState: cloneRoomState(roomState),
    diagnostics,
    packetCounts,
  };
}

function parseCustomReplay(root: UnknownRecord): RiftReplayViewModel {
  const playerRecords = asRecord(root.players) ?? {};
  const cardDefs = asRecord(root.cardDefs) ?? {};
  const events = Array.isArray(root.events) ? root.events.map(asRecord).filter(isRecord) : [];
  const session = asRecord(root.session);
  const players = Object.entries(playerRecords).map(([id, value]) => {
    const player = asRecord(value) ?? {};
    return {
      id,
      name: stringValue(player.name) || id,
      role: stringValue(player.role),
      seat: numberValue(player.seat) ?? stringValue(player.seat),
      zones: [],
    } satisfies ReplayPlayer;
  });
  const timeline = events.map((event, index) =>
    makeEvent(index, { ts: numberValue(event.ts) }, stringValue(event.type) || "event", prettifyType(stringValue(event.type) || "event"), {
      detail: eventDetail(event, cardDefs),
      playerId: stringValue(event.player),
      raw: event,
    }),
  );

  return {
    title: buildTitle(players, stringValue(session?.roomKey)),
    source: "custom-replay",
    roomCode: stringValue(session?.roomKey),
    startedAt: timestampFromIso(stringValue(session?.startedAt)),
    endedAt: timestampFromIso(stringValue(session?.endedAt)),
    lastPhase: stringValue(session?.phase),
    lastGameNumber: numberValue(session?.gameNumber),
    matchFormat: stringValue(session?.matchFormat),
    messageCount: timeline.length,
    players,
    timeline,
    frames: timeline.map((event, index) => ({
      id: `frame-${index}`,
      index,
      eventId: event.id,
      ts: event.ts,
      iso: event.iso,
      label: event.label,
      packetType: event.packetType || event.type,
      players,
    })),
    diagnostics: [],
    packetCounts: countBy(timeline.map((event) => event.type)),
  };
}

function extractRawMessages(root: UnknownRecord): RawReplayMessage[] {
  if (Array.isArray(root.messages)) {
    return root.messages.map((value) => normalizeRawMessage(value)).filter(isRawReplayMessage);
  }
  const rawCheckpoint = asRecord(root.rawCheckpoint);
  if (Array.isArray(rawCheckpoint?.retainedMessages)) {
    return rawCheckpoint.retainedMessages.map((value) => normalizeRawMessage(value)).filter(isRawReplayMessage);
  }
  const capture = asRecord(root.capture);
  const checkpoint = asRecord(capture?.rawCheckpoint);
  if (Array.isArray(checkpoint?.retainedMessages)) {
    return checkpoint.retainedMessages.map((value) => normalizeRawMessage(value)).filter(isRawReplayMessage);
  }
  return [];
}

function normalizeRawMessage(value: unknown): RawReplayMessage | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    seq: numberValue(record.seq),
    ts: numberValue(record.ts),
    dir: stringValue(record.dir),
    raw: stringValue(record.raw),
    parsed: record.parsed,
    data: record.data,
  };
}

function isRawReplayMessage(value: RawReplayMessage | null): value is RawReplayMessage {
  return Boolean(value);
}

function parseMessagePacket(message: RawReplayMessage): { packet: UnknownRecord | null; error?: string } {
  const candidate = asRecord(message.parsed) ?? asRecord(message.data);
  if (candidate) return { packet: candidate };
  const raw = message.raw;
  if (!raw) return { packet: null, error: "Frame did not contain a raw string." };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return { packet: asRecord(parsed), error: asRecord(parsed) ? undefined : "Parsed frame was not an object." };
  } catch (error) {
    return { packet: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function collectSessionPlayers(sessionDoc: UnknownRecord, players: Map<string, ReplayPlayer>) {
  const directPlayers: UnknownRecord[] = [sessionDoc.selfPlayer, sessionDoc.opponentPlayer, sessionDoc.player, sessionDoc.opponent, sessionDoc.viewer]
    .map(asRecord)
    .filter(isRecord);
  const arrayPlayers = [
    ...(Array.isArray(sessionDoc.players) ? sessionDoc.players : []),
    ...(Array.isArray(sessionDoc.roomPlayers) ? sessionDoc.roomPlayers : []),
    ...(Array.isArray(sessionDoc.publicPlayers) ? sessionDoc.publicPlayers : []),
    ...(Array.isArray(sessionDoc.spectatorPlayers) ? sessionDoc.spectatorPlayers : []),
  ]
    .map(asRecord)
    .filter(isRecord);
  const publicPlayerMap = asRecord(sessionDoc.publicPlayers);
  const mappedPlayers: UnknownRecord[] = [];
  if (publicPlayerMap) {
    for (const [playerId, value] of Object.entries(publicPlayerMap)) {
      const record = asRecord(value);
      if (record) mappedPlayers.push({ ...record, id: stringValue(record.id) || playerId });
    }
  }

  for (const player of [...directPlayers, ...arrayPlayers, ...mappedPlayers]) {
    const id = stringValue(player.id) || stringValue(player.playerId) || stringValue(player.uid);
    if (!id) continue;
    const entry = ensurePlayer(players, id);
    entry.name = stringValue(player.name) || stringValue(player.displayName) || entry.name;
    entry.role = stringValue(player.role) || entry.role;
    entry.seat = numberValue(player.seat) ?? stringValue(player.seat) ?? entry.seat;
    const legend = firstSectionCard(player, ["legend"]);
    const battlefieldOptions = uniqueByName([...sectionCards(player, ["battlefield", "battlefields"]), ...fieldCards(player.battlefieldOptions, `${id}-battlefield-option`)]);
    const selectedBattlefield = selectedBattlefieldCard(player.selectedBattlefield, entry, battlefieldOptions, `${id}-battlefield`);
    if (legend) entry.legend = legend;
    if (battlefieldOptions.length) entry.battlefieldOptions = battlefieldOptions;
    if (selectedBattlefield) {
      entry.battlefield = selectedBattlefield;
      entry.selectedBattlefieldName = selectedBattlefield.name;
    }
  }
}

function collectSnapshot(snapshot: UnknownRecord | null, players: Map<string, ReplayPlayer>, zones: Map<string, ReplayZone>) {
  const snapshotPlayers = Array.isArray(snapshot?.players) ? snapshot.players.map(asRecord).filter(isRecord) : [];
  for (const player of snapshotPlayers) {
    const id = stringValue(player.id) || stringValue(player.playerId);
    if (!id) continue;
    const entry = ensurePlayer(players, id);
    entry.name = stringValue(player.name) || entry.name;
    entry.score = numberValue(asRecord(player.board)?.score) ?? numberValue(player.score) ?? entry.score;
    const board = asRecord(player.board);
    if (!board) continue;
    clearPlayerZones(zones, id);
    for (const [zoneKey, zoneValue] of Object.entries(board)) {
      if (!Array.isArray(zoneValue)) continue;
      const cards = zoneValue.map((card, index) => cardFromUnknown(card, `${id}-${zoneKey}-${index}`)).filter(isReplayCard);
      const hidden = zoneValue.length - cards.length;
      const zoneId = `${id}:${zoneKey}`;
      zones.set(zoneId, {
        id: zoneId,
        name: ZONE_LABELS[zoneKey] ?? prettifyType(zoneKey),
        visibility: zoneVisibility(zoneKey),
        hidden,
        cards,
      });
      const normalizedZone = normalizeZoneKey(zoneKey);
      if (normalizedZone === "legend" && cards[0]) {
        entry.legend = cards[0];
      }
    }
  }
}

function applyPatchCommit(
  packet: UnknownRecord,
  players: Map<string, ReplayPlayer>,
  zones: Map<string, ReplayZone>,
  roomState: ReplayRoomState,
) {
  for (const op of patchOperations(packet)) {
    const opKind = stringValue(op.op) || stringValue(op.type) || "patch";
    if (opKind === "set_room_fields") {
      mergeRoomState(roomState, asRecord(op.fields) ?? op);
      continue;
    }

    if (opKind === "set_player_fields") {
      const playerId = stringValue(op.playerId);
      const fields = asRecord(op.fields);
      if (playerId && fields) {
        const entry = ensurePlayer(players, playerId);
        entry.name = stringValue(fields.name) || stringValue(fields.displayName) || entry.name;
        entry.score = numberValue(fields.score) ?? entry.score;
        const options = entry.battlefieldOptions ?? [];
        const selectedBattlefield = selectedBattlefieldCard(fields.selectedBattlefield, entry, options, `${playerId}-battlefield`);
        if (selectedBattlefield) {
          entry.battlefield = selectedBattlefield;
          entry.selectedBattlefieldName = selectedBattlefield.name;
        }
      }
      continue;
    }

    if (opKind === "zone_insert") {
      const playerId = stringValue(op.playerId) || stringValue(op.ownerPlayerId);
      const zone = stringValue(op.zone);
      const rawCards = Array.isArray(op.cards) ? op.cards : [];
      const cards = rawCards
        .map((card, index) => cardFromUnknown(card, `${playerId}-${zone}-insert-${index}`))
        .filter(isReplayCard);
      if (playerId && zone) {
        ensurePlayer(players, playerId);
        if (cards.length) {
          addCardsToZone(zones, playerId, zone, cards);
        }
        const hiddenCards = rawCards.length - cards.length;
        if (hiddenCards > 0) {
          addHiddenToZone(zones, playerId, zone, hiddenCards);
        }
      }
      continue;
    }

    if (opKind === "zone_remove") {
      const playerId = stringValue(op.playerId) || stringValue(op.ownerPlayerId);
      const zone = stringValue(op.zone);
      const cardIds = Array.isArray(op.cardIds) ? op.cardIds.map(stringValue).filter(isNonEmptyString) : [];
      if (playerId && zone) {
        ensurePlayer(players, playerId);
        if (cardIds.length) {
          for (const cardId of cardIds) {
            removeCardFromZone(zones, playerId, zone, null, cardId);
          }
        } else {
          const card = cardFromUnknown(op.card, stringValue(op.cardId) || `remove-${Math.random().toString(36).slice(2)}`);
          removeCardFromZone(zones, playerId, zone, card, stringValue(op.cardId));
        }
      }
      continue;
    }

    if (opKind === "zone_move") {
      const from = asRecord(op.from);
      const to = asRecord(op.to);
      const card = cardFromUnknown(op.card, stringValue(op.cardId) || `move-${Math.random().toString(36).slice(2)}`);
      const playerId =
        stringValue(to?.playerId) ||
        stringValue(from?.playerId) ||
        stringValue(op.playerId) ||
        stringValue(card?.ownerId);
      const fromZone = stringValue(from?.zone) || stringValue(op.fromZone);
      const toZone = stringValue(to?.zone) || stringValue(op.toZone) || stringValue(op.zone);
      if (!playerId) continue;
      ensurePlayer(players, playerId);
      if (fromZone) {
        removeCardFromZone(zones, playerId, fromZone, card, stringValue(op.cardId));
      } else if (card || stringValue(op.cardId)) {
        removeCardFromAnyZone(zones, playerId, card, stringValue(op.cardId));
      }
      if (toZone && card) {
        addCardsToZone(zones, playerId, toZone, [card]);
      }
      continue;
    }

    if (opKind === "chain_insert") {
      for (const [entryIndex, entryValue] of (Array.isArray(op.entries) ? op.entries : []).entries()) {
        const entry = asRecord(entryValue);
        if (!entry) continue;
        const card = cardFromUnknown(entry.card, `chain-${entryIndex}`);
        const playerId = stringValue(entry.byPlayerId) || stringValue(entry.playerId) || stringValue(card?.ownerId);
        if (playerId && card) {
          ensurePlayer(players, playerId);
          addCardsToZone(zones, playerId, "chain", [card]);
        }
      }
      continue;
    }

    if (opKind === "chain_remove") {
      const entryIds = Array.isArray(op.entryIds) ? op.entryIds.map(stringValue).filter(isNonEmptyString) : [];
      for (const [zoneId, zone] of zones) {
        if (!zoneId.endsWith(":chain")) continue;
        const nextCards = entryIds.length
          ? zone.cards.filter((card) => !entryIds.some((entryId) => card.id === entryId || card.id.includes(entryId)))
          : zone.cards.slice(1);
        zones.set(zoneId, { ...zone, cards: nextCards });
      }
      continue;
    }

    if (opKind === "set_board_fields") {
      const playerId = stringValue(op.playerId);
      const fields = asRecord(op.fields);
      const score = numberValue(fields?.score);
      if (playerId && score !== undefined) {
        ensurePlayer(players, playerId).score = score;
      }
    }
  }
}

function collectPatchEvents(
  index: number,
  message: RawReplayMessage,
  packet: UnknownRecord,
  players: Map<string, ReplayPlayer>,
): ReplayTimelineEvent[] {
  const operations = patchOperations(packet);

  if (!operations.length) {
    return [makeEvent(index, message, "authoritative_patch_commit", "Patch committed", { raw: packet })];
  }

  const logEvents = operations.flatMap((op, opIndex) => {
    const opName = stringValue(op.op) || stringValue(op.type) || "patch";
    if (opName !== "log_insert") return [];
    const entries = Array.isArray(op.entries) ? op.entries.map(asRecord).filter(isRecord) : [asRecord(op.entry)].filter(isRecord);
    return entries.map((entry, entryIndex) => {
      const playerId = stringValue(entry.playerId) || stringValue(entry.actorPlayerId) || stringValue(entry.authorPlayerId);
      const detail = stringValue(entry.message) || stringValue(entry.text) || stringValue(entry.label) || "Log entry";
      const card = cardFromUnknown(entry.card, `${index}-${opIndex}-${entryIndex}`);
      return makeEvent(index + opIndex / 100 + entryIndex / 1000, message, "log_insert", detail, {
        playerId,
        playerName: playerId ? players.get(playerId)?.name : undefined,
        cardName: card?.name,
        raw: entry,
      });
    });
  });

  const stateEvents = operations
    .filter((op) => {
      const opName = stringValue(op.op) || stringValue(op.type) || "patch";
      return !["log_insert", "log_remove", "set_room_fields", "set_player_fields"].includes(opName);
    })
    .slice(0, 12)
    .map((op, opIndex) => {
    const opName = stringValue(op.op) || stringValue(op.type) || "patch";
    const from = asRecord(op.from);
    const to = asRecord(op.to);
    const entry = firstRecord(op.entries);
    const playerId =
      stringValue(op.playerId) ||
      stringValue(op.toPlayerId) ||
      stringValue(op.fromPlayerId) ||
      stringValue(to?.playerId) ||
      stringValue(from?.playerId) ||
      stringValue(entry?.byPlayerId);
    const card = cardFromUnknown(op.card, `${index}-${opIndex}`) ?? cardFromUnknown(entry?.card, `${index}-${opIndex}`);
    const zone = stringValue(op.zone) || stringValue(op.toZone) || stringValue(op.fromZone) || stringValue(to?.zone) || stringValue(from?.zone);
    return makeEvent(index + opIndex / 100, message, opName, patchLabel(opName, card, zone), {
      detail: patchDetail(op),
      playerId,
      playerName: playerId ? players.get(playerId)?.name : undefined,
      cardName: card?.name,
      zone,
      raw: op,
    });
  });
  return [...logEvents, ...stateEvents];
}

function patchOperations(packet: UnknownRecord): UnknownRecord[] {
  const patch = asRecord(packet.patch);
  return [
    ...(Array.isArray(packet.ops) ? packet.ops : []),
    ...(Array.isArray(packet.operations) ? packet.operations : []),
    ...(Array.isArray(packet.patch) ? packet.patch : []),
    ...(Array.isArray(patch?.operations) ? patch.operations : []),
    ...(Array.isArray(patch?.ops) ? patch.ops : []),
  ].map(asRecord).filter(isRecord);
}

function cardFromUnknown(value: unknown, fallbackId: string): ReplayCard | null {
  if (typeof value === "string") {
    const name = value.trim();
    return name ? enrichReplayCard({ id: fallbackId, name }) : null;
  }
  const record = asRecord(value);
  if (!record || record.isPlaceholder === true) return null;
  const nested = asRecord(record.card) ?? asRecord(record.cardDef) ?? asRecord(record.definition) ?? asRecord(record.proto);
  const source = { ...(nested ?? {}), ...record };
  const name =
    stringValue(source.name) ||
    stringValue(source.cardName) ||
    stringValue(source.title) ||
    stringValue(source.displayName) ||
    stringValue(source.cardId) ||
    stringValue(source.id);
  if (!name) return null;
  const id = stringValue(source.id) || stringValue(source.instanceId) || stringValue(source.cardId) || fallbackId;
  const code = stringValue(source.cardCode) || stringValue(source.code) || stringValue(source.variantNumber);
  return enrichReplayCard({
    id,
    name,
    imageUrl: findImageUrl(source) || imageUrlFromCardCode(code),
    type: stringValue(source.type) || stringValue(source.cardType),
    ownerId: stringValue(source.ownerPlayerId) || stringValue(source.ownerId),
    code,
  });
}

function firstSectionCard(player: UnknownRecord, sectionNames: string[]) {
  return sectionCards(player, sectionNames)[0];
}

function sectionCards(player: UnknownRecord, sectionNames: string[]) {
  const sections =
    asRecord(asRecord(player.deck)?.sections) ??
    asRecord(asRecord(player.submittedDeck)?.sections) ??
    asRecord(player.deckSections) ??
    asRecord(player.sections);
  if (!sections) return [];
  const normalizedNames = sectionNames.map(normalizeZoneKey);
  const cards: ReplayCard[] = [];
  for (const [sectionName, value] of Object.entries(sections)) {
    if (!normalizedNames.includes(normalizeZoneKey(sectionName))) continue;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        const card = cardFromUnknown(entry, `${sectionName}-${index}`);
        if (card) cards.push(card);
      });
      continue;
    }
    const record = asRecord(value);
    const sectionCardsValue = record?.cards ?? record?.entries ?? record?.items;
    if (Array.isArray(sectionCardsValue)) {
      sectionCardsValue.forEach((entry, index) => {
        const card = cardFromUnknown(entry, `${sectionName}-${index}`);
        if (card) cards.push(card);
      });
    }
  }
  return uniqueByName(cards);
}

function fieldCards(value: unknown, fallbackPrefix: string) {
  if (!Array.isArray(value)) return [];
  return uniqueByName(
    value
      .map((entry, index) => cardFromUnknown(entry, `${fallbackPrefix}-${index}`))
      .filter(isReplayCard),
  );
}

function selectedBattlefieldCard(
  value: unknown,
  player: ReplayPlayer,
  battlefieldOptions: ReplayCard[],
  fallbackId: string,
) {
  const selected = cardFromUnknown(value, fallbackId);
  const selectedName = selected?.name || stringValue(value);
  if (!selectedName) return null;
  const normalizedSelected = normalizeZoneKey(selectedName);
  const matchedOption =
    battlefieldOptions.find((card) => normalizeZoneKey(card.name) === normalizedSelected) ??
    player.battlefieldOptions?.find((card) => normalizeZoneKey(card.name) === normalizedSelected);
  if (matchedOption) return enrichReplayCard(matchedOption);
  const enriched = enrichReplayCard(selected);
  if (enriched && isBattlefieldCard(enriched)) return enriched;
  return null;
}

function enrichReplayCard(card: ReplayCard | null): ReplayCard | null {
  if (!card) return null;
  const normalizedName = normalizeZoneKey(card.name);
  const code = card.code || KNOWN_CARD_CODES_BY_NAME[normalizedName];
  return {
    ...card,
    code,
    imageUrl: card.imageUrl || imageUrlFromCardCode(code),
  };
}

function uniqueByName(cards: ReplayCard[]) {
  const seen = new Set<string>();
  const result: ReplayCard[] = [];
  for (const card of cards) {
    const key = normalizeZoneKey(card.name || card.code || card.id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(card);
  }
  return result;
}

function isBattlefieldCard(card: ReplayCard) {
  const normalizedName = normalizeZoneKey(card.name);
  const normalizedType = normalizeZoneKey(card.type ?? "");
  return (
    normalizedType.includes("battlefield") ||
    Boolean(KNOWN_CARD_CODES_BY_NAME[normalizedName]) ||
    BATTLEFIELDS.some((name) => normalizeZoneKey(name) === normalizedName)
  );
}

function mergeRoomState(roomState: ReplayRoomState, fields: UnknownRecord | null) {
  if (!fields) return;
  roomState.phase = stringValue(fields.phase) || roomState.phase;
  roomState.firstPlayerId = stringValue(fields.firstPlayerId) || roomState.firstPlayerId;
  roomState.activeTurnPlayerId = stringValue(fields.activeTurnPlayerId) || roomState.activeTurnPlayerId;

  const initiativeRolls = asRecord(fields.initiativeRolls);
  if (initiativeRolls) {
    roomState.initiativeRolls = {
      ...(roomState.initiativeRolls ?? {}),
      ...Object.fromEntries(
        Object.entries(initiativeRolls)
          .map(([playerId, value]) => [playerId, numberValue(value)] as const)
          .filter((entry): entry is readonly [string, number] => entry[1] !== undefined),
      ),
    };
  }

  const mulliganPlaybackByPlayerId = asRecord(fields.mulliganPlaybackByPlayerId);
  if (mulliganPlaybackByPlayerId) {
    roomState.mulliganPlaybackByPlayerId = {
      ...(roomState.mulliganPlaybackByPlayerId ?? {}),
      ...mulliganPlaybackByPlayerId,
    };
  }
}

function cloneRoomState(roomState: ReplayRoomState): ReplayRoomState {
  return {
    ...roomState,
    initiativeRolls: { ...(roomState.initiativeRolls ?? {}) },
    mulliganPlaybackByPlayerId: { ...(roomState.mulliganPlaybackByPlayerId ?? {}) },
  };
}

function findImageUrl(source: UnknownRecord): string | undefined {
  const direct = [
    source.imageUrl,
    source.image_url,
    source.cardImageUrl,
    source.thumbnailUrl,
    source.artUrl,
    source.img,
  ]
    .map(stringValue)
    .find((value) => value.startsWith("http") || value.startsWith("/"));
  if (direct) return normalizeImageUrl(direct);
  const variants = source.variantImages;
  if (Array.isArray(variants)) {
    const variant = variants.map(stringValue).find((value) => value.startsWith("http") || value.startsWith("/"));
    if (variant) return normalizeImageUrl(variant);
  }
  return undefined;
}

function normalizeImageUrl(value: string) {
  if (value.startsWith("http")) return value;
  if (value.startsWith("/")) return `https://play.riftatlas.com${value}`;
  return value;
}

function imageUrlFromCardCode(code?: string) {
  if (!code) return undefined;
  return `https://cdn.piltoverarchive.com/cards/${encodeURIComponent(code)}.webp`;
}

function groupZonesByPlayer(zones: Map<string, ReplayZone>) {
  const grouped = new Map<string, ReplayZone[]>();
  for (const [zoneId, zone] of zones) {
    const [playerId] = zoneId.split(":");
    const list = grouped.get(playerId) ?? [];
    list.push(zone);
    grouped.set(playerId, list);
  }
  for (const [, list] of grouped) {
    list.sort((a, b) => zoneSort(a.name) - zoneSort(b.name) || a.name.localeCompare(b.name));
  }
  return grouped;
}

function materializePlayers(players: Map<string, ReplayPlayer>, zones: Map<string, ReplayZone>): ReplayPlayer[] {
  const zoneListByPlayer = groupZonesByPlayer(zones);
  for (const [playerId, playerZones] of zoneListByPlayer) {
    const player = ensurePlayer(players, playerId);
    player.zones = playerZones;
  }
  return Array.from(players.values()).map((player) => ({
    ...player,
    legend: player.legend ? { ...player.legend } : undefined,
    battlefield: player.battlefield ? { ...player.battlefield } : undefined,
    battlefieldOptions: player.battlefieldOptions?.map((card) => ({ ...card })),
    zones: cloneZones(zoneListByPlayer.get(player.id) ?? player.zones ?? []),
  }));
}

function frameFromEvent(
  event: ReplayTimelineEvent,
  index: number,
  players: Map<string, ReplayPlayer>,
  zones: Map<string, ReplayZone>,
  roomState: ReplayRoomState,
): ReplayFrame {
  return {
    id: `frame-${index}-${event.id}`,
    index,
    eventId: event.id,
    ts: event.ts,
    iso: event.iso,
    label: event.label,
    packetType: event.packetType || event.type,
    players: materializePlayers(players, zones),
    roomState: cloneRoomState(roomState),
  };
}

function clearPlayerZones(zones: Map<string, ReplayZone>, playerId: string) {
  for (const zoneId of Array.from(zones.keys())) {
    if (zoneId.startsWith(`${playerId}:`)) {
      zones.delete(zoneId);
    }
  }
}

function addCardsToZone(zones: Map<string, ReplayZone>, playerId: string, zoneKey: string, cards: ReplayCard[]) {
  const zoneId = `${playerId}:${zoneKey}`;
  const existing = zones.get(zoneId) ?? {
    id: zoneId,
    name: ZONE_LABELS[zoneKey] ?? prettifyType(zoneKey),
    visibility: zoneVisibility(zoneKey),
    hidden: 0,
    cards: [],
  };
  if (existing.visibility === "hidden") {
    zones.set(zoneId, { ...existing, hidden: existing.hidden + cards.length });
    return;
  }
  const nextCards = [...existing.cards];
  for (const card of cards) {
    if (!nextCards.some((existingCard) => sameCardIdentity(existingCard, card))) {
      nextCards.push(card);
    }
  }
  zones.set(zoneId, { ...existing, cards: nextCards });
}

function addHiddenToZone(zones: Map<string, ReplayZone>, playerId: string, zoneKey: string, count: number) {
  const zoneId = `${playerId}:${zoneKey}`;
  const existing = zones.get(zoneId) ?? {
    id: zoneId,
    name: ZONE_LABELS[zoneKey] ?? prettifyType(zoneKey),
    visibility: zoneVisibility(zoneKey),
    hidden: 0,
    cards: [],
  };
  zones.set(zoneId, { ...existing, hidden: existing.hidden + count });
}

function removeCardFromZone(
  zones: Map<string, ReplayZone>,
  playerId: string,
  zoneKey: string,
  card: ReplayCard | null,
  fallbackId?: string,
) {
  const zoneId = `${playerId}:${zoneKey}`;
  const zone = zones.get(zoneId);
  if (!zone) return;
  if (zone.visibility === "hidden") {
    zones.set(zoneId, { ...zone, hidden: Math.max(0, zone.hidden - 1) });
    return;
  }
  const nextCards = removeOneCard(zone.cards, card, fallbackId);
  zones.set(zoneId, {
    ...zone,
    cards: nextCards,
    hidden: nextCards.length === zone.cards.length && zone.hidden > 0 ? Math.max(0, zone.hidden - 1) : zone.hidden,
  });
}

function removeCardFromAnyZone(
  zones: Map<string, ReplayZone>,
  playerId: string,
  card: ReplayCard | null,
  fallbackId?: string,
) {
  for (const [zoneId, zone] of zones) {
    if (!zoneId.startsWith(`${playerId}:`)) continue;
    const nextCards = removeOneCard(zone.cards, card, fallbackId);
    if (nextCards.length !== zone.cards.length) {
      zones.set(zoneId, { ...zone, cards: nextCards });
      return;
    }
  }
}

function removeOneCard(cards: ReplayCard[], card: ReplayCard | null, fallbackId?: string) {
  const index = cards.findIndex((existing) => {
    if (card && sameCardIdentity(existing, card)) return true;
    return Boolean(fallbackId && (existing.id === fallbackId || existing.code === fallbackId));
  });
  if (index < 0) return cards;
  return cards.filter((_, itemIndex) => itemIndex !== index);
}

function sameCardIdentity(a: ReplayCard, b: ReplayCard) {
  return Boolean(
    (a.id && b.id && a.id === b.id) ||
      (a.code && b.code && a.code === b.code && a.name === b.name) ||
      (a.name && b.name && a.name === b.name && a.imageUrl === b.imageUrl),
  );
}

function cloneZones(zones: ReplayZone[]): ReplayZone[] {
  return zones.map((zone) => ({
    ...zone,
    cards: zone.cards.map((card) => ({ ...card })),
  }));
}

function ensurePlayer(players: Map<string, ReplayPlayer>, id: string): ReplayPlayer {
  const existing = players.get(id);
  if (existing) return existing;
  const player: ReplayPlayer = { id, name: `Player ${players.size + 1}`, zones: [] };
  players.set(id, player);
  return player;
}

function makeEvent(
  index: number,
  message: Pick<RawReplayMessage, "ts">,
  type: string,
  label: string,
  extra: Partial<ReplayTimelineEvent> = {},
): ReplayTimelineEvent {
  const ts = message.ts;
  return {
    id: `event-${index}-${type}`,
    index,
    ts,
    iso: ts ? new Date(ts).toISOString() : undefined,
    type,
    label,
    packetType: type,
    ...extra,
  };
}

function eventDetail(event: UnknownRecord, cardDefs: UnknownRecord) {
  const data = asRecord(event.data);
  const text = stringValue(data?.text) || stringValue(data?.message);
  if (text) return text;
  const cardIds = Array.isArray(data?.cardIds) ? data.cardIds.map(stringValue).filter(isNonEmptyString) : [];
  if (cardIds.length) {
    const names = cardIds.map((id) => stringValue(asRecord(cardDefs[id])?.name) || id);
    return names.join(", ");
  }
  return undefined;
}

function patchLabel(opName: string, card: ReplayCard | null, zone?: string) {
  const verb = prettifyType(opName.replace(/^zone[.:_-]?/i, ""));
  if (card && zone) return `${card.name} → ${ZONE_LABELS[zone] ?? prettifyType(zone)}`;
  if (card) return `${verb}: ${card.name}`;
  if (zone) return `${verb}: ${ZONE_LABELS[zone] ?? prettifyType(zone)}`;
  return prettifyType(opName);
}

function patchDetail(op: UnknownRecord) {
  const parts = [
    stringValue(op.fromZone) ? `from ${ZONE_LABELS[stringValue(op.fromZone)] ?? prettifyType(stringValue(op.fromZone))}` : "",
    stringValue(op.toZone) ? `to ${ZONE_LABELS[stringValue(op.toZone)] ?? prettifyType(stringValue(op.toZone))}` : "",
    Array.isArray(op.cardIds) ? `${op.cardIds.length} card${op.cardIds.length === 1 ? "" : "s"}` : "",
  ].filter(isNonEmptyString);
  return parts.join(" · ") || undefined;
}

function roomDetail(sessionDoc: UnknownRecord) {
  const bits = [
    stringValue(sessionDoc.phase),
    stringValue(sessionDoc.matchFormat) || stringValue(sessionDoc.format),
    numberValue(sessionDoc.gameNumber) ? `Game ${numberValue(sessionDoc.gameNumber)}` : "",
  ].filter(isNonEmptyString);
  return bits.join(" · ");
}

function phaseLabel(phase?: string, gameNumber?: number) {
  const game = gameNumber ? `Game ${gameNumber}` : "Room";
  return `${game}: ${phase ? prettifyType(phase) : "state update"}`;
}

function snapshotSummary(snapshot: UnknownRecord | null) {
  const players = Array.isArray(snapshot?.players) ? snapshot.players.length : 0;
  const active = stringValue(snapshot?.activeTurnPlayerId);
  return `${players} player${players === 1 ? "" : "s"}${active ? ` · active player ${active}` : ""}`;
}

function buildTitle(players: ReplayPlayer[], roomCode?: string) {
  const names = players.map((player) => player.name).filter((name) => !/^Player \d+$/.test(name));
  if (names.length >= 2) return `${names[0]} vs ${names[1]}`;
  if (names.length === 1) return `${names[0]} replay`;
  return roomCode ? `Room ${roomCode}` : "RiftReplay capture";
}

function inferRoomCode(messages: RawReplayMessage[]) {
  for (const message of messages) {
    const parsed = parseMessagePacket(message).packet;
    const sessionDoc = asRecord(parsed?.sessionDoc);
    const roomCode = stringValue(sessionDoc?.roomCode) || stringValue(parsed?.roomCode);
    if (roomCode) return roomCode;
  }
  return undefined;
}

function zoneVisibility(zoneName: string): ReplayZone["visibility"] {
  const normalized = zoneName.toLowerCase();
  if (normalized.includes("deck")) return "hidden";
  if (normalized.includes("hand")) return "private";
  return "public";
}

function zoneSort(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes("champion")) return 1;
  if (normalized.includes("battlefield")) return 2;
  if (normalized.includes("board")) return 3;
  if (normalized.includes("base")) return 4;
  if (normalized.includes("chain") || normalized.includes("stack")) return 5;
  if (normalized.includes("trash") || normalized.includes("discard")) return 6;
  if (normalized.includes("hand")) return 7;
  if (normalized.includes("deck")) return 8;
  return 20;
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function prettifyType(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_:.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function normalizeZoneKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function firstRecord(value: unknown) {
  return Array.isArray(value) ? value.map(asRecord).find(Boolean) : null;
}

function timestampFromIso(value?: string) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function isRecord(value: UnknownRecord | null): value is UnknownRecord {
  return Boolean(value);
}

function isReplayCard(value: ReplayCard | null): value is ReplayCard {
  return Boolean(value);
}

function isNonEmptyString(value: string): value is string {
  return Boolean(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
