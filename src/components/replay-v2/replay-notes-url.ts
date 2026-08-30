export const SHARED_REPLAY_NOTES_VERSION = 1 as const;
export const SHARED_REPLAY_NOTES_HASH_PARAM = "rn";
export const MAX_SHARED_REPLAY_NOTES = 25;
export const MAX_SHARED_REPLAY_NOTE_TITLE_LENGTH = 160;
export const MAX_SHARED_REPLAY_NOTE_BODY_LENGTH = 4_000;
export const MAX_SHARED_REPLAY_NOTES_JSON_BYTES = 5_500;
export const MAX_SHARED_REPLAY_NOTES_PAYLOAD_LENGTH = 7_500;
export const MAX_SHARED_REPLAY_NOTES_URL_BYTES = 8_192;

const MAX_REPLAY_ID_LENGTH = 160;

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_VALUES = new Map(
  [...BASE64URL_ALPHABET].map((character, index) => [character, index]),
);

export type SharedReplayNote = {
  atMs: number;
  title: string;
  body: string;
};

type ReplayNoteDedupeInput = Pick<SharedReplayNote, "atMs" | "title" | "body">;

type SharedReplayNotesEnvelopeV1 = {
  v: typeof SHARED_REPLAY_NOTES_VERSION;
  r: string;
  n: Array<[atMs: number, title: string, body: string]>;
};

/**
 * Returns the codec's canonical identity for a local or shared replay note.
 * This applies the same Unicode, whitespace, and newline normalization as URL
 * encoding so imports cannot miss an equivalent note with different source
 * text. Invalid or empty notes do not have a shareable identity.
 */
export function canonicalReplayNoteDedupeKey(note: ReplayNoteDedupeInput): string | null {
  const sanitized = sanitizeSharedReplayNote(note);
  return sanitized
    ? JSON.stringify([sanitized.atMs, sanitized.title, sanitized.body])
    : null;
}

/**
 * Produces a canonical, URL-fragment-safe payload. Notes are sorted so callers do
 * not need to maintain a particular order. Invalid or oversized input returns
 * null instead of producing a partially shared set of notes.
 */
export function encodeSharedReplayNotesPayload(
  replayId: string,
  notes: readonly SharedReplayNote[],
): string | null {
  if (!validReplayId(replayId)) return null;
  const sanitizedNotes = sanitizeSharedReplayNotes(notes);
  if (!sanitizedNotes) return null;

  const envelope: SharedReplayNotesEnvelopeV1 = {
    v: SHARED_REPLAY_NOTES_VERSION,
    r: replayId,
    n: sanitizedNotes.map((note) => [note.atMs, note.title, note.body]),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));
  if (bytes.byteLength > MAX_SHARED_REPLAY_NOTES_JSON_BYTES) return null;

  const encoded = encodeBase64Url(bytes);
  return encoded.length <= MAX_SHARED_REPLAY_NOTES_PAYLOAD_LENGTH ? encoded : null;
}

/**
 * Decodes only canonical v1 payloads. Returning null distinguishes malformed,
 * unsupported, and oversized input from a valid payload containing no notes.
 */
export function decodeSharedReplayNotesPayload(
  payload: string,
  replayId: string,
): SharedReplayNote[] | null {
  if (
    !validReplayId(replayId) ||
    typeof payload !== "string" ||
    !payload ||
    payload.length > MAX_SHARED_REPLAY_NOTES_PAYLOAD_LENGTH
  ) {
    return null;
  }

  const bytes = decodeBase64Url(payload);
  if (!bytes || bytes.byteLength > MAX_SHARED_REPLAY_NOTES_JSON_BYTES) return null;

  let decoded: unknown;
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    decoded = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  if (!isSharedReplayNotesEnvelopeV1(decoded) || decoded.r !== replayId) return null;

  const notes = decoded.n.map(([atMs, title, body]) => ({ atMs, title, body }));
  const sanitizedNotes = sanitizeSharedReplayNotes(notes);
  if (!sanitizedNotes || !sameSharedReplayNotes(notes, sanitizedNotes)) return null;

  // One logical note set has one representation. This rejects JSON whitespace,
  // alternate key ordering, unsorted tuples, and non-canonical base64url bits.
  if (encodeSharedReplayNotesPayload(replayId, sanitizedNotes) !== payload) return null;
  return sanitizedNotes;
}

function sanitizeSharedReplayNotes(notes: readonly SharedReplayNote[]): SharedReplayNote[] | null {
  if (
    !Array.isArray(notes) ||
    notes.length < 1 ||
    notes.length > MAX_SHARED_REPLAY_NOTES
  ) return null;

  const sanitized: SharedReplayNote[] = [];
  const dedupeKeys = new Set<string>();
  for (const candidate of notes) {
    const note = sanitizeSharedReplayNote(candidate);
    if (!note) return null;
    const dedupeKey = JSON.stringify([note.atMs, note.title, note.body]);
    if (dedupeKeys.has(dedupeKey)) return null;
    dedupeKeys.add(dedupeKey);
    sanitized.push(note);
  }

  return sanitized.sort(compareSharedReplayNotes);
}

function sanitizeSharedReplayNote(candidate: ReplayNoteDedupeInput): SharedReplayNote | null {
  if (!candidate || typeof candidate !== "object") return null;
  if (
    !Number.isSafeInteger(candidate.atMs) ||
    candidate.atMs < 0 ||
    typeof candidate.title !== "string" ||
    typeof candidate.body !== "string" ||
    !hasWellFormedUnicode(candidate.title) ||
    !hasWellFormedUnicode(candidate.body)
  ) {
    return null;
  }

  const title = cleanTitle(candidate.title);
  const body = cleanBody(candidate.body);
  if (
    title.length > MAX_SHARED_REPLAY_NOTE_TITLE_LENGTH ||
    body.length > MAX_SHARED_REPLAY_NOTE_BODY_LENGTH ||
    (!title && !body)
  ) {
    return null;
  }
  return { atMs: candidate.atMs, title, body };
}

function isSharedReplayNotesEnvelopeV1(value: unknown): value is SharedReplayNotesEnvelopeV1 {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys[0] !== "n" || keys[1] !== "r" || keys[2] !== "v") return false;
  if (
    value.v !== SHARED_REPLAY_NOTES_VERSION ||
    !validReplayId(value.r) ||
    !Array.isArray(value.n)
  ) return false;
  if (value.n.length < 1 || value.n.length > MAX_SHARED_REPLAY_NOTES) return false;

  return value.n.every((note) => (
    Array.isArray(note) &&
    note.length === 3 &&
    Number.isSafeInteger(note[0]) &&
    note[0] >= 0 &&
    typeof note[1] === "string" &&
    typeof note[2] === "string"
  ));
}

function compareSharedReplayNotes(left: SharedReplayNote, right: SharedReplayNote): number {
  if (left.atMs !== right.atMs) return left.atMs - right.atMs;
  if (left.title !== right.title) return left.title < right.title ? -1 : 1;
  if (left.body !== right.body) return left.body < right.body ? -1 : 1;
  return 0;
}

function sameSharedReplayNotes(
  left: readonly SharedReplayNote[],
  right: readonly SharedReplayNote[],
): boolean {
  return left.length === right.length && left.every((note, index) => (
    note.atMs === right[index]?.atMs &&
    note.title === right[index]?.title &&
    note.body === right[index]?.body
  ));
}

function cleanTitle(value: string): string {
  return normalizeUnicode(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/g, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function cleanBody(value: string): string {
  return normalizeUnicode(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\t\f\v]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeUnicode(value: string): string {
  try {
    return value.normalize("NFC");
  } catch {
    return value;
  }
}

function hasWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validReplayId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_REPLAY_ID_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const secondExists = index + 1 < bytes.length;
    const thirdExists = index + 2 < bytes.length;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const value = (first << 16) | (second << 8) | third;
    encoded += BASE64URL_ALPHABET[(value >>> 18) & 63];
    encoded += BASE64URL_ALPHABET[(value >>> 12) & 63];
    if (secondExists) encoded += BASE64URL_ALPHABET[(value >>> 6) & 63];
    if (thirdExists) encoded += BASE64URL_ALPHABET[value & 63];
  }
  return encoded;
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
  const remainder = value.length % 4;
  const finalValue = BASE64URL_VALUES.get(value.at(-1) ?? "");
  if (finalValue === undefined) return null;
  // An unpadded final quantum must not contain unused non-zero bits.
  if ((remainder === 2 && (finalValue & 15) !== 0) || (remainder === 3 && (finalValue & 3) !== 0)) {
    return null;
  }

  const outputLength = Math.floor((value.length * 6) / 8);
  const bytes = new Uint8Array(outputLength);
  let buffer = 0;
  let bitCount = 0;
  let outputIndex = 0;
  for (const character of value) {
    const next = BASE64URL_VALUES.get(character);
    if (next === undefined) return null;
    buffer = (buffer << 6) | next;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[outputIndex] = (buffer >>> bitCount) & 255;
      outputIndex += 1;
      buffer &= (1 << bitCount) - 1;
    }
  }
  return outputIndex === outputLength ? bytes : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
