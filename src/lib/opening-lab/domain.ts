import {
  createInitialReplayState,
  reduceReplayEvent,
  type CanonicalReplayV2,
  type JsonObject,
  type ReplayCardState,
  type ReplayPlayerState,
  type ReplaySnapshot,
  type ReplayState,
} from "@/lib/replay-v2";
import {
  battlefieldCards,
  championCard,
  handCards,
  legendCard,
  sharedBattlefieldCard,
} from "@/components/replay-v2/model";
import {
  mulliganCardByName,
  mulliganCardMetadata,
} from "@/lib/mulligan-lab/registry";

export type OpeningMoment = { before: number; after: number; turn: number };
export type OpeningLine = {
  gameId: string;
  playerId: string;
  opponentId: string;
  legend: string;
  opponent: string;
  initiative: "first" | "second";
  moments: OpeningMoment[];
};

/** Replay permissions are checked again on every start/reveal; private never enters this pool. */
export function isOpeningSource(record: {
  status?: unknown;
  visibility?: unknown;
}): boolean {
  return (
    record.status === "ready" &&
    (record.visibility === "public" || record.visibility === "unlisted")
  );
}

const ignoredActions =
  /^(?:draw|draw_card|draw_cards|start_turn|ready|ready_all|channel|channel_runes|authoritative_patch_commit|submit_mulligan|set_phase|keepalive|ping)$/i;

/** Find the first decision of each of the perspective player's first five complete turns. */
export function extractOpeningLines(replay: CanonicalReplayV2): OpeningLine[] {
  const playerId = replay.series.perspectivePlayerId;
  const opponentId = replay.series.participants.find(
    (p) => p.id !== playerId,
  )?.id;
  if (!playerId || !opponentId || replay.series.participants.length !== 2)
    return [];
  const lines: OpeningLine[] = [];
  let state = createInitialReplayState(replay);
  let line: OpeningLine | null = null;
  let lastTurn = -1;
  let ownTurn = 0;
  let current: OpeningMoment | null = null;
  let invalid = false;
  const finish = () => {
    if (
      line &&
      !invalid &&
      line.moments.length >= 5 &&
      line.moments.slice(0, 5).every((m) => m.after > m.before)
    ) {
      const moments = line.moments
        .slice(0, 5)
        .map((moment, i, all) => ({
          ...moment,
          after: all[i + 1]?.before ?? moment.after,
        }));
      lines.push({ ...line, moments });
    }
  };
  for (let index = 0; index < replay.events.length; index++) {
    const event = replay.events[index];
    const before = state;
    // Select before applying a payment/play/pass, including a pass which ends the turn.
    if (
      line &&
      !current &&
      ownTurn >= 1 &&
      ownTurn <= 5 &&
      !line.moments.some((m) => m.turn === ownTurn) &&
      before.phase === "in_game" &&
      before.room.activeTurnPlayerId === playerId &&
      !before.chain.length &&
      event.kind === "action" &&
      event.actorPlayerId === playerId &&
      !ignoredActions.test(event.actionType)
    ) {
      const hand =
        before.players[playerId] && handCards(before.players[playerId]);
      if (!hand || hand.length === 0 || hand.some((card) => !knownCard(card)))
        invalid = true;
      else {
        current = { before: index - 1, after: -1, turn: ownTurn };
        line.moments.push(current);
      }
    }
    state = reduceReplayEvent(state, event);
    if (state.gameId !== before.gameId) {
      finish();
      line = null;
      lastTurn = -1;
      ownTurn = 0;
      current = null;
      invalid = false;
    }
    if (state.phase !== "in_game" || !state.gameId) {
      if (
        current &&
        before.phase === "in_game" &&
        state.gameId === before.gameId &&
        ["game_end", "series_end"].includes(state.phase)
      ) {
        current.after = index;
        current = null;
      }
      continue;
    }
    const turn = state.room.turnNumber;
    const first = state.room.firstPlayerId;
    if (
      !Number.isInteger(turn) ||
      !first ||
      ![playerId, opponentId].includes(first)
    )
      continue;
    if (turn !== lastTurn) {
      if (current) {
        current.after = index;
        current = null;
      }
      const expectedFirstTurn = first === playerId ? 1 : 2;
      if (lastTurn === -1 && (turn! < 1 || turn! > expectedFirstTurn))
        invalid = true;
      if (lastTurn !== -1 && turn! !== lastTurn + 1 && ownTurn <= 5)
        invalid = true;
      lastTurn = turn!;
      if (state.room.activeTurnPlayerId === playerId) ownTurn++;
    }
    if (!line) {
      const own = state.players[playerId],
        other = state.players[opponentId];
      const legend = own && knownCard(legendCard(own));
      const opponent = other && knownCard(legendCard(other));
      if (legend && opponent)
        line = {
          gameId: state.gameId,
          playerId,
          opponentId,
          legend: legend.name,
          opponent: opponent.name,
          initiative: first === playerId ? "first" : "second",
          moments: [],
        };
    }
  }
  // An unfinished final turn is deliberately not closed by end-of-file.
  finish();
  return lines.filter((l) => l.moments.every((m, i) => m.turn === i + 1));
}

function knownCard(
  card: ReplayCardState | undefined,
): { code: string; name: string; type: string } | null {
  if (!card || card.isPlaceholder) return null;
  const byCode = card.cardCode && mulliganCardMetadata(card.cardCode);
  if (byCode)
    return { code: card.cardCode!, name: byCode.name, type: byCode.type };
  const runeCodes: Record<string, string> = {
    "body rune": "OGN-126",
    "calm rune": "OGN-042",
    "chaos rune": "OGN-166",
    "fury rune": "OGN-007",
    "mind rune": "OGN-089",
    "order rune": "OGN-214",
  };
  const runeCode = runeCodes[card.name.trim().toLowerCase()];
  if (runeCode) {
    const rune = mulliganCardMetadata(runeCode);
    if (rune) return { code: runeCode, name: rune.name, type: rune.type };
  }
  const byName = mulliganCardByName(card.name);
  return byName
    ? { code: byName.cardCode, name: byName.card.name, type: byName.card.type }
    : null;
}

/** Allowlisted new snapshots, never a redacted copy of provider JSON. */
export function anonymousOpeningReplay(
  replay: CanonicalReplayV2,
  line: OpeningLine,
  moment: OpeningMoment,
  reveal: boolean,
): CanonicalReplayV2 {
  const ids = new Map<string, string>();
  const id = (value: string) => {
    if (!ids.has(value)) ids.set(value, `card-${ids.size + 1}`);
    return ids.get(value)!;
  };
  const playerId = (value: string | undefined) =>
    value === line.playerId
      ? "learner"
      : value === line.opponentId
        ? "opponent"
        : undefined;
  const sanitizeCard = (
    card: ReplayCardState,
    concealed = false,
  ): ReplayCardState => {
    const faceDown =
      card.fields.hidden === true && card.fields.revealedToOpponent !== true;
    const known =
      !concealed &&
      !(faceDown && card.ownerPlayerId !== line.playerId) &&
      knownCard(card);
    const fields: JsonObject = {};
    if (known) {
      fields.type = known.type;
      for (const key of [
        "whiteCounter",
        "redCounter",
        "damage",
        "buff",
        "power",
        "might",
        "cost",
        "energyCost",
        "powerCost",
      ]) {
        const value = card.fields[key];
        if (typeof value === "number" && Number.isFinite(value))
          fields[key] = value;
      }
      if (typeof card.fields.attachedToCardId === "string")
        fields.attachedToCardId = id(card.fields.attachedToCardId);
      if (card.fields.isDuplicate === true) fields.isDuplicate = true;
    }
    return {
      id: id(card.id),
      name: known ? known.name : "Hidden card",
      ...(known
        ? { cardCode: known.code, source: known.type }
        : { isPlaceholder: true }),
      ownerPlayerId: playerId(card.ownerPlayerId),
      exhausted: Boolean(card.exhausted),
      fields,
    };
  };
  const snapshot = (state: ReplayState): ReplaySnapshot => {
    const players: Record<string, ReplayPlayerState> = {};
    for (const originalId of [line.playerId, line.opponentId]) {
      const original = state.players[originalId];
      const alias = playerId(originalId)!;
      const zones: ReplayPlayerState["zones"] = {};
      for (const [zone, cards] of Object.entries(original.zones)) {
        // Unknown/provider-defined zones and names never cross the response boundary.
        if (
          !/^(?:hand|mainDeck|deck|runeDeck|runeArea|runes|base|battlefieldA|battlefieldB|battlefieldToken|discard|trash|banished|sideboard|legend|champion|championZone|battlefield|battlefields)$/i.test(
            zone,
          )
        )
          continue;
        const concealed =
          /deck|sideboard/i.test(zone) ||
          (originalId !== line.playerId && /hand/i.test(zone));
        zones[zone] = cards.map((c) => sanitizeCard(c, concealed));
      }
      const fields: JsonObject = {};
      const legend = legendCard(original),
        champion = championCard(original);
      if (legend) fields.legend = sanitizeCard(legend) as unknown as JsonObject;
      if (champion)
        fields.champion = sanitizeCard(champion) as unknown as JsonObject;
      const battlefields = battlefieldCards(state, {
        bottom: state.players[line.playerId],
        top: state.players[line.opponentId],
      });
      const battlefield = battlefields[originalId === line.playerId ? 0 : 1];
      if (battlefield)
        fields.selectedBattlefield = sanitizeCard(
          battlefield,
        ) as unknown as JsonObject;
      if (
        original.fields.provider === "tcga" ||
        original.boardFields.provider === "tcga"
      )
        fields.provider = "tcga";
      players[alias] = {
        id: alias,
        name: alias === "learner" ? "You" : "Opponent",
        seat: alias === "learner" ? 0 : 1,
        ...(Number.isFinite(original.score) ? { score: original.score } : {}),
        fields,
        boardFields: {},
        zones,
      };
    }
    const shared = sharedBattlefieldCard(state);
    return {
      room: {
        phase: "in_game",
        rawPhase: "in_game",
        gameNumber: 1,
        activeTurnPlayerId: playerId(state.room.activeTurnPlayerId),
        firstPlayerId: playerId(state.room.firstPlayerId),
        turnNumber: state.room.turnNumber,
        fields: shared
          ? {
              sharedBattlefieldToken: sanitizeCard(
                shared,
              ) as unknown as JsonObject,
            }
          : {},
      },
      players,
      chain: state.chain.flatMap((entry) => {
        const raw = entry.fields.card;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
        const source = {
          id: typeof raw.id === "string" ? raw.id : entry.id,
          name: typeof raw.name === "string" ? raw.name : "",
          cardCode: typeof raw.cardCode === "string" ? raw.cardCode : undefined,
          ownerPlayerId:
            typeof raw.ownerPlayerId === "string"
              ? raw.ownerPlayerId
              : undefined,
          isPlaceholder: raw.isPlaceholder === true,
          fields: raw,
        };
        if (!knownCard(source)) return [];
        const fields: JsonObject = {
          card: sanitizeCard(source) as unknown as JsonObject,
        };
        if (typeof entry.fields.sourceCardId === "string")
          fields.sourceCardId = id(entry.fields.sourceCardId);
        if (typeof entry.fields.byPlayerId === "string") {
          fields.byPlayerId = playerId(entry.fields.byPlayerId) ?? "";
          fields.byPlayerName =
            fields.byPlayerId === "learner" ? "You" : "Opponent";
        }
        return [{ id: id(entry.id), fields }];
      }),
      log: [],
    };
  };
  let state = createInitialReplayState(replay);
  const snapshots: ReplaySnapshot[] = [];
  const end = reveal ? moment.after : moment.before;
  let last = "";
  for (let i = 0; i <= end; i++) {
    state = reduceReplayEvent(state, replay.events[i]);
    if (i < moment.before) continue;
    const next = snapshot(state),
      signature = JSON.stringify(next);
    if (signature !== last) {
      snapshots.push(next);
      last = signature;
    }
  }
  if (!snapshots.length)
    throw new Error("The opening position is unavailable.");
  const events: CanonicalReplayV2["events"] = snapshots.map((value, i) => ({
    kind: "snapshot",
    id: `step-${i}`,
    index: i,
    at: i * 1000,
    atMs: i * 1000,
    sourceMessageId: `step-${i}`,
    gameId: "opening",
    snapshot: value,
  }));
  const endMs = events.at(-1)!.atMs;
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: "opening-practice",
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: "",
      roomCode: "",
      startedAt: 0,
      endedAt: endMs,
      messageCount: events.length,
    },
    series: {
      id: "opening-practice",
      perspectivePlayerId: "learner",
      format: "unknown",
      bestOf: null,
      roomCode: "",
      startedAt: 0,
      endedAt: endMs,
      participants: [
        {
          id: "learner",
          name: "You",
          isPerspective: true,
          seat: 0,
          fields: {},
        },
        {
          id: "opponent",
          name: "Opponent",
          isPerspective: false,
          seat: 1,
          fields: {},
        },
      ],
      games: [
        {
          id: "opening",
          ordinal: 1,
          gameNumber: 1,
          sourceIdentity: { explicitGameNumber: false, gameInstanceIds: [] },
          startedAt: 0,
          endedAt: endMs,
          startedAtMs: 0,
          endedAtMs: endMs,
          eventStartIndex: 0,
          eventEndIndex: events.length - 1,
          phases: [
            {
              phase: "in_game",
              rawPhase: "in_game",
              startEventIndex: 0,
              endEventIndex: events.length - 1,
              startedAtMs: 0,
              endedAtMs: endMs,
            },
          ],
        },
      ],
    },
    events,
    checkpoints: [],
    unknownEvents: [],
    diagnostics: [],
  };
}

export function recordedOpeningChanges(replay: CanonicalReplayV2): string[] {
  const snapshots = replay.events.filter((e) => e.kind === "snapshot");
  const first = snapshots[0]?.snapshot.players.learner;
  const last = snapshots.at(-1)?.snapshot.players.learner;
  if (!first || !last) return [];
  const locations = (player: ReplayPlayerState) =>
    new Map(
      Object.entries(player.zones).flatMap(([zone, cards]) =>
        cards.map((c) => [c.id, { card: c, zone }] as const),
      ),
    );
  const before = locations(first),
    after = locations(last);
  const changes: string[] = [];
  for (const [id, entry] of after) {
    const previous = before.get(id);
    if (entry.card.isPlaceholder) continue;
    if (previous && previous.zone !== entry.zone)
      changes.push(`${entry.card.name}: ${previous.zone} → ${entry.zone}`);
    else if (previous && previous.card.exhausted !== entry.card.exhausted)
      changes.push(
        `${entry.card.name}: ${entry.card.exhausted ? "exhausted" : "readied"}`,
      );
  }
  return changes.slice(0, 30);
}
