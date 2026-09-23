import type {
  CanonicalReplayV2,
  ReplayCardState,
  ReplayEvent,
  ReplaySnapshot,
} from "@/lib/replay-v2";
import registry from "@/lib/mulligan-lab/card-registry-v1.json";

/** Independent synthetic fixture for privacy/turn-boundary tests only. */
export function openingTestReplay(second = false): CanonicalReplayV2 {
  const entries = Object.entries(registry.cards);
  const legends = entries.filter(([, c]) => c.type.toLowerCase() === "legend");
  const units = entries.filter(([, c]) => c.type.toLowerCase() === "unit");
  const card = (id: string, entry = units[0]): ReplayCardState => ({
    id: `secret-owner-${id}`,
    name: entry[1].name,
    cardCode: entry[0],
    fields: {
      customLabels: ["secret-room"],
      imageUrl: "https://private.invalid/secret-owner",
    },
  });
  const events: ReplayEvent[] = [];
  const add = (
    event: Omit<
      ReplayEvent,
      "id" | "index" | "at" | "atMs" | "sourceMessageId" | "gameId"
    >,
  ) => {
    const index = events.length;
    events.push({
      id: `secret-event-${index}`,
      index,
      at: 1720000000000 + index * 100,
      atMs: index * 100,
      sourceMessageId: "secret-message",
      gameId: "secret-game",
      ...event,
    } as ReplayEvent);
  };
  const own = "secret-owner",
    other = "secret-opponent";
  for (let turn = 1; turn <= (second ? 12 : 11); turn++) {
    const active = (turn % 2 === 1) !== second ? own : other;
    const snapshot: ReplaySnapshot = {
      room: {
        phase: "in_game",
        rawPhase: "in_game",
        gameNumber: 1,
        firstPlayerId: second ? other : own,
        activeTurnPlayerId: active,
        turnNumber: turn,
        fields: { roomCode: "secret-room" },
      },
      players: Object.fromEntries(
        [own, other].map((id, i) => [
          id,
          {
            id,
            name: id,
            seat: i,
            score: 0,
            fields: { uid: id },
            boardFields: { account: id },
            zones: {
              legend: [card(`legend-${i}`, legends[i])],
              hand: [0, 1, 2, 3].map((n) => card(`hand-${i}-${n}`, units[n])),
              deck: [card(`future-${i}`, units[8])],
              base: [],
            },
          },
        ]),
      ),
      chain: [],
      log: [{ id: "secret-log", text: "secret-chat", fields: {} }],
    };
    add({ kind: "snapshot", snapshot } as never);
    if (active === own)
      add({
        kind: "action",
        actionType: "move_card",
        actorPlayerId: own,
        action: { username: own },
        confirmation: {
          status: "confirmed",
          intentMessageId: "secret-intent",
          commitMessageId: "secret-commit",
        },
        patch: {
          operations: [
            {
              id: "secret-op",
              op: "zone_move",
              cardId: "secret-owner-hand-0-0",
              from: { playerId: own, zone: "hand" },
              to: { playerId: own, zone: "base", index: 0 },
            },
          ],
        },
      } as never);
  }
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: "secret-source",
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: "secret-capture",
      roomCode: "secret-room",
      startedAt: 1720000000000,
      endedAt: 1720000020000,
      messageCount: events.length,
    },
    series: {
      id: "secret-series",
      perspectivePlayerId: own,
      format: "bo1",
      bestOf: 1,
      roomCode: "secret-room",
      startedAt: 1720000000000,
      endedAt: 1720000020000,
      participants: [
        { id: own, name: own, isPerspective: true, fields: { account: own } },
        { id: other, name: other, isPerspective: false, fields: {} },
      ],
      games: [
        {
          id: "secret-game",
          ordinal: 1,
          gameNumber: 1,
          sourceIdentity: {
            explicitGameNumber: true,
            gameInstanceIds: ["secret-game"],
          },
          startedAt: 0,
          endedAt: 2000,
          startedAtMs: 0,
          endedAtMs: 2000,
          eventStartIndex: 0,
          eventEndIndex: events.length - 1,
          phases: [],
        },
      ],
    },
    events,
    checkpoints: [],
    diagnostics: [],
    unknownEvents: [],
  };
}
