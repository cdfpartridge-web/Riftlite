"use client";

import { useEffect, useRef, useState } from "react";
import { getAuth } from "firebase/auth";
import { Globe2, Link2, LoaderCircle, LockKeyhole, X } from "lucide-react";
import { firebaseClientApp } from "@/lib/firebase/client";
import styles from "./ReplayLibrary.module.css";

export type ReplayVisibility = "private" | "unlisted" | "public";
type VisibilityReplay = { replayId: string; title: string; visibility: ReplayVisibility };

const choices = [
  { value: "public", label: "Public", description: "Anyone can watch and find it in Public replays.", Icon: Globe2 },
  { value: "unlisted", label: "Unlisted", description: "Anyone with the link can watch. It stays out of Public replays.", Icon: Link2 },
  { value: "private", label: "Private", description: "Only your account and people you explicitly share it with can watch.", Icon: LockKeyhole },
] as const;

export function ReplayVisibilityDialog({ replayId, replay, onClose, onSaved }: {
  replayId: string;
  replay?: VisibilityReplay;
  onClose: () => void;
  onSaved?: (visibility: ReplayVisibility) => void;
}) {
  const [loaded, setLoaded] = useState<VisibilityReplay | null>(replay ?? null);
  const [selected, setSelected] = useState<ReplayVisibility | null>(replay?.visibility ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const saveRef = useRef(false);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    if (replay) return;
    const controller = new AbortController();
    void visibilityRequest(replayId, { signal: controller.signal }, true).then((next) => {
      if (!controller.signal.aborted) {
        setLoaded(next);
        setSelected(next.visibility);
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(message(cause));
    });
    return () => controller.abort();
  }, [replay, replayId]);

  async function save() {
    if (!loaded || !selected || selected === loaded.visibility || saveRef.current) return;
    saveRef.current = true;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const next = await visibilityRequest(replayId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: selected }),
      });
      if (next.visibility !== selected) throw new Error("The server did not confirm the change. Check this replay and try again.");
      setLoaded({ ...loaded, visibility: next.visibility });
      setSaved(true);
      onSaved?.(next.visibility);
      window.requestAnimationFrame(() => closeRef.current?.focus());
    } catch (cause) {
      setError(message(cause));
    } finally {
      saveRef.current = false;
      busyRef.current = false;
      setBusy(false);
    }
  }

  return <div className={styles.deleteDialogBackdrop} onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busyRef.current) onClose();
  }}>
    <section aria-labelledby="visibility-dialog-title" aria-describedby="visibility-dialog-description" aria-modal="true"
      className={styles.visibilityDialog} role="dialog" ref={dialogRef} onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !busyRef.current) { event.preventDefault(); onClose(); }
        if (event.key === "Tab") {
          const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
          const first = focusable?.[0];
          const last = focusable?.[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <div className={styles.visibilityDialogHeader}>
        <div><span className={styles.sectionKicker}>This web replay</span><h2 id="visibility-dialog-title">Change visibility</h2></div>
        <button aria-label="Close visibility settings" ref={closeRef} disabled={busy} onClick={onClose} type="button"><X size={20} /></button>
      </div>
      {loaded?.title ? <p className={styles.visibilityTitle}>{loaded.title}</p> : null}
      <p id="visibility-dialog-description">Choose who can watch this replay. Your default for future uploads stays the same.</p>
      {!loaded && !error ? <p role="status"><LoaderCircle className={styles.spinning} size={16} /> Loading current visibility…</p> : null}
      {loaded ? <fieldset className={styles.visibilityChoices} disabled={busy}>
        <legend>Who can watch?</legend>
        {choices.map(({ value, label, description, Icon }) => <label key={value} data-selected={selected === value}>
          <input type="radio" name="replay-visibility-choice" value={value} checked={selected === value} onChange={() => { setSelected(value); setSaved(false); setError(""); }} />
          <Icon aria-hidden="true" size={20} /><span><strong>{label}</strong><small>{description}</small></span>
        </label>)}
      </fieldset> : null}
      {error ? <p className={styles.deleteDialogError} role="alert">{error}</p> : null}
      {saved && loaded ? <p className={styles.visibilitySuccess} role="status">Saved. This replay is now {loaded.visibility}. Its link has not changed.</p> : null}
      <div className={styles.deleteDialogActions}>
        <button disabled={busy} onClick={onClose} type="button">{saved ? "Done" : "Cancel"}</button>
        {loaded ? <button className={styles.primaryButton} disabled={busy || !selected || selected === loaded.visibility} onClick={() => void save()} type="button">
          {busy ? <LoaderCircle className={styles.spinning} size={16} /> : null}{busy ? "Saving…" : "Save visibility"}
        </button> : null}
      </div>
    </section>
  </div>;
}

async function visibilityRequest(replayId: string, init: RequestInit, read = false): Promise<VisibilityReplay> {
  const headers = new Headers(init.headers);
  try {
    const auth = getAuth(firebaseClientApp);
    await auth.authStateReady();
    if (auth.currentUser && !auth.currentUser.isAnonymous) headers.set("Authorization", `Bearer ${await auth.currentUser.getIdToken()}`);
  } catch { /* The desktop's HttpOnly account session is also accepted. */ }
  const response = await fetch(`/api/v2/replays/${encodeURIComponent(replayId)}${read ? "?manage=visibility" : ""}`, {
    ...init, headers, credentials: "include", cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your account session has expired. Reopen this replay from RiftLite, or sign in on the website, and try again.");
    if (payload?.code === "replay_owner_required") throw new Error("Only the account that uploaded this replay can change its visibility.");
    throw new Error(typeof payload?.error === "string" ? payload.error : "Visibility could not be changed. Please try again.");
  }
  const replay = payload?.replay;
  if (replay?.replayId !== replayId || !["private", "unlisted", "public"].includes(replay?.visibility)) {
    throw new Error("The server did not confirm this replay's visibility. Please try again.");
  }
  return { replayId, visibility: replay.visibility, title: typeof replay.title === "string" ? replay.title : "" };
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : "Visibility could not be changed. Please try again."; }
