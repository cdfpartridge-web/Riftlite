import { eventIndexAtTime, type CanonicalReplayV2 } from "@/lib/replay-v2";

export const CASTER_PROJECT_STORAGE_PREFIX = "riftlite:caster-project:v1:";
export const CASTER_PROJECT_SCHEMA = "riftlite-caster-project" as const;
export const CASTER_PROJECT_VERSION = 1 as const;

const MAX_REPLAY_ID_LENGTH = 160;
const MAX_ANCHOR_ID_LENGTH = 180;
const MAX_BOOKMARK_TITLE_LENGTH = 160;
const MAX_BOOKMARK_NOTE_LENGTH = 4_000;

export type CasterBookmark = {
  id: string;
  eventId: string;
  eventIndex: number;
  atMs: number;
  gameId: string;
  gameNumber: number | null;
  turn: number | null;
  title: string;
  note: string;
  createdAt: number;
};

export type CasterProjectV1 = {
  schema: typeof CASTER_PROJECT_SCHEMA;
  version: typeof CASTER_PROJECT_VERSION;
  replayId: string;
  bookmarks: CasterBookmark[];
  updatedAt: number;
};

export type CasterBookmarkInput = {
  id?: string;
  eventId?: string;
  eventIndex?: number;
  atMs: number;
  gameId?: string;
  gameNumber?: number | null;
  turn?: number | null;
  title?: string;
  note?: string;
  createdAt?: number;
};

export type CasterBookmarkPatch = Partial<
  Omit<CasterBookmark, "id" | "createdAt">
>;

export type CasterProjectStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function casterProjectStorageKey(replayId: string): string {
  return `${CASTER_PROJECT_STORAGE_PREFIX}${encodeURIComponent(cleanReplayId(replayId))}`;
}

export function createCasterProject(replayId: string): CasterProjectV1 {
  return {
    schema: CASTER_PROJECT_SCHEMA,
    version: CASTER_PROJECT_VERSION,
    replayId: cleanReplayId(replayId),
    bookmarks: [],
    updatedAt: 0,
  };
}

/**
 * Parses either a localStorage JSON string or an already decoded value. Bad,
 * cross-replay, and future-version data intentionally becomes an empty project.
 */
export function parseCasterProject(value: unknown, replayId: string): CasterProjectV1 {
  const empty = createCasterProject(replayId);
  const decoded = decodeStoredValue(value);
  if (!isRecord(decoded)) return empty;
  if (decoded.version !== CASTER_PROJECT_VERSION) return empty;
  if (decoded.schema !== undefined && decoded.schema !== CASTER_PROJECT_SCHEMA) return empty;

  const storedReplayId = cleanText(decoded.replayId, MAX_REPLAY_ID_LENGTH);
  if (storedReplayId && storedReplayId !== empty.replayId) return empty;

  const rawBookmarks = Array.isArray(decoded.bookmarks) ? decoded.bookmarks : [];
  const usedIds = new Set<string>();
  const bookmarks = rawBookmarks.flatMap((candidate, index) => {
    const bookmark = sanitizeBookmark(candidate, empty.replayId, index, usedIds);
    return bookmark ? [bookmark] : [];
  });
  const updatedAt = nonNegativeInteger(decoded.updatedAt) ?? 0;

  return {
    ...empty,
    bookmarks: sortCasterBookmarks(bookmarks),
    updatedAt: Math.max(updatedAt, ...bookmarks.map((bookmark) => bookmark.createdAt), 0),
  };
}

export function addCasterBookmark(
  project: CasterProjectV1,
  input: CasterBookmarkInput,
): CasterProjectV1 {
  const current = parseCasterProject(project, project.replayId);
  const usedIds = new Set(current.bookmarks.map((bookmark) => bookmark.id));
  const createdAt = nonNegativeInteger(input.createdAt) ?? Date.now();
  const bookmark = sanitizeBookmark(
    { ...input, createdAt },
    current.replayId,
    current.bookmarks.length,
    usedIds,
  );
  if (!bookmark) return current;
  return {
    ...current,
    bookmarks: sortCasterBookmarks([...current.bookmarks, bookmark]),
    updatedAt: Math.max(current.updatedAt, createdAt, Date.now()),
  };
}

export function updateCasterBookmark(
  project: CasterProjectV1,
  id: string,
  patch: CasterBookmarkPatch,
): CasterProjectV1 {
  const current = parseCasterProject(project, project.replayId);
  const targetId = cleanText(id, MAX_ANCHOR_ID_LENGTH);
  const targetIndex = current.bookmarks.findIndex((bookmark) => bookmark.id === targetId);
  if (targetIndex < 0) return current;

  const existing = current.bookmarks[targetIndex];
  const usedIds = new Set(
    current.bookmarks
      .filter((_, index) => index !== targetIndex)
      .map((bookmark) => bookmark.id),
  );
  const updated = sanitizeBookmark(
    { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt },
    current.replayId,
    targetIndex,
    usedIds,
  );
  if (!updated) return current;

  return {
    ...current,
    bookmarks: sortCasterBookmarks(
      current.bookmarks.map((bookmark, index) => index === targetIndex ? updated : bookmark),
    ),
    updatedAt: Math.max(current.updatedAt, Date.now()),
  };
}

export function deleteCasterBookmark(
  project: CasterProjectV1,
  id: string,
): CasterProjectV1 {
  const current = parseCasterProject(project, project.replayId);
  const targetId = cleanText(id, MAX_ANCHOR_ID_LENGTH);
  const bookmarks = current.bookmarks.filter((bookmark) => bookmark.id !== targetId);
  if (bookmarks.length === current.bookmarks.length) return current;
  return {
    ...current,
    bookmarks,
    updatedAt: Math.max(current.updatedAt, Date.now()),
  };
}

/** Resolve against regenerated replays without trusting a stale array index. */
export function resolveCasterBookmarkEventIndex(
  bookmark: CasterBookmark,
  replay: Pick<CanonicalReplayV2, "events">,
): number {
  if (bookmark.eventId) {
    const matchingIndex = replay.events.findIndex((event) => event.id === bookmark.eventId);
    if (matchingIndex >= 0) return matchingIndex;
  }
  return eventIndexAtTime(replay, bookmark.atMs);
}

/** Produces text ready to paste into a YouTube description. */
export function casterYouTubeChapters(
  project: CasterProjectV1,
  openerTitle = "Replay start",
): string {
  const current = parseCasterProject(project, project.replayId);
  const bookmarks = sortCasterBookmarks(current.bookmarks);
  const zeroBookmark = bookmarks.find((bookmark) => chapterSecond(bookmark.atMs) === 0);
  const lines = [
    `00:00 ${zeroBookmark ? bookmarkChapterTitle(zeroBookmark) : cleanChapterTitle(openerTitle, "Replay start")}`,
  ];
  const usedSeconds = new Set([0]);

  for (const bookmark of bookmarks) {
    const second = chapterSecond(bookmark.atMs);
    if (usedSeconds.has(second)) continue;
    usedSeconds.add(second);
    lines.push(`${formatChapterTime(second)} ${bookmarkChapterTitle(bookmark)}`);
  }
  return lines.join("\n");
}

export function loadCasterProject(
  replayId: string,
  storage: CasterProjectStorage | null = browserStorage(),
): CasterProjectV1 {
  if (!storage) return createCasterProject(replayId);
  try {
    return parseCasterProject(storage.getItem(casterProjectStorageKey(replayId)), replayId);
  } catch {
    return createCasterProject(replayId);
  }
}

export function saveCasterProject(
  project: CasterProjectV1,
  storage: CasterProjectStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const current = parseCasterProject(project, project.replayId);
  try {
    storage.setItem(casterProjectStorageKey(current.replayId), JSON.stringify(current));
    return true;
  } catch {
    return false;
  }
}

export function clearCasterProject(
  replayId: string,
  storage: CasterProjectStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(casterProjectStorageKey(replayId));
    return true;
  } catch {
    return false;
  }
}

function sortCasterBookmarks(bookmarks: CasterBookmark[]): CasterBookmark[] {
  return [...bookmarks].sort((left, right) => (
    left.atMs - right.atMs ||
    left.eventIndex - right.eventIndex ||
    left.createdAt - right.createdAt ||
    left.id.localeCompare(right.id)
  ));
}

function sanitizeBookmark(
  value: unknown,
  replayId: string,
  sourceIndex: number,
  usedIds: Set<string>,
): CasterBookmark | null {
  if (!isRecord(value)) return null;
  const atMs = nonNegativeInteger(value.atMs);
  if (atMs === null) return null;

  const eventId = cleanText(value.eventId, MAX_ANCHOR_ID_LENGTH);
  const eventIndex = integerAtLeast(value.eventIndex, -1) ?? -1;
  const gameId = cleanText(value.gameId, MAX_ANCHOR_ID_LENGTH);
  const gameNumber = positiveInteger(value.gameNumber);
  const turn = nonNegativeInteger(value.turn);
  const title = cleanText(value.title, MAX_BOOKMARK_TITLE_LENGTH);
  const note = cleanText(value.note, MAX_BOOKMARK_NOTE_LENGTH, true);
  const createdAt = nonNegativeInteger(value.createdAt) ?? 0;
  const fallbackSeed = [
    replayId,
    eventId,
    eventIndex,
    atMs,
    gameId,
    gameNumber ?? "",
    turn ?? "",
    createdAt,
    sourceIndex,
  ].join("|");
  const requestedId = cleanText(value.id, MAX_ANCHOR_ID_LENGTH) || stableBookmarkId(fallbackSeed);
  const id = uniqueBookmarkId(requestedId, usedIds);
  usedIds.add(id);

  return {
    id,
    eventId,
    eventIndex,
    atMs,
    gameId,
    gameNumber,
    turn,
    title,
    note,
    createdAt,
  };
}

function uniqueBookmarkId(requestedId: string, usedIds: Set<string>): string {
  if (!usedIds.has(requestedId)) return requestedId;
  let suffix = 2;
  while (usedIds.has(`${requestedId}-${suffix}`)) suffix += 1;
  return `${requestedId}-${suffix}`;
}

function stableBookmarkId(seed: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `bookmark-${(hash >>> 0).toString(36)}`;
}

function bookmarkChapterTitle(bookmark: CasterBookmark): string {
  if (bookmark.title) return cleanChapterTitle(bookmark.title, "Replay moment");
  const noteFirstLine = bookmark.note.split(/\r?\n/, 1)[0];
  if (noteFirstLine) return cleanChapterTitle(noteFirstLine, "Replay moment");
  const context = [
    bookmark.gameNumber ? `Game ${bookmark.gameNumber}` : "",
    bookmark.turn !== null ? `Turn ${bookmark.turn}` : "",
  ].filter(Boolean);
  return context.join(" · ") || "Replay moment";
}

function cleanChapterTitle(value: string, fallback: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_BOOKMARK_TITLE_LENGTH) || fallback;
}

function chapterSecond(atMs: number): number {
  return Math.max(0, Math.floor(atMs / 1_000));
}

function formatChapterTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function decodeStoredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function cleanReplayId(value: unknown): string {
  return cleanText(value, MAX_REPLAY_ID_LENGTH);
}

function cleanText(value: unknown, maxLength: number, preserveNewlines = false): string {
  if (typeof value !== "string") return "";
  const normalized = preserveNewlines
    ? value.replace(/\r\n?/g, "\n").replace(/[\t\f\v ]+/g, " ").trim()
    : value.replace(/\s+/g, " ").trim();
  return normalized.slice(0, maxLength);
}

function integerAtLeast(value: unknown, minimum: number): number | null {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number)) return null;
  return Math.max(minimum, Math.trunc(number));
}

function nonNegativeInteger(value: unknown): number | null {
  return integerAtLeast(value, 0);
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const number = Math.trunc(value);
  return number >= 1 ? number : null;
}

function browserStorage(): CasterProjectStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
