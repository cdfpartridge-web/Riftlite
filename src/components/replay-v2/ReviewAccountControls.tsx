"use client";

import Link from "next/link";
import type { useReplayAccountReview } from "./useReplayAccountReview";
import styles from "./ReviewAccountControls.module.css";

export function ReviewAccountControls({ account, embedded, editing = false, onResolved }: {
  account: ReturnType<typeof useReplayAccountReview>;
  embedded: boolean;
  editing?: boolean;
  onResolved: () => void;
}) {
  const libraryHref = embedded ? "/replays/embed?scope=reviews" : "/replays?scope=reviews";
  return <section className={styles.controls} aria-label="Save your review">
    {account.status === "loading" ? <p role="status">Checking your saved review…</p> : account.status === "expired" ? <>
      <p className={styles.error} role="alert">Your account session expired.</p>
      <small>{account.hasPendingChanges ? "Your unfinished changes are kept in this tab. Keep it open while reconnecting." : "Your private notes are hidden until your account reconnects."}</small>
      {embedded ? <p>Reconnect your account from RiftLite, then return here and check the connection.</p> : <><a className={styles.primary} href="/account" target="_blank" rel="noopener noreferrer">Sign in again</a><small>Sign in to the same account, then return to this tab.</small></>}
      <button onClick={() => void account.refresh()} type="button">Check account connection</button>
    </> : account.status === "signed-out" ? <>
      <p>Save reviews and private notes to your RiftLite account.</p>
      <a className={styles.primary} href="/account" target="_blank" rel="noopener noreferrer">Sign in to save</a>
      <small>{embedded ? "Reconnect your account in RiftLite, then refresh." : "Return here after signing in."} Browser-only notes stay separate.</small>
    </> : <>
      {account.status === "ready" ? <>
        {account.review ? <p className={styles.saved}>✓ Saved to my reviews</p> : <button className={styles.primary} disabled={account.saving || editing || Boolean(account.pendingNotes)} onClick={() => void account.saveReview()} type="button">{account.saving ? "Saving…" : "Save to my reviews"}</button>}
        <small>{account.saving ? "Saving privately…" : "Private to your account · Synced across devices"}</small>
        {editing || account.pendingNotes ? <small>Save or cancel your note to open My reviews.</small> : <Link href={libraryHref}>My reviews →</Link>}
      </> : null}
      {account.error && <p className={styles.error} role="alert">{account.error}</p>}
      {account.conflict ? <div className={styles.recovery}>
        <p>This review changed on another device. Your unsaved changes are still here.</p>
        <button disabled={account.saving} onClick={() => { if (window.confirm("Discard your unsaved changes and load the latest saved notes?")) void account.reloadLatest().then(loaded => { if (loaded) onResolved(); }); }} type="button">Load latest notes</button>
        <button disabled={account.saving} onClick={() => { if (window.confirm("Replace the latest saved notes with your unsaved version? This also updates your other devices.")) void account.retryDraft().then(saved => { if (saved) onResolved(); }); }} type="button">Use my version</button>
      </div> : account.pendingNotes ? <button disabled={account.saving} onClick={() => void account.retryDraft().then(saved => { if (saved) onResolved(); })} type="button">Retry saving notes</button> : account.status === "error" ? <button onClick={() => void account.refresh()} type="button">Retry account connection</button> : null}
    </>}
  </section>;
}
