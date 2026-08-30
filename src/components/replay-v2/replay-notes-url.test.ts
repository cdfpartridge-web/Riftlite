import { describe, expect, it } from "vitest";

import {
  MAX_SHARED_REPLAY_NOTES,
  MAX_SHARED_REPLAY_NOTES_PAYLOAD_LENGTH,
  MAX_SHARED_REPLAY_NOTE_BODY_LENGTH,
  MAX_SHARED_REPLAY_NOTE_TITLE_LENGTH,
  canonicalReplayNoteDedupeKey,
  decodeSharedReplayNotesPayload,
  encodeSharedReplayNotesPayload,
  type SharedReplayNote,
} from "./replay-notes-url";

describe("shared replay-notes URL payloads", () => {
  it("encodes one deterministic, URL-safe representation regardless of note order", () => {
    const notes: SharedReplayNote[] = [
      { atMs: 45_550, title: " Lethal   check ", body: "Count runes.  " },
      { atMs: 12_345, title: "Coach note", body: "Pause here.\r\n\r\n\r\nThen inspect." },
    ];
    const first = encodeSharedReplayNotesPayload(REPLAY_ID, notes);
    const second = encodeSharedReplayNotesPayload(REPLAY_ID, [...notes].reverse());

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first).not.toContain("=");
    expect(decodeSharedReplayNotesPayload(first!, REPLAY_ID)).toEqual([
      { atMs: 12_345, title: "Coach note", body: "Pause here.\n\nThen inspect." },
      { atMs: 45_550, title: "Lethal check", body: "Count runes." },
    ]);
  });

  it("round-trips Unicode text through UTF-8 without Node-only base64 APIs", () => {
    const notes = [
      {
        atMs: 9_876,
        title: "終盤の判断 🐉",
        body: "Éowyn says: Придержи действие → lethal?\nルーンを数える。",
      },
    ];

    const encoded = encodeSharedReplayNotesPayload(REPLAY_ID, notes);
    expect(encoded).not.toBeNull();
    expect(decodeSharedReplayNotesPayload(encoded!, REPLAY_ID)).toEqual(notes);
  });

  it("normalizes canonically equivalent Unicode before encoding", () => {
    const decomposed = [{ atMs: 1, title: "Cafe\u0301", body: "" }];
    const composed = [{ atMs: 1, title: "Café", body: "" }];
    expect(encodeSharedReplayNotesPayload(REPLAY_ID, decomposed))
      .toBe(encodeSharedReplayNotesPayload(REPLAY_ID, composed));
    expect(decodeSharedReplayNotesPayload(
      encodeSharedReplayNotesPayload(REPLAY_ID, decomposed)!,
      REPLAY_ID,
    ))
      .toEqual(composed);
  });

  it("binds the note payload to its replay", () => {
    const encoded = encodeSharedReplayNotesPayload(REPLAY_ID, [
      { atMs: 1_000, title: "Correct replay", body: "" },
    ]);
    expect(encoded).not.toBeNull();
    expect(decodeSharedReplayNotesPayload(encoded!, "rp_somewhere_else")).toBeNull();
  });

  it("requires between one and the maximum number of shared notes", () => {
    expect(encodeSharedReplayNotesPayload(REPLAY_ID, [])).toBeNull();
    expect(decodeSharedReplayNotesPayload(
      rawPayload({ v: 1, r: REPLAY_ID, n: [] }),
      REPLAY_ID,
    )).toBeNull();
    expect(decodeSharedReplayNotesPayload("", REPLAY_ID)).toBeNull();
  });

  it("rejects exact and canonically equivalent duplicate tuples", () => {
    expect(encodeSharedReplayNotesPayload(REPLAY_ID, [
      { atMs: 1_000, title: "Same", body: "Line one\nLine two" },
      { atMs: 1_000, title: "Same", body: "Line one\nLine two" },
    ])).toBeNull();
    expect(encodeSharedReplayNotesPayload(REPLAY_ID, [
      { atMs: 1_000, title: " Cafe\u0301 ", body: "Line one\r\nLine two" },
      { atMs: 1_000, title: "Café", body: "Line one\nLine two" },
    ])).toBeNull();
    expect(decodeSharedReplayNotesPayload(rawPayload({
      v: 1,
      r: REPLAY_ID,
      n: [
        [1_000, "Same", "Body"],
        [1_000, "Same", "Body"],
      ],
    }), REPLAY_ID)).toBeNull();

    expect(encodeSharedReplayNotesPayload(REPLAY_ID, [
      { atMs: 1_000, title: "Same", body: "First" },
      { atMs: 1_000, title: "Same", body: "Second" },
    ])).not.toBeNull();
  });

  it("exports the codec's canonical dedupe identity for local and shared notes", () => {
    const fromLocalShape = canonicalReplayNoteDedupeKey({
      atMs: 2_345,
      title: " Cafe\u0301   check ",
      body: "First line\r\nSecond  line\r\n\r\n\r\n",
    });
    const fromSharedShape = canonicalReplayNoteDedupeKey({
      atMs: 2_345,
      title: "Café check",
      body: "First line\nSecond line\n\n",
    });

    expect(fromLocalShape).toBe(fromSharedShape);
    expect(fromLocalShape).toBe(JSON.stringify([
      2_345,
      "Café check",
      "First line\nSecond line",
    ]));
    expect(canonicalReplayNoteDedupeKey({ atMs: -1, title: "Bad", body: "" }))
      .toBeNull();
    expect(canonicalReplayNoteDedupeKey({ atMs: 1, title: "  ", body: "\r\n" }))
      .toBeNull();
  });

  it("rejects invalid input instead of silently dropping notes", () => {
    expect(encodeSharedReplayNotesPayload(REPLAY_ID, [
      { atMs: -1, title: "Bad time", body: "" },
    ])).toBeNull();
    expect(encodeSharedReplayNotesPayload(REPLAY_ID, [
      { atMs: 1.5, title: "Bad time", body: "" },
    ])).toBeNull();
    expect(encodeSharedReplayNotesPayload(REPLAY_ID, [
      { atMs: 1, title: " \t ", body: "\r\n" },
    ])).toBeNull();
    expect(encodeSharedReplayNotesPayload(REPLAY_ID, [
      { atMs: 1, title: "x".repeat(MAX_SHARED_REPLAY_NOTE_TITLE_LENGTH + 1), body: "" },
    ])).toBeNull();
    expect(encodeSharedReplayNotesPayload(REPLAY_ID, [
      { atMs: 1, title: "", body: "x".repeat(MAX_SHARED_REPLAY_NOTE_BODY_LENGTH + 1) },
    ])).toBeNull();
    expect(encodeSharedReplayNotesPayload(REPLAY_ID, [
      { atMs: 1, title: "Broken \ud800 Unicode", body: "" },
    ])).toBeNull();
    expect(encodeSharedReplayNotesPayload(REPLAY_ID, Array.from(
      { length: MAX_SHARED_REPLAY_NOTES + 1 },
      (_, index) => ({ atMs: index, title: `Note ${index}`, body: "" }),
    ))).toBeNull();
  });

  it("enforces a total payload byte budget in addition to per-note limits", () => {
    const notes = Array.from({ length: MAX_SHARED_REPLAY_NOTES }, (_, index) => ({
      atMs: index,
      title: `Note ${index}`,
      body: "界".repeat(MAX_SHARED_REPLAY_NOTE_BODY_LENGTH),
    }));
    expect(encodeSharedReplayNotesPayload(REPLAY_ID, notes)).toBeNull();
    expect(decodeSharedReplayNotesPayload(
      "A".repeat(MAX_SHARED_REPLAY_NOTES_PAYLOAD_LENGTH + 1),
      REPLAY_ID,
    ))
      .toBeNull();
  });

  it.each([
    "not+base64url",
    "A",
    rawPayload("not json"),
    rawPayload({ v: 2, r: REPLAY_ID, n: [] }),
    rawPayload({ v: 1, r: REPLAY_ID, n: [], extra: true }),
    rawPayload({ v: 1, r: REPLAY_ID, n: "notes" }),
    rawPayload({ v: 1, r: REPLAY_ID, n: [[-1, "Title", "Body"]] }),
    rawPayload({ v: 1, r: REPLAY_ID, n: [[1.25, "Title", "Body"]] }),
    rawPayload({ v: 1, r: REPLAY_ID, n: [[1, "Title"]] }),
    rawPayload({ v: 1, r: REPLAY_ID, n: [[1, "", ""]] }),
    rawPayload({ v: 1, r: REPLAY_ID, n: [[1, "Broken \ud800 Unicode", ""]] }),
    rawPayload({ v: 1, r: REPLAY_ID, n: [[1, "x".repeat(MAX_SHARED_REPLAY_NOTE_TITLE_LENGTH + 1), ""]] }),
    rawPayload({ v: 1, r: REPLAY_ID, n: [[1, "", "x".repeat(MAX_SHARED_REPLAY_NOTE_BODY_LENGTH + 1)]] }),
    rawPayload({
      v: 1,
      r: REPLAY_ID,
      n: Array.from(
        { length: MAX_SHARED_REPLAY_NOTES + 1 },
        (_, index) => [index, `Note ${index}`, ""],
      ),
    }),
    rawPayload({ v: 1, r: REPLAY_ID, n: [[1, " Title ", "Body"]] }),
    rawPayload({ n: [[1, "Title", "Body"]], r: REPLAY_ID, v: 1 }),
  ])("rejects malformed, unsupported, or non-canonical payload %#", (payload) => {
    expect(decodeSharedReplayNotesPayload(payload, REPLAY_ID)).toBeNull();
  });

  it("rejects malformed UTF-8 and non-canonical base64url padding bits", () => {
    expect(decodeSharedReplayNotesPayload(
      rawBytes(new Uint8Array([0xc3, 0x28])),
      REPLAY_ID,
    )).toBeNull();

    const canonical = Array.from({ length: 4 }, (_, index) => (
      encodeSharedReplayNotesPayload(REPLAY_ID, [
        { atMs: 1, title: "x".repeat(index + 1), body: "" },
      ])!
    )).find((candidate) => candidate.length % 4 === 2 || candidate.length % 4 === 3)!;
    const finalValue = alphabetIndex(canonical.at(-1)!);
    const changedFinalValue = finalValue ^ 1;
    const nonCanonical = `${canonical.slice(0, -1)}${BASE64URL_ALPHABET[changedFinalValue]}`;
    expect(nonCanonical).not.toBe(canonical);
    expect(decodeSharedReplayNotesPayload(nonCanonical, REPLAY_ID)).toBeNull();
  });
});

const REPLAY_ID = "rp_shared_notes";

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function rawPayload(value: unknown): string {
  return rawBytes(new TextEncoder().encode(
    typeof value === "string" ? value : JSON.stringify(value),
  ));
}

function rawBytes(bytes: Uint8Array): string {
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

function alphabetIndex(character: string): number {
  return BASE64URL_ALPHABET.indexOf(character);
}
