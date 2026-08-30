export const MIN_REPLAY_CLIP_MS = 50;
export const DEFAULT_REPLAY_CLIP_MS = 30_000;

export type ReplayClipRange = {
  startMs: number;
  endMs: number;
};

export type ReplayLocationSelection = {
  clipRange: ReplayClipRange | null;
  initialMs: number;
};

export function replayLocationSelection(
  search: string,
  durationMs: number,
): ReplayLocationSelection {
  const boundedDurationMs = finiteNonNegativeMilliseconds(durationMs);
  const params = new URLSearchParams(search);
  const startMs = replaySecondsParameter(params, "start");
  const endMs = replaySecondsParameter(params, "end");

  if (startMs !== null && endMs !== null) {
    const clipRange = normalizeReplayClipRange({ startMs, endMs }, boundedDurationMs);
    if (clipRange) return { clipRange, initialMs: clipRange.startMs };
  }

  const legacyTimestampMs = replaySecondsParameter(params, "t");
  return {
    clipRange: null,
    initialMs: clamp(legacyTimestampMs ?? 0, 0, boundedDurationMs),
  };
}

export function normalizeReplayClipRange(
  range: ReplayClipRange,
  durationMs: number,
): ReplayClipRange | null {
  const boundedDurationMs = finiteNonNegativeMilliseconds(durationMs);
  if (!Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) return null;

  const startMs = clamp(Math.round(range.startMs), 0, boundedDurationMs);
  const endMs = clamp(Math.round(range.endMs), 0, boundedDurationMs);
  if (endMs - startMs < MIN_REPLAY_CLIP_MS) return null;
  return { startMs, endMs };
}

export function defaultReplayClipRange(
  currentMs: number,
  durationMs: number,
): ReplayClipRange | null {
  const boundedDurationMs = finiteNonNegativeMilliseconds(durationMs);
  if (boundedDurationMs < MIN_REPLAY_CLIP_MS) return null;

  const playheadMs = clamp(Math.round(currentMs), 0, boundedDurationMs);
  const startMs = Math.min(playheadMs, boundedDurationMs - MIN_REPLAY_CLIP_MS);
  const endMs = Math.min(boundedDurationMs, startMs + DEFAULT_REPLAY_CLIP_MS);
  return { startMs, endMs };
}

export function replayClipDraftFromMarkedStart(
  markedStartMs: number,
  currentMs: number,
  durationMs: number,
): ReplayClipRange | null {
  const boundedDurationMs = finiteNonNegativeMilliseconds(durationMs);
  if (!Number.isFinite(markedStartMs) || markedStartMs < 0) return null;

  const startMs = Math.round(markedStartMs);
  if (startMs > boundedDurationMs - MIN_REPLAY_CLIP_MS) return null;
  const currentEndMs = finiteNonNegativeMilliseconds(currentMs);
  const endMs = currentEndMs >= startMs + MIN_REPLAY_CLIP_MS
    ? Math.min(boundedDurationMs, currentEndMs)
    : Math.min(boundedDurationMs, startMs + DEFAULT_REPLAY_CLIP_MS);
  return normalizeReplayClipRange({ startMs, endMs }, boundedDurationMs);
}

export function replayClipUrl(
  origin: string,
  replayId: string,
  range: ReplayClipRange,
): string {
  const url = new URL(`/replays/${encodeURIComponent(replayId)}`, origin);
  url.searchParams.set("start", formatReplayClipSeconds(range.startMs));
  url.searchParams.set("end", formatReplayClipSeconds(range.endMs));
  return url.toString();
}

export function formatReplayClipSeconds(milliseconds: number): string {
  return (Math.round(milliseconds) / 1_000)
    .toFixed(3)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

export function formatReplayClipTimecode(milliseconds: number): string {
  const boundedMilliseconds = finiteNonNegativeMilliseconds(milliseconds);
  const hours = Math.floor(boundedMilliseconds / 3_600_000);
  const minutes = Math.floor((boundedMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((boundedMilliseconds % 60_000) / 1_000);
  const remainder = boundedMilliseconds % 1_000;
  const clock = `${hours ? String(minutes).padStart(2, "0") : minutes}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
  return hours ? `${hours}:${clock}` : clock;
}

export function formatReplayClipMinutesSeconds(milliseconds: number): string {
  const boundedMilliseconds = finiteNonNegativeMilliseconds(milliseconds);
  const minutes = Math.floor(boundedMilliseconds / 60_000);
  const seconds = Math.floor((boundedMilliseconds % 60_000) / 1_000);
  const remainder = boundedMilliseconds % 1_000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
}

export function parseReplayClipTimecode(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+:\d{1,2}(?:\.\d{1,3})?$/.test(normalized)) return null;

  const [minutesField, secondsField] = normalized.split(":");
  const minutes = Number(minutesField);
  const seconds = Number(secondsField);
  if (!Number.isSafeInteger(minutes) || minutes < 0 || !Number.isFinite(seconds) || seconds >= 60) {
    return null;
  }

  const milliseconds = (minutes * 60 + seconds) * 1_000;
  return Number.isSafeInteger(Math.round(milliseconds)) ? Math.round(milliseconds) : null;
}

function replaySecondsParameter(params: URLSearchParams, name: string): number | null {
  const rawValue = params.get(name);
  if (rawValue === null || rawValue.trim() === "") return null;
  const seconds = Number(rawValue);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1_000);
}

function finiteNonNegativeMilliseconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
