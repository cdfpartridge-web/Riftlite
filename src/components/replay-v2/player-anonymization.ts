import type {
  CanonicalReplayV2,
  JsonObject,
  JsonValue,
  ReplayPlayerState,
  ReplayState,
} from "@/lib/replay-v2";

const EXACT_PLAYER_NAME_KEYS = new Set([
  "actorName",
  "author",
  "displayName",
  "opponentName",
  "playerName",
  "targetPlayerName",
  "username",
]);

const PLAYER_TEXT_KEYS = new Set([
  "description",
  "detail",
  "label",
  "message",
  "text",
  "title",
]);

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceNamesInText(value: string, aliases: ReadonlyMap<string, string>): string {
  let next = value;
  const names = Array.from(aliases.keys()).filter(Boolean).sort((left, right) => right.length - left.length);
  for (const name of names) {
    const alias = aliases.get(name);
    if (!alias) continue;
    next = next.replace(
      new RegExp(`(^|[^\\p{L}\\p{N}_])(${escapedRegExp(name)})(?=$|[^\\p{L}\\p{N}_])`, "giu"),
      (_match, prefix: string) => `${prefix}${alias}`,
    );
  }
  return next;
}

function exactAlias(value: string, aliases: ReadonlyMap<string, string>): string | null {
  const normalized = value.trim().toLocaleLowerCase();
  for (const [name, alias] of aliases) {
    if (name.trim().toLocaleLowerCase() === normalized) return alias;
  }
  return null;
}

function anonymizeJsonValue(
  value: JsonValue,
  aliases: ReadonlyMap<string, string>,
  key = "",
): JsonValue {
  if (typeof value === "string") {
    if (EXACT_PLAYER_NAME_KEYS.has(key)) return exactAlias(value, aliases) ?? value;
    if (PLAYER_TEXT_KEYS.has(key)) return replaceNamesInText(value, aliases);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => anonymizeJsonValue(entry, aliases));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      anonymizeJsonValue(entryValue, aliases, entryKey),
    ]),
  ) as JsonObject;
}

function anonymizePlayers(
  players: Record<string, ReplayPlayerState>,
  aliasesById: ReadonlyMap<string, string>,
  aliasesByName: ReadonlyMap<string, string>,
): Record<string, ReplayPlayerState> {
  return Object.fromEntries(Object.entries(players).map(([key, player]) => [key, {
    ...player,
    name: aliasesById.get(player.id) ?? exactAlias(player.name, aliasesByName) ?? player.name,
    fields: anonymizeJsonValue(player.fields, aliasesByName) as JsonObject,
    boardFields: anonymizeJsonValue(player.boardFields, aliasesByName) as JsonObject,
    zones: Object.fromEntries(Object.entries(player.zones).map(([zone, cards]) => [zone, cards.map((card) => ({
      ...card,
      fields: anonymizeJsonValue(card.fields, aliasesByName) as JsonObject,
    }))])),
  }]));
}

function anonymizeState(
  state: ReplayState,
  aliasesById: ReadonlyMap<string, string>,
  aliasesByName: ReadonlyMap<string, string>,
): ReplayState {
  const transformed = anonymizeJsonValue(state as unknown as JsonValue, aliasesByName) as unknown as ReplayState;
  return {
    ...transformed,
    players: anonymizePlayers(transformed.players, aliasesById, aliasesByName),
  };
}

/**
 * Returns a display-only copy. Participant identifiers and authorization data are
 * deliberately retained so replay projection remains deterministic.
 */
export function anonymizeReplayPlayerNames(replay: CanonicalReplayV2): CanonicalReplayV2 {
  const aliasesById = new Map<string, string>();
  const aliasesByName = new Map<string, string>();
  replay.series.participants.forEach((participant, index) => {
    const alias = `Player ${index + 1}`;
    aliasesById.set(participant.id, alias);
    if (participant.name.trim()) aliasesByName.set(participant.name, alias);
  });

  const transformed = anonymizeJsonValue(replay as unknown as JsonValue, aliasesByName) as unknown as CanonicalReplayV2;
  return {
    ...transformed,
    series: {
      ...transformed.series,
      participants: transformed.series.participants.map((participant) => ({
        ...participant,
        name: aliasesById.get(participant.id) ?? exactAlias(participant.name, aliasesByName) ?? participant.name,
      })),
    },
    events: transformed.events.map((event) => event.kind === "snapshot"
      ? {
          ...event,
          snapshot: {
            ...event.snapshot,
            players: anonymizePlayers(event.snapshot.players, aliasesById, aliasesByName),
          },
        }
      : event),
    checkpoints: transformed.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      state: anonymizeState(checkpoint.state, aliasesById, aliasesByName),
    })),
  };
}
