import type { CanonicalReplayV2 } from "@/lib/replay-v2";
import type { ReplayRecord } from "@/lib/replay-v2-server/model";

const PRIVATE_ROOM_IDENTITY_KEY = /^(?:(?:previous[\s_-]?)?room[\s_-]?code|game[\s_-]?instance[\s_-]?ids?)$/i;

export function sanitizeCanonicalReplay(replay: CanonicalReplayV2): CanonicalReplayV2 {
  const sanitized = stripRoomCodeFields(replacePrivateIdentityValues(replay, privateIdentityAliases(replay)));
  return {
    ...sanitized,
    source: {
      ...sanitized.source,
      captureSessionId: "",
      roomCode: "",
    },
    series: {
      ...sanitized.series,
      roomCode: "",
      games: sanitized.series.games.map((game) => ({
        ...game,
        sourceIdentity: {
          ...game.sourceIdentity,
          gameInstanceIds: [],
        },
      })),
    },
  };
}

function privateIdentityAliases(replay: CanonicalReplayV2): string[] {
  return Array.from(new Set([
    replay.source.captureSessionId,
    replay.source.roomCode,
    replay.series.roomCode,
    ...replay.series.games.flatMap((game) => game.sourceIdentity.gameInstanceIds),
  ].filter((value) => typeof value === "string" && value.length >= 3)))
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function replacePrivateIdentityValues<T>(value: T, aliases: string[]): T {
  if (!aliases.length) return value;
  if (typeof value === "string") {
    return aliases.reduce(
      (result, alias, index) => result.replace(
        new RegExp(escapeRegExp(alias), "gi"),
        `[private-${index + 1}]`,
      ),
      value,
    ) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => replacePrivateIdentityValues(entry, aliases)) as T;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      replacePrivateIdentityValues(entry, aliases),
    ]),
  ) as T;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function projectReplaySummaryRecord(record: ReplayRecord, ownerView: boolean): Record<string, unknown> {
  return {
    replayId: record.replayId,
    ...(ownerView ? { captureId: record.captureId } : {}),
    visibility: record.visibility,
    status: record.status,
    title: record.title,
    platform: record.platform,
    ...(ownerView ? { roomCode: record.roomCode } : {}),
    messageCount: record.messageCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(ownerView && record.failure ? { failure: record.failure } : {}),
  };
}

function stripRoomCodeFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripRoomCodeFields(entry)) as T;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PRIVATE_ROOM_IDENTITY_KEY.test(key))
      .map(([key, entry]) => [key, stripRoomCodeFields(entry)]),
  ) as T;
}
