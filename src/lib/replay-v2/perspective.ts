import { isRecord, redactSecrets, stringValue, toJsonValue } from "@/lib/replay-v2/json";
import type { JsonObject, JsonValue, ParsedRawCapture } from "@/lib/replay-v2/types";

const RAW_PAYLOAD_KEY = /^(?:raw|rawtext|payloadgzipbase64|compressedpayload)$/i;
const HIDDEN_COLLECTION_KEY = /^(?:deck|decklist|decklistraw|maindeck|sideboard|hand|runedeck|cards|cardids)$/i;

export function inferPerspectivePlayerId(parsed: ParsedRawCapture): string {
  for (const packet of parsed.packets) {
    const payload = packet.payload;
    if (!payload) continue;
    const sessionDoc = isRecord(payload.sessionDoc) ? payload.sessionDoc : null;
    const snapshot = isRecord(payload.snapshot) ? payload.snapshot : null;
    const viewer = isRecord(sessionDoc?.viewer) ? sessionDoc.viewer : isRecord(snapshot?.viewer) ? snapshot.viewer : null;
    const selfPlayer = isRecord(sessionDoc?.selfPlayer) ? sessionDoc.selfPlayer : null;
    const playerId =
      stringValue(viewer?.playerId) ||
      stringValue(selfPlayer?.id) ||
      stringValue(payload.viewerPlayerId);
    if (playerId) return playerId;
  }
  return "";
}

export function sanitizeActionForPerspective(
  action: unknown,
  actorPlayerId: string,
  perspectivePlayerId: string,
): JsonObject {
  const ownAction = Boolean(actorPlayerId && perspectivePlayerId && actorPlayerId === perspectivePlayerId);
  const sanitized = sanitizeValue(action, !ownAction);
  return isJsonObject(sanitized) ? sanitized : {};
}

export function sanitizeUnknownPayload(value: unknown): JsonValue {
  return sanitizeValue(value, true);
}

export function stripHiddenParticipantFields(
  fields: JsonObject,
  participantId: string,
  perspectivePlayerId: string,
): JsonObject {
  if (perspectivePlayerId && participantId === perspectivePlayerId) return fields;
  return stripKeys(fields, true) as JsonObject;
}

function sanitizeValue(value: unknown, stripHiddenCollections: boolean): JsonValue {
  const redacted = redactSecrets(value);
  return stripKeys(redacted, stripHiddenCollections);
}

function stripKeys(value: JsonValue, stripHiddenCollections: boolean): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => stripKeys(entry, stripHiddenCollections));
  if (!isJsonObject(value)) return toJsonValue(value);
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (RAW_PAYLOAD_KEY.test(key)) return [];
      if (stripHiddenCollections && HIDDEN_COLLECTION_KEY.test(key)) return [];
      return [[key, stripKeys(entry, stripHiddenCollections)] as const];
    }),
  );
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
