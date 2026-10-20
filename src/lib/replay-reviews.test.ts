import { describe, expect, it } from "vitest";
import { DeleteReplayReviewSchema, ReviewNoteSchema, ReviewNotesSchema, SaveReplayReviewSchema } from "./replay-reviews";

const note = {
  id: "note-a", atMs: 32_792, eventId: "event-a", eventIndex: 12, gameId: "game-a",
  gameNumber: 1, turn: null, title: "Opening plan", body: "Keep this unit.\nLeave a response available.",
  createdAt: 100, updatedAt: 110,
};
describe("private replay review contracts", () => {
  it("preserves all note text and exact recorded anchors without lossy sanitizing", () => {
    expect(ReviewNoteSchema.parse(note)).toEqual(note);
    expect(SaveReplayReviewSchema.parse({ expectedAccountId: "account-a", expectedRevision: null, notes: [note] }).notes).toEqual([note]);
  });
  it.each([
    { ...note, atMs: -1 }, { ...note, atMs: 1.5 }, { ...note, eventIndex: -2 },
    { ...note, gameNumber: 0 }, { ...note, turn: -1 }, { ...note, title: "x".repeat(161) },
    { ...note, body: "x".repeat(4001) }, { ...note, eventId: "x".repeat(181) },
    { ...note, body: "danger\u0000text" }, { ...note, updatedAt: Infinity },
    { ...note, title: "", body: "  " }, { ...note, uid: "other-account" },
  ])("rejects malformed notes instead of silently changing them (%#)", (candidate) => {
    expect(ReviewNoteSchema.safeParse(candidate).success).toBe(false);
  });
  it("rejects duplicate note IDs and excessive note collections", () => {
    expect(ReviewNotesSchema.safeParse([note, note]).success).toBe(false);
    expect(ReviewNotesSchema.safeParse(Array.from({ length: 251 }, (_, index) => ({ ...note, id: String(index) }))).success).toBe(false);
  });
  it("rejects unknown fields, spoofed paths and invalid revisions", () => {
    const base = { expectedAccountId: "account-a", expectedRevision: null, notes: [] };
    for (const candidate of [
      { ...base, uid: "victim" }, { ...base, accountId: "victim" },
      { ...base, expectedAccountId: "a/items/victim" }, { ...base, expectedRevision: 0 },
      { ...base, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...base, expectedRevision: "1" },
    ]) expect(SaveReplayReviewSchema.safeParse(candidate).success).toBe(false);
    expect(DeleteReplayReviewSchema.safeParse({ expectedAccountId: "account-a", expectedRevision: null }).success).toBe(false);
  });
});
