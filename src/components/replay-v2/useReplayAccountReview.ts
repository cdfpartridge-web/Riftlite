"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SavedReplayReview } from "@/lib/replay-reviews";
import type { ReplayNote } from "./replay-notes";
import { ReviewRequestError, StaleReviewRequest, reviewErrorMessage, useReviewAccountSession } from "./review-account-client";

type ReviewState = {
  replayId: string;
  status: "loading" | "signed-out" | "expired" | "ready" | "error";
  accountId: string | null;
  review: SavedReplayReview | null;
  saving: boolean;
  error: string;
  conflict: { latest: SavedReplayReview | null; draftNotes: ReplayNote[] } | null;
  pendingNotes: ReplayNote[] | null;
};
const emptyState = (replayId: string): ReviewState => ({ replayId, status: "loading", accountId: null, review: null, saving: false, error: "", conflict: null, pendingNotes: null });

export function useReplayAccountReview({ replayId, enabled = true, paused = false }: { replayId: string; enabled?: boolean; paused?: boolean }) {
  const [state, setState] = useState<ReviewState>(() => emptyState(replayId));
  const stateRef = useRef(state);
  const serial = useRef(0);
  const pausedRef = useRef(paused);
  useLayoutEffect(() => { pausedRef.current = paused; }, [paused]);
  const [identityRevision, setIdentityRevision] = useState(0);
  const commit = useCallback((next: ReviewState) => { stateRef.current = next; setState(next); }, []);
  const clear = useCallback(() => {
    serial.current += 1;
    commit(emptyState(replayId));
    setIdentityRevision((value) => value + 1);
  }, [commit, replayId]);
  const { ready: sessionReady, key: sessionKey, request } = useReviewAccountSession(clear);
  const endpoint = `/api/v2/reviews/${encodeURIComponent(replayId)}`;

  const authFailure = useCallback((error: unknown): boolean => {
    if (!(error instanceof ReviewRequestError)) return false;
    if (error.status === 401 && stateRef.current.accountId) {
      // Expiration is not an account switch. Hide private content, but keep the original
      // edit revision and unfinished draft in memory until this same account reconnects.
      serial.current += 1;
      commit({ ...stateRef.current, status: "expired", saving: false, error: "Your account session expired. Reconnect your account to continue." });
      return true;
    }
    if (error.status === 401 || error.payload.code === "review_account_changed") {
      serial.current += 1;
      setIdentityRevision((value) => value + 1);
      commit({ ...emptyState(replayId), status: error.status === 401 ? "signed-out" : "error", error: error.status === 401 ? "" : "Your account changed. Refresh to load this account’s reviews." });
      return true;
    }
    return false;
  }, [commit, replayId]);

  const refresh = useCallback(async (discardDraft = false) => {
    if (!enabled || !sessionReady || stateRef.current.saving) return false;
    const requestSerial = ++serial.current;
    try {
      const payload = await request(endpoint);
      if (requestSerial !== serial.current) return false;
      const accountId = payload.accountId as string;
      const review = readReview(payload.review, replayId);
      const previous = stateRef.current;
      const identityChanged = previous.accountId !== null && previous.accountId !== accountId;
      if (identityChanged) setIdentityRevision((value) => value + 1);
      // Never advance an edit's base revision under a draft. The next save must detect a conflict.
      if (!discardDraft && !identityChanged && previous.accountId && (pausedRef.current || previous.pendingNotes)) {
        if (previous.status === "expired") commit({ ...previous, status: "ready", error: previous.conflict ? "This review changed on another device. Your draft is still here." : "" });
        return false;
      }
      commit({ ...emptyState(replayId), status: "ready", accountId, review });
      return true;
    } catch (error) {
      if (error instanceof StaleReviewRequest || requestSerial !== serial.current) return false;
      if (authFailure(error)) return false;
      const previous = stateRef.current;
      commit({ ...previous, status: previous.status === "expired" ? "expired" : previous.accountId ? "ready" : "error", error: reviewErrorMessage(error) });
      return false;
    }
  }, [authFailure, commit, enabled, endpoint, replayId, sessionReady, request]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      clear();
      if (enabled && sessionReady) void refresh();
    });
    return () => { cancelled = true; serial.current += 1; };
  }, [clear, enabled, replayId, sessionKey, sessionReady, refresh]);

  useEffect(() => {
    if (!enabled || !sessionReady) return;
    const onFocus = () => { if (document.visibilityState !== "hidden") void refresh(); };
    const timer = window.setInterval(onFocus, 60_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [enabled, refresh, sessionReady]);

  const write = useCallback(async (notes: ReplayNote[], revision?: number | null): Promise<boolean> => {
    const previous = stateRef.current;
    if (!enabled || previous.replayId !== replayId || previous.status !== "ready" || !previous.accountId || previous.saving) return false;
    const pendingNotes = notes.map((note) => ({ ...note }));
    const requestSerial = ++serial.current;
    commit({ ...previous, saving: true, pendingNotes, error: "" });
    try {
      const payload = await request(endpoint, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedAccountId: previous.accountId, expectedRevision: revision === undefined ? previous.review?.revision ?? null : revision, notes: pendingNotes }),
      });
      if (requestSerial !== serial.current) return false;
      if (payload.accountId !== previous.accountId) {
        clear();
        return false;
      }
      const review = readReview(payload.review, replayId);
      if (!review) throw new Error("Your review was not confirmed as saved. Please try again.");
      commit({ ...emptyState(replayId), status: "ready", accountId: previous.accountId, review });
      return true;
    } catch (error) {
      if (error instanceof StaleReviewRequest || requestSerial !== serial.current) return false;
      if (authFailure(error)) return false;
      if (error instanceof ReviewRequestError && error.status === 409 && error.payload.code === "review_conflict" && error.payload.accountId === previous.accountId) {
        const latest = readReview(error.payload.review, replayId);
        commit({ ...previous, saving: false, pendingNotes, conflict: { latest, draftNotes: pendingNotes }, error: "This review changed on another device. Your draft is still here." });
      } else {
        commit({ ...previous, saving: false, pendingNotes, error: reviewErrorMessage(error) });
      }
      return false;
    }
  }, [authFailure, clear, commit, enabled, endpoint, replayId, request]);

  const saveNotes = useCallback((notes: ReplayNote[]) => write(notes), [write]);
  const saveReview = useCallback(() => {
    const current = stateRef.current;
    if (current.pendingNotes || current.conflict || current.saving || current.replayId !== replayId || current.status !== "ready") return Promise.resolve(false);
    return current.review ? Promise.resolve(true) : write([]);
  }, [replayId, write]);
  const reloadLatest = useCallback(async () => {
    // Discard only after a successful read, so a failed reload cannot lose the draft.
    return refresh(true);
  }, [refresh]);
  const retryDraft = useCallback(() => {
    const current = stateRef.current;
    if (!current.pendingNotes) return Promise.resolve(false);
    return write(current.pendingNotes, current.conflict ? current.conflict.latest?.revision ?? null : undefined);
  }, [write]);

  const visible = state.replayId === replayId ? state : emptyState(replayId);
  const expired = visible.status === "expired";
  return {
    status: visible.status, accountId: visible.accountId, review: expired ? null : visible.review,
    saving: visible.saving, error: visible.error, conflict: expired ? null : visible.conflict, pendingNotes: expired ? null : visible.pendingNotes,
    hasPendingChanges: Boolean(visible.pendingNotes || (visible.accountId && paused)),
    notes: expired ? [] : visible.review?.notes ?? [], boundaryKey: `${replayId}:${sessionKey}:${identityRevision}:${visible.accountId ?? ""}`,
    sessionKey, saveReview, saveNotes, refresh, reloadLatest, retryDraft,
  };
}

function readReview(value: unknown, replayId: string): SavedReplayReview | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new Error("Your review could not be read. Please try again.");
  const review = value as SavedReplayReview;
  if (review.replayId !== replayId || !Number.isInteger(review.revision) || review.revision < 1 || !Array.isArray(review.notes)) throw new Error("Your review could not be read. Please try again.");
  return review;
}
