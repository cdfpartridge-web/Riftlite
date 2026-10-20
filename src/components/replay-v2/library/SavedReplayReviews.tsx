"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, LockKeyhole, RefreshCw, Trash2 } from "lucide-react";
import type { SavedReplayReviewSummary } from "@/lib/replay-reviews";
import type { ReplayNote } from "../replay-notes";
import { ReviewRequestError, StaleReviewRequest, reviewErrorMessage, useReviewAccountSession } from "../review-account-client";
import styles from "./SavedReplayReviews.module.css";

type LibraryState = { status: "loading" | "ready" | "signed-out" | "error"; accountId: string | null; items: SavedReplayReviewSummary[]; cursor: string | null; error: string };
const empty = (): LibraryState => ({ status: "loading", accountId: null, items: [], cursor: null, error: "" });

export function SavedReplayReviews({ embedded = false }: { embedded?: boolean }) {
  const [state, setState] = useState<LibraryState>(empty);
  const current = useRef(state);
  const serial = useRef(0);
  const detailSerial = useRef(0);
  const [detail, setDetail] = useState<{ replayId: string; notes: ReplayNote[]; loading: boolean; error: string } | null>(null);
  const [pending, setPending] = useState<SavedReplayReviewSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const commit = useCallback((next: LibraryState) => { current.current = next; setState(next); }, []);
  const clear = useCallback(() => {
    serial.current += 1;
    detailSerial.current += 1;
    setDetail(null);
    commit(empty());
    setPending(null);
    setBusy(false);
    busyRef.current = false;
    setLoadingMore(false);
    setQuery("");
  }, [commit]);
  const { ready: sessionReady, key: sessionKey, request } = useReviewAccountSession(clear);

  const fail = useCallback((error: unknown) => {
    if (error instanceof ReviewRequestError && (error.status === 401 || error.payload.code === "review_account_changed")) {
      clear();
      commit({ ...empty(), status: error.status === 401 ? "signed-out" : "error", error: error.status === 401 ? "" : "Your account changed. Refresh to load your reviews." });
      return;
    }
    commit({ ...current.current, status: current.current.accountId ? "ready" : "error", error: reviewErrorMessage(error) });
  }, [clear, commit]);

  const load = useCallback(async (cursor?: string) => {
    if (!sessionReady || busyRef.current) return;
    const requestSerial = ++serial.current;
    setLoadingMore(Boolean(cursor));
    try {
      const payload = await request(`/api/v2/reviews${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (requestSerial !== serial.current) return;
      const accountId = payload.accountId as string;
      if (!Array.isArray(payload.items)) throw new Error("Your reviews could not be read. Please try again.");
      const items = payload.items as SavedReplayReviewSummary[];
      const changedAccount = current.current.accountId !== null && current.current.accountId !== accountId;
      if (changedAccount) { setPending(null); setQuery(""); detailSerial.current += 1; setDetail(null); }
      const combined = cursor && !changedAccount ? [...current.current.items, ...items] : items;
      commit({ status: "ready", accountId, items: [...new Map(combined.map((item) => [item.replayId, item])).values()], cursor: typeof payload.nextCursor === "string" ? payload.nextCursor : null, error: "" });
    } catch (error) {
      if (error instanceof StaleReviewRequest || requestSerial !== serial.current) return;
      fail(error);
    } finally {
      if (requestSerial === serial.current) setLoadingMore(false);
    }
  }, [commit, fail, sessionReady, request]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled && sessionReady) void load(); });
    return () => { cancelled = true; serial.current += 1; };
  }, [load, sessionReady, sessionKey]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== "hidden") void load(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); window.clearInterval(timer); };
  }, [load]);
  useEffect(() => { if (pending) cancelRef.current?.focus(); }, [pending]);

  function cancel() {
    setPending(null);
    returnFocusRef.current?.focus();
  }

  const loadSavedNotes = useCallback(async (replayId: string, background = false) => {
    const accountId = current.current.accountId;
    if (!accountId || busyRef.current) return;
    const requestSerial = ++detailSerial.current;
    if (!background) setDetail({ replayId, notes: [], loading: true, error: "" });
    try {
      const payload = await request(`/api/v2/reviews/${encodeURIComponent(replayId)}`);
      if (requestSerial !== detailSerial.current || accountId !== current.current.accountId) return;
      if (payload.accountId !== accountId) { clear(); void load(); return; }
      const review = payload.review as { replayId?: string; notes?: ReplayNote[] } | null;
      if (!review || review.replayId !== replayId || !Array.isArray(review.notes)) throw new Error("This saved review is no longer available. Refresh your reviews.");
      setDetail({ replayId, notes: review.notes, loading: false, error: "" });
    } catch (error) {
      if (error instanceof StaleReviewRequest || requestSerial !== detailSerial.current) return;
      if (error instanceof ReviewRequestError && (error.status === 401 || error.payload.code === "review_account_changed")) { fail(error); return; }
      setDetail({ replayId, notes: [], loading: false, error: reviewErrorMessage(error) });
    }
  }, [clear, fail, load, request]);

  useEffect(() => {
    const replayId = detail?.replayId;
    if (!replayId) return;
    const refresh = () => { if (document.visibilityState !== "hidden") void loadSavedNotes(replayId, true); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [detail?.replayId, loadSavedNotes]);

  function showSavedNotes(replayId: string) {
    if (detail?.replayId === replayId) { detailSerial.current += 1; setDetail(null); return; }
    void loadSavedNotes(replayId);
  }

  async function remove() {
    const accountId = current.current.accountId;
    if (!pending || !accountId || busyRef.current) return;
    const target = pending;
    const requestSerial = ++serial.current;
    setBusy(true);
    busyRef.current = true;
    try {
      const payload = await request(`/api/v2/reviews/${encodeURIComponent(target.replayId)}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedAccountId: accountId, expectedRevision: target.revision }),
      });
      if (requestSerial !== serial.current) return;
      if (payload.accountId !== accountId) { clear(); return; }
      commit({ ...current.current, items: current.current.items.filter((item) => item.replayId !== target.replayId), error: "" });
      detailSerial.current += 1;
      setDetail(null);
      setPending(null);
    } catch (error) {
      if (error instanceof StaleReviewRequest || requestSerial !== serial.current) return;
      if (error instanceof ReviewRequestError && error.payload.code === "review_conflict") {
        setPending(null);
        commit({ ...current.current, error: "This review changed on another device. Refresh and check it before removing it." });
      } else fail(error);
    } finally {
      if (requestSerial === serial.current) { setBusy(false); busyRef.current = false; }
    }
  }

  const shown = state.items.filter((item) => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className={styles.library} aria-label="My saved reviews">
    <header className={styles.header}>
      <div><span className={styles.eyebrow}><LockKeyhole aria-hidden="true" size={14} /> Only you</span><h2>My reviews</h2><p>Replays you saved to study, with private notes synced to your RiftLite account.</p></div>
      <button type="button" onClick={() => void load()} disabled={state.status === "loading" || busy || loadingMore}><RefreshCw size={16} aria-hidden="true" /> Refresh reviews</button>
    </header>
    {state.status === "loading" ? <p role="status">Loading your private reviews…</p> : null}
    {state.status === "signed-out" ? <div className={styles.empty}><LockKeyhole aria-hidden="true" size={26} /><h3>Sign in to save your reviews</h3><p>Save your own matches or any public replay. Your notes belong to your account and stay private unless you choose to share them.</p><Link href="/account" target={embedded ? "_blank" : undefined} rel={embedded ? "noopener noreferrer" : undefined}>Sign in to RiftLite</Link><p className={styles.hint}>After signing in, return here. Your reviews refresh automatically.</p></div> : null}
    {state.error ? <p role="alert" className={styles.error}>{state.error}</p> : null}
    {state.status === "ready" && state.items.length === 0 && !state.cursor ? <div className={styles.empty}><Bookmark aria-hidden="true" size={26} /><h3>No saved reviews yet</h3><p>Open a replay, choose Review game, then Save to my reviews. Public replays work too.</p></div> : null}
    {state.status === "ready" && state.items.length > 0 ? <>
      <label className={styles.search}>Find a saved replay<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search replay titles" /></label>
      <div className={styles.grid}>{shown.map((item) => <article key={item.replayId} className={styles.card}>
        <div className={styles.cardHeading}><Bookmark size={18} aria-hidden="true" /><h3>{item.title || "Saved replay"}</h3></div>
        <p>{item.noteCount} private {item.noteCount === 1 ? "note" : "notes"} · Updated {formatDate(item.updatedAt)}</p>
        {!item.available ? <p className={styles.hint}>The original replay is unavailable or its access changed. Your private notes are still saved.</p> : null}
        <div className={styles.actions}>{item.available ? <Link href={`/replays/${encodeURIComponent(item.replayId)}?review=1${embedded ? "&embed=1" : ""}`}>Open review</Link> : <button type="button" aria-expanded={detail?.replayId === item.replayId} onClick={() => void showSavedNotes(item.replayId)}>{detail?.replayId === item.replayId ? "Hide saved notes" : "View saved notes"}</button>}<button aria-label={`Remove ${item.title || "saved replay"} from my reviews`} type="button" disabled={busy} onClick={(event) => { returnFocusRef.current = event.currentTarget; setPending(item); }}><Trash2 size={15} aria-hidden="true" /> Remove</button></div>
        {detail?.replayId === item.replayId ? <section className={styles.notes} aria-label="Saved private notes"><h4>Private notes</h4>{detail.loading ? <p role="status">Loading notes…</p> : detail.error ? <p role="alert">{detail.error}</p> : detail.notes.length ? detail.notes.map((note) => <article key={note.id}><h5>{note.title || "Replay note"}</h5><small>{note.gameNumber ? `Game ${note.gameNumber} · ` : ""}{formatTime(note.atMs)}</small><p>{note.body}</p></article>) : <p>No notes were added to this review.</p>}</section> : null}
        {pending?.replayId === item.replayId ? <div className={styles.confirm} role="group" aria-label="Confirm removal" onKeyDown={(event) => { if (event.key === "Escape" && !busy) cancel(); }}><strong>Remove this saved review?</strong><p>This deletes your private notes for this replay on all devices. The original replay is unchanged.</p><div className={styles.actions}><button ref={cancelRef} type="button" onClick={cancel} disabled={busy}>Keep review</button><button type="button" className={styles.danger} onClick={() => void remove()} disabled={busy}>{busy ? "Removing…" : "Remove review and notes"}</button></div></div> : null}
      </article>)}</div>
      {shown.length === 0 ? <p>No saved replays match this search.</p> : null}
    </> : null}
    {state.status === "ready" && state.cursor ? <button type="button" disabled={loadingMore || busy} onClick={() => void load(state.cursor!)}>{loadingMore ? "Loading…" : "Load more reviews"}</button> : null}
  </section>;
}

function formatDate(value: number) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "recently" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatTime(value: number) {
  const seconds = Math.floor(Math.max(0, value) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
