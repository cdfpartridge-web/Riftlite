import "server-only";

import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { getFirestoreAdmin } from "@/lib/firebase/admin";
import {
  DEFAULT_REVIEW_LIST_LIMIT, MAX_REVIEW_LIST_LIMIT, ReviewAccountIdSchema,
  ReviewNotesSchema, ReviewReplayIdSchema,
  type DeleteReplayReviewInput, type SaveReplayReviewInput,
  type SavedReplayReview, type SavedReplayReviewSummary,
} from "@/lib/replay-reviews";
import { REPLAY_COLLECTION } from "@/lib/replay-v2-server/constants";
import { ReplayV2Error } from "@/lib/replay-v2-server/errors";
import type { ReplayRecord } from "@/lib/replay-v2-server/model";
import { readReadableReplayMetadata } from "@/lib/replay-v2-server/service";

// Intentionally outside replayV2/public indexes and accountSync client access.
// The existing Firestore deny-all fallback makes this collection server-only.
export const REPLAY_REVIEW_COLLECTION = "replayPrivateReviews";
const SCHEMA = "riftlite-private-replay-review";
type StoredReview = Omit<SavedReplayReview, "available"> & {
  schema: typeof SCHEMA; version: 1; accountId: string; deleted: false; noteCount: number;
};
type StoredTombstone = { schema: typeof SCHEMA; version: 1; accountId: string; replayId: string; revision: number; updatedAt: number; deleted: true };

export class ReplayReviewConflict extends ReplayV2Error {
  constructor(readonly accountId: string, readonly review: SavedReplayReview | null) {
    super(409, "review_conflict", "This review changed on another device. Load the latest review before saving again.");
  }
}

export async function readSavedReplayReview(accountId: string, replayId: string): Promise<SavedReplayReview | null> {
  const db = reviewDb(accountId, replayId);
  const snapshot = await reviewRef(db, accountId, replayId).get();
  const stored = storedReview(snapshot.data(), accountId, replayId);
  if (!stored || stored.deleted) return null;
  return detail(stored, await replayAvailable(accountId, replayId));
}

export async function listSavedReplayReviews(accountId: string, rawLimit?: string | null, cursor?: string | null) {
  const db = reviewDb(accountId);
  const limit = rawLimit === undefined || rawLimit === null || rawLimit === "" ? DEFAULT_REVIEW_LIST_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REVIEW_LIST_LIMIT) {
    throw new ReplayV2Error(400, "invalid_review_limit", `Review limit must be between 1 and ${MAX_REVIEW_LIST_LIMIT}.`);
  }
  let query = db.collection(REPLAY_REVIEW_COLLECTION).doc(accountId).collection("items")
    .orderBy("updatedAt", "desc").orderBy(FieldPath.documentId(), "desc")
    .select("schema", "version", "accountId", "replayId", "revision", "createdAt", "updatedAt", "title", "platform", "noteCount", "deleted");
  if (cursor) {
    const position = decodeCursor(cursor);
    query = query.startAfter(position.updatedAt, position.replayId);
  }
  const page = await query.limit(limit + 1).get();
  const documents = page.docs.slice(0, limit);
  const items = (await Promise.all(documents.map(async (document) => {
    const data = document.data();
    if (data.deleted === true) return null;
    const stored = summaryFields(data, accountId, document.id);
    return { ...stored, available: await replayAvailable(accountId, stored.replayId) };
  }))).filter((item): item is SavedReplayReviewSummary => item !== null);
  const last = documents.at(-1);
  return {
    items,
    // Empty pages can contain deleted reviews; the cursor still advances.
    nextCursor: page.docs.length > limit && last
      ? Buffer.from(JSON.stringify({ updatedAt: last.data().updatedAt, replayId: last.id })).toString("base64url")
      : null,
  };
}

export async function saveReplayReview(accountId: string, replayId: string, input: SaveReplayReviewInput): Promise<SavedReplayReview> {
  assertExpectedAccount(accountId, input.expectedAccountId);
  const db = reviewDb(accountId, replayId);
  const ref = reviewRef(db, accountId, replayId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const stored = storedReview(snapshot.data(), accountId, replayId);
    const current = stored && !stored.deleted ? stored : null;
    if ((current?.revision ?? null) !== input.expectedRevision) {
      throw new ReplayReviewConflict(accountId, current ? detail(current, await replayAvailable(accountId, replayId)) : null);
    }
    // Read the source in the transaction as well as through the shared access
    // policy. A concurrent visibility/status change retries this transaction.
    const sourceSnapshot = await transaction.get(db.collection(REPLAY_COLLECTION).doc(replayId));
    const source = await readReadableReplayMetadata(replayId, accountId);
    assertReadySource(source);
    const fenced = sourceSnapshot.data();
    if (!fenced || fenced.visibility !== source.visibility || fenced.ownerUid !== source.ownerUid || fenced.status !== source.status) {
      throw new ReplayV2Error(409, "review_replay_changed", "Replay access changed. Reload the replay before saving.");
    }
    const now = Date.now();
    const saved: StoredReview = {
      schema: SCHEMA, version: 1, accountId, replayId,
      revision: nextRevision(stored?.revision ?? 0),
      notes: input.notes, noteCount: input.notes.length,
      title: source.title.slice(0, 240), platform: source.platform.slice(0, 40),
      createdAt: current?.createdAt ?? now, updatedAt: now, deleted: false,
    };
    transaction.set(ref, saved);
    return detail(saved, true);
  });
}

export async function deleteSavedReplayReview(accountId: string, replayId: string, input: DeleteReplayReviewInput): Promise<void> {
  assertExpectedAccount(accountId, input.expectedAccountId);
  const db = reviewDb(accountId, replayId);
  const ref = reviewRef(db, accountId, replayId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const stored = storedReview(snapshot.data(), accountId, replayId);
    const current = stored && !stored.deleted ? stored : null;
    if (current?.revision !== input.expectedRevision) {
      throw new ReplayReviewConflict(accountId, current ? detail(current, await replayAvailable(accountId, replayId)) : null);
    }
    // Delete notes completely while retaining a revision fence. A stale device
    // cannot overwrite a later delete/re-create cycle with an old revision.
    const tombstone: StoredTombstone = {
      schema: SCHEMA, version: 1, accountId, replayId,
      revision: nextRevision(current.revision), updatedAt: Date.now(), deleted: true,
    };
    transaction.set(ref, tombstone);
  });
}

function reviewDb(accountId: string, replayId?: string): Firestore {
  if (!ReviewAccountIdSchema.safeParse(accountId).success) throw new ReplayV2Error(401, "authentication_required", "A RiftLite account is required.");
  if (replayId !== undefined && !ReviewReplayIdSchema.safeParse(replayId).success) throw new ReplayV2Error(400, "invalid_replay_id", "Replay id is invalid.");
  const db = getFirestoreAdmin();
  if (!db) throw new ReplayV2Error(503, "firebase_unavailable", "Account reviews are temporarily unavailable.");
  return db;
}

function reviewRef(db: Firestore, accountId: string, replayId: string) {
  return db.collection(REPLAY_REVIEW_COLLECTION).doc(accountId).collection("items").doc(replayId);
}

function assertExpectedAccount(accountId: string, expectedAccountId: string) {
  if (accountId !== expectedAccountId) throw new ReplayV2Error(409, "review_account_changed", "Your RiftLite account changed. Reload your private review before saving.");
}

function assertReadySource(record: ReplayRecord) {
  if (record.status !== "ready" || !record.canonicalArtifact) {
    throw new ReplayV2Error(409, "review_replay_not_ready", "This replay is not ready to review yet.");
  }
}

async function replayAvailable(accountId: string, replayId: string): Promise<boolean> {
  try {
    const record = await readReadableReplayMetadata(replayId, accountId);
    return record.status === "ready" && Boolean(record.canonicalArtifact);
  } catch (error) {
    if (error instanceof ReplayV2Error && (error.status === 403 || error.status === 404)) return false;
    throw error;
  }
}

function storedReview(value: unknown, accountId: string, replayId: string): StoredReview | StoredTombstone | null {
  if (value === undefined) return null;
  if (!isRecord(value) || value.schema !== SCHEMA || value.version !== 1 || value.accountId !== accountId || value.replayId !== replayId || !positiveInteger(value.revision)) {
    throw new ReplayV2Error(500, "review_record_invalid", "This saved review could not be read. Your notes have not been changed.");
  }
  if (value.deleted === true) return value as StoredTombstone;
  summaryFields(value, accountId, replayId);
  const parsed = ReviewNotesSchema.safeParse(value.notes);
  if (!parsed.success || parsed.data.length !== value.noteCount) throw new ReplayV2Error(500, "review_record_invalid", "This saved review could not be read. Your notes have not been changed.");
  return { ...value, notes: parsed.data } as StoredReview;
}

function summaryFields(value: Record<string, unknown>, accountId: string, replayId: string): Omit<SavedReplayReviewSummary, "available"> {
  if (value.schema !== SCHEMA || value.version !== 1 || value.accountId !== accountId || value.replayId !== replayId || !ReviewReplayIdSchema.safeParse(replayId).success || !positiveInteger(value.revision) || !nonNegativeInteger(value.createdAt) || !nonNegativeInteger(value.updatedAt) || !nonNegativeInteger(value.noteCount) || Number(value.noteCount) > 250 || typeof value.title !== "string" || typeof value.platform !== "string" || value.deleted !== false) {
    throw new ReplayV2Error(500, "review_record_invalid", "This saved review could not be read. Your notes have not been changed.");
  }
  return {
    replayId, revision: value.revision as number, createdAt: value.createdAt as number,
    updatedAt: value.updatedAt as number, title: value.title, platform: value.platform, noteCount: value.noteCount as number,
  };
}

function detail(record: StoredReview, available: boolean): SavedReplayReview {
  return { replayId: record.replayId, revision: record.revision, notes: record.notes, createdAt: record.createdAt, updatedAt: record.updatedAt, title: record.title, platform: record.platform, available };
}

function decodeCursor(value: string): { updatedAt: number; replayId: string } {
  try {
    if (value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (!isRecord(parsed) || Object.keys(parsed).length !== 2 || !nonNegativeInteger(parsed.updatedAt) || !ReviewReplayIdSchema.safeParse(parsed.replayId).success) throw new Error();
    return parsed as { updatedAt: number; replayId: string };
  } catch {
    throw new ReplayV2Error(400, "invalid_review_cursor", "The review list cursor is invalid.");
  }
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function nonNegativeInteger(value: unknown): boolean { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function positiveInteger(value: unknown): boolean { return nonNegativeInteger(value) && Number(value) > 0; }
function nextRevision(value: number): number {
  if (!Number.isSafeInteger(value + 1)) throw new ReplayV2Error(409, "review_revision_limit", "This review cannot be updated further.");
  return value + 1;
}
