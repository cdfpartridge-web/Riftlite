export const REPLAY_NOTES_STORAGE_PREFIX = "riftlite:replay-notes:v1:";
export const REPLAY_NOTES_SCHEMA = "riftlite-replay-notes" as const;
export const REPLAY_NOTES_VERSION = 1 as const;

const MAX_REPLAY_ID_LENGTH = 160;
const MAX_NOTE_ID_LENGTH = 180;
const MAX_NOTE_TITLE_LENGTH = 160;
const MAX_NOTE_BODY_LENGTH = 4_000;
export const MAX_REPLAY_NOTES = 250;

export type ReplayNote = {
  id: string;
  atMs: number;
  eventId: string;
  eventIndex: number;
  gameId: string;
  gameNumber: number | null;
  turn: number | null;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
};

export type ReplayNoteInput = Partial<Omit<ReplayNote, "atMs">> & { atMs: number };

export type ReplayNotesProjectV1 = {
  schema: typeof REPLAY_NOTES_SCHEMA;
  version: typeof REPLAY_NOTES_VERSION;
  replayId: string;
  notes: ReplayNote[];
  updatedAt: number;
};

export type ReplayNotesStorage = Pick<Storage, "getItem" | "setItem">;

export function replayNotesStorageKey(replayId: string): string {
  return `${REPLAY_NOTES_STORAGE_PREFIX}${encodeURIComponent(cleanText(replayId, MAX_REPLAY_ID_LENGTH))}`;
}

export function createReplayNotesProject(replayId: string): ReplayNotesProjectV1 {
  return {
    schema: REPLAY_NOTES_SCHEMA,
    version: REPLAY_NOTES_VERSION,
    replayId: cleanText(replayId, MAX_REPLAY_ID_LENGTH),
    notes: [],
    updatedAt: 0,
  };
}

export function parseReplayNotesProject(value: unknown, replayId: string): ReplayNotesProjectV1 {
  const empty = createReplayNotesProject(replayId);
  const decoded = decodeStoredValue(value);
  if (!isRecord(decoded)) return empty;
  if (decoded.version !== REPLAY_NOTES_VERSION) return empty;
  if (decoded.schema !== undefined && decoded.schema !== REPLAY_NOTES_SCHEMA) return empty;
  const storedReplayId = cleanText(decoded.replayId, MAX_REPLAY_ID_LENGTH);
  if (storedReplayId && storedReplayId !== empty.replayId) return empty;

  const usedIds = new Set<string>();
  const candidates = Array.isArray(decoded.notes) ? decoded.notes.slice(0, MAX_REPLAY_NOTES) : [];
  const notes = candidates.flatMap((candidate, index) => {
    const note = sanitizeReplayNote(candidate, empty.replayId, index, usedIds);
    return note ? [note] : [];
  });
  return {
    ...empty,
    notes: sortReplayNotes(notes),
    updatedAt: nonNegativeInteger(decoded.updatedAt) ?? 0,
  };
}

export function addReplayNote(
  project: ReplayNotesProjectV1,
  input: ReplayNoteInput,
): ReplayNotesProjectV1 {
  const current = parseReplayNotesProject(project, project.replayId);
  if (current.notes.length >= MAX_REPLAY_NOTES) return current;
  const now = nonNegativeInteger(input.createdAt) ?? Date.now();
  const usedIds = new Set(current.notes.map((note) => note.id));
  const note = sanitizeReplayNote(
    { ...input, createdAt: now, updatedAt: nonNegativeInteger(input.updatedAt) ?? now },
    current.replayId,
    current.notes.length,
    usedIds,
  );
  if (!note || (!note.title && !note.body)) return current;
  return {
    ...current,
    notes: sortReplayNotes([...current.notes, note]),
    updatedAt: Math.max(current.updatedAt, note.updatedAt),
  };
}

export function updateReplayNote(
  project: ReplayNotesProjectV1,
  id: string,
  patch: Partial<Omit<ReplayNote, "id" | "createdAt">>,
): ReplayNotesProjectV1 {
  const current = parseReplayNotesProject(project, project.replayId);
  const targetId = cleanText(id, MAX_NOTE_ID_LENGTH);
  const targetIndex = current.notes.findIndex((note) => note.id === targetId);
  if (targetIndex < 0) return current;
  const existing = current.notes[targetIndex];
  const usedIds = new Set(current.notes.filter((_, index) => index !== targetIndex).map((note) => note.id));
  const updatedAt = nonNegativeInteger(patch.updatedAt) ?? Date.now();
  const updated = sanitizeReplayNote(
    { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt, updatedAt },
    current.replayId,
    targetIndex,
    usedIds,
  );
  if (!updated || (!updated.title && !updated.body)) return current;
  return {
    ...current,
    notes: sortReplayNotes(current.notes.map((note, index) => index === targetIndex ? updated : note)),
    updatedAt: Math.max(current.updatedAt, updatedAt),
  };
}

export function deleteReplayNote(project: ReplayNotesProjectV1, id: string): ReplayNotesProjectV1 {
  const current = parseReplayNotesProject(project, project.replayId);
  const targetId = cleanText(id, MAX_NOTE_ID_LENGTH);
  const notes = current.notes.filter((note) => note.id !== targetId);
  if (notes.length === current.notes.length) return current;
  return { ...current, notes, updatedAt: Math.max(current.updatedAt, Date.now()) };
}

export function loadReplayNotesProject(
  replayId: string,
  storage: ReplayNotesStorage | null = browserStorage(),
): ReplayNotesProjectV1 {
  if (!storage) return createReplayNotesProject(replayId);
  try {
    return parseReplayNotesProject(storage.getItem(replayNotesStorageKey(replayId)), replayId);
  } catch {
    return createReplayNotesProject(replayId);
  }
}

export function saveReplayNotesProject(
  project: ReplayNotesProjectV1,
  storage: ReplayNotesStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const current = parseReplayNotesProject(project, project.replayId);
  try {
    storage.setItem(replayNotesStorageKey(current.replayId), JSON.stringify(current));
    return true;
  } catch {
    return false;
  }
}

export function replayNoteLabel(note: ReplayNote): string {
  return note.title || note.body.split(/\r?\n/, 1)[0]?.trim() || "Replay note";
}

function sanitizeReplayNote(
  value: unknown,
  replayId: string,
  sourceIndex: number,
  usedIds: Set<string>,
): ReplayNote | null {
  if (!isRecord(value)) return null;
  const atMs = nonNegativeInteger(value.atMs);
  if (atMs === null) return null;
  const createdAt = nonNegativeInteger(value.createdAt) ?? 0;
  const updatedAt = nonNegativeInteger(value.updatedAt) ?? createdAt;
  const eventId = cleanText(value.eventId, MAX_NOTE_ID_LENGTH);
  const eventIndex = integerAtLeast(value.eventIndex, -1) ?? -1;
  const gameId = cleanText(value.gameId, MAX_NOTE_ID_LENGTH);
  const gameNumber = positiveInteger(value.gameNumber);
  const turn = nonNegativeInteger(value.turn);
  const title = cleanText(value.title, MAX_NOTE_TITLE_LENGTH);
  const body = cleanText(value.body, MAX_NOTE_BODY_LENGTH, true);
  const fallbackId = stableNoteId(`${replayId}|${atMs}|${createdAt}|${sourceIndex}|${title}|${body}`);
  const requestedId = cleanText(value.id, MAX_NOTE_ID_LENGTH) || fallbackId;
  const id = uniqueNoteId(requestedId, usedIds);
  usedIds.add(id);
  return {
    id,
    atMs,
    eventId,
    eventIndex,
    gameId,
    gameNumber,
    turn,
    title,
    body,
    createdAt,
    updatedAt,
  };
}

function sortReplayNotes(notes: ReplayNote[]): ReplayNote[] {
  return [...notes].sort((left, right) => (
    left.atMs - right.atMs || left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  ));
}

function uniqueNoteId(requestedId: string, usedIds: Set<string>): string {
  if (!usedIds.has(requestedId)) return requestedId;
  let suffix = 2;
  while (usedIds.has(`${requestedId}-${suffix}`)) suffix += 1;
  return `${requestedId}-${suffix}`;
}

function stableNoteId(seed: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `note-${(hash >>> 0).toString(36)}`;
}

function decodeStoredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function cleanText(value: unknown, maxLength: number, preserveNewlines = false): string {
  if (typeof value !== "string") return "";
  const normalized = preserveNewlines
    ? value.replace(/\r\n?/g, "\n").replace(/[\t\f\v ]+/g, " ").trim()
    : value.replace(/\s+/g, " ").trim();
  return normalized.slice(0, maxLength);
}

function integerAtLeast(value: unknown, minimum: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(minimum, Math.trunc(value));
}

function nonNegativeInteger(value: unknown): number | null {
  return integerAtLeast(value, 0);
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const number = Math.trunc(value);
  return number >= 1 ? number : null;
}

function browserStorage(): ReplayNotesStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
