import {
  finiteNumber,
  integerValue,
  isRecord,
  stringValue,
  toJsonObject,
  toJsonValue,
} from "@/lib/replay-v2/json";
import { stableId } from "@/lib/replay-v2/stable-id";
import type {
  JsonObject,
  ParsedRawCapture,
  ParsedReplayPacket,
  RawCaptureMessageV1,
  RawCaptureV1,
  RawReplayDirection,
  ReplayDiagnostic,
} from "@/lib/replay-v2/types";

export const MAX_RAW_CAPTURE_MESSAGES = 50_000;

export function parseRawCaptureV1(input: unknown): ParsedRawCapture {
  if (!isRecord(input)) {
    throw new Error("Replay capture must be a JSON object.");
  }
  if (input.schema !== "riftreplay-raw-capture" || input.version !== 1) {
    throw new Error("Replay capture must use riftreplay-raw-capture version 1.");
  }
  if (!Array.isArray(input.messages)) {
    throw new Error("Replay capture must contain a messages array.");
  }
  if (input.messages.length > MAX_RAW_CAPTURE_MESSAGES) {
    throw new Error(`Replay capture cannot contain more than ${MAX_RAW_CAPTURE_MESSAGES} messages.`);
  }

  const capture = isRecord(input.capture) ? input.capture : {};
  const identity = isRecord(capture.identity) ? capture.identity : {};
  const lifecycle = isRecord(capture.lifecycle) ? capture.lifecycle : {};
  const messages = input.messages.map(normalizeSourceMessage);
  const explicitCaptureId = stringValue(capture.captureSessionId);
  const captureId =
    explicitCaptureId ||
    stableId(
      "capture",
      identity,
      messages.length,
      messages[0]?.raw ?? messages[0]?.parsed ?? messages[0]?.data ?? null,
      messages.at(-1)?.raw ?? messages.at(-1)?.parsed ?? messages.at(-1)?.data ?? null,
    );

  const diagnostics: ReplayDiagnostic[] = [];
  const pendingPackets = messages.map((message, sourceIndex) =>
    parseMessage(message, sourceIndex, captureId, diagnostics),
  );
  pendingPackets.sort((left, right) => left.seq - right.seq || left.sourceIndex - right.sourceIndex);

  const earliestPacketTimestamp = minimumPositiveTimestamp(pendingPackets.map((packet) => packet.at));
  const identityStartedAt = finiteNumber(identity.firstSeenAt);
  const startedAt = identityStartedAt ?? earliestPacketTimestamp ?? 0;
  let previousAt = startedAt;
  let previousAtMs = 0;
  const packets: ParsedReplayPacket[] = pendingPackets.map((packet, order) => {
    const sourceAt = packet.at > 0 ? packet.at : previousAt;
    const at = Math.max(previousAt, sourceAt);
    const atMs = Math.max(previousAtMs, Math.max(0, at - startedAt));
    previousAt = at;
    previousAtMs = atMs;
    return { ...packet, order, at, atMs };
  });

  const roomCode = stringValue(identity.roomCode) || inferRoomCode(packets);
  const explicitSeriesIdentity =
    stringValue(identity.seriesId) ||
    stringValue(identity.matchId) ||
    stringValue(identity.replayId);
  const seriesIdentity = explicitSeriesIdentity || stableId("series", captureId, roomCode);
  const lifecycleEndedAt = finiteNumber(identity.lastSeenAt) ?? finiteNumber(lifecycle.endedAt);
  const endedAt = lifecycleEndedAt ?? packets.at(-1)?.at ?? startedAt;

  const source: RawCaptureV1 = {
    schema: "riftreplay-raw-capture",
    version: 1,
    capture: {
      captureSessionId: explicitCaptureId || captureId,
      identity,
      lifecycle,
    },
    messages,
    ...(isRecord(input.meta) ? { meta: input.meta } : {}),
  };

  return {
    captureId,
    roomCode,
    seriesIdentity,
    startedAt,
    endedAt: Math.max(startedAt, endedAt),
    packets,
    diagnostics,
    source,
  };
}

export function minimumPositiveTimestamp(values: Iterable<number>): number | undefined {
  let minimum: number | undefined;
  for (const value of values) {
    if (!(value > 0) || !Number.isFinite(value)) continue;
    if (minimum === undefined || value < minimum) minimum = value;
  }
  return minimum;
}

function normalizeSourceMessage(value: unknown): RawCaptureMessageV1 {
  if (!isRecord(value)) return {};
  return {
    ...(integerValue(value.seq) !== undefined ? { seq: integerValue(value.seq) } : {}),
    ...(finiteNumber(value.ts) !== undefined ? { ts: finiteNumber(value.ts) } : {}),
    ...(typeof value.dir === "string" ? { dir: value.dir } : {}),
    ...(typeof value.raw === "string" ? { raw: value.raw } : {}),
    ...(value.parsed !== undefined ? { parsed: value.parsed } : {}),
    ...(value.data !== undefined ? { data: value.data } : {}),
  };
}

function parseMessage(
  message: RawCaptureMessageV1,
  sourceIndex: number,
  captureId: string,
  diagnostics: ReplayDiagnostic[],
): ParsedReplayPacket {
  const seq = integerValue(message.seq) ?? sourceIndex;
  const at = finiteNumber(message.ts) ?? 0;
  const direction = normalizeDirection(message.dir);
  const raw = sourceRaw(message);
  let payload: JsonObject | null = null;
  let parseError = "";

  const providedPayload = message.parsed ?? message.data;
  if (isRecord(providedPayload)) {
    payload = toJsonObject(providedPayload);
  } else if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isRecord(parsed)) payload = toJsonObject(parsed);
      else parseError = "Message JSON was not an object.";
    } catch {
      parseError = "Message contained malformed JSON.";
    }
  } else {
    parseError = "Message did not contain raw or parsed packet data.";
  }

  const packetType = stringValue(payload?.type) || (parseError ? "malformed" : "unknown");
  const id = stableId("packet", captureId, sourceIndex, seq, at, direction, raw || payload);
  if (parseError) {
    diagnostics.push({
      id: stableId("diagnostic", id, "malformed_packet"),
      severity: "warning",
      code: "malformed_packet",
      message: parseError,
      sourceMessageId: id,
    });
  }

  return {
    id,
    order: sourceIndex,
    sourceIndex,
    seq,
    at,
    atMs: 0,
    direction,
    packetType,
    payload,
    raw,
    ...(parseError ? { parseError } : {}),
  };
}

function sourceRaw(message: RawCaptureMessageV1): string {
  if (typeof message.raw === "string") return message.raw;
  if (message.parsed !== undefined) return JSON.stringify(toJsonValue(message.parsed));
  if (message.data !== undefined) return JSON.stringify(toJsonValue(message.data));
  return "";
}

function normalizeDirection(value: unknown): RawReplayDirection {
  if (value === "in" || value === "out") return value;
  return "unknown";
}

function inferRoomCode(packets: ParsedReplayPacket[]): string {
  for (const packet of packets) {
    const payload = packet.payload;
    if (!payload) continue;
    const sessionDoc = isRecord(payload.sessionDoc) ? payload.sessionDoc : null;
    const snapshot = isRecord(payload.snapshot) ? payload.snapshot : null;
    const value =
      stringValue(payload.roomCode) ||
      stringValue(sessionDoc?.roomCode) ||
      stringValue(snapshot?.roomCode) ||
      stringValue(payload.gameInstanceId);
    if (value) return value;
  }
  return "";
}
