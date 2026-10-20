import { z } from "zod";
import type { ReplayNote } from "@/components/replay-v2/replay-notes";

/** Cloud writes are strict: never trim, truncate, or silently drop a person's notes. */
export const MAX_REVIEW_JSON_BYTES = 512 * 1024;
export const MAX_REVIEW_NOTES = 250;
export const DEFAULT_REVIEW_LIST_LIMIT = 50;
export const MAX_REVIEW_LIST_LIMIT = 100;

const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = (maximum: number) => z.string().max(maximum).refine(
  (value) => !/[\u0000-\u001f\u007f]/.test(value), "Text contains control characters.",
);
export const ReviewAccountIdSchema = text(128).min(1).refine((value) => !value.includes("/"));
export const ReviewReplayIdSchema = z.string().regex(/^rl2_[a-f0-9]{32}$/);
export const ReviewNoteSchema = z.object({
  id: text(180).min(1),
  atMs: integer,
  eventId: text(180),
  eventIndex: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
  gameId: text(180),
  gameNumber: integer.min(1).nullable(),
  turn: integer.nullable(),
  title: text(160),
  body: z.string().max(4_000).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)),
  createdAt: integer,
  updatedAt: integer,
}).strict().refine((note) => Boolean(note.title.trim() || note.body.trim()), "A note needs a title or thought.");
export const ReviewNotesSchema = z.array(ReviewNoteSchema).max(MAX_REVIEW_NOTES).refine(
  (notes) => new Set(notes.map((note) => note.id)).size === notes.length,
  "Note IDs must be unique.",
);
export const SaveReplayReviewSchema = z.object({
  expectedAccountId: ReviewAccountIdSchema,
  expectedRevision: integer.min(1).nullable(),
  notes: ReviewNotesSchema,
}).strict();
export const DeleteReplayReviewSchema = z.object({
  expectedAccountId: ReviewAccountIdSchema,
  expectedRevision: integer.min(1),
}).strict();

export type SaveReplayReviewInput = z.infer<typeof SaveReplayReviewSchema>;
export type DeleteReplayReviewInput = z.infer<typeof DeleteReplayReviewSchema>;
export type SavedReplayReview = {
  replayId: string;
  revision: number;
  notes: ReplayNote[];
  createdAt: number;
  updatedAt: number;
  title: string;
  platform: string;
  /** Saving a review never grants access to the original replay. */
  available: boolean;
};
export type SavedReplayReviewSummary = Omit<SavedReplayReview, "notes"> & { noteCount: number };
export type ReplayReviewResponse = { accountId: string; review: SavedReplayReview | null };
export type ReplayReviewListResponse = {
  accountId: string;
  items: SavedReplayReviewSummary[];
  nextCursor: string | null;
};
