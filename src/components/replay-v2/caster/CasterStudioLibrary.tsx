"use client";

import {
  ArrowRight,
  Clapperboard,
  Clock3,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { CasterStudioAccess } from "./CasterStudioAccess";
import { parseCasterReplayReference } from "./caster-replay-reference";
import styles from "./CasterStudio.module.css";

type ReplayStatus = "uploading" | "processing" | "ready" | "failed";

type CasterReplaySummary = {
  replayId: string;
  status: ReplayStatus;
  visibility: "private" | "unlisted" | "public";
  title: string;
  platform: string;
  capturedAt?: string;
  createdAt: string;
  updatedAt: string;
  listing?: {
    version: 1;
    playerName: string;
    opponentName: string;
    playerLegend: string;
    opponentLegend: string;
    format: "bo1" | "bo3" | "unknown";
    result: "win" | "loss" | "draw" | "unknown";
  };
  failure?: { code: string; message: string };
};

export function CasterStudioLibrary({
  initialAuthorized,
  preview = false,
}: {
  initialAuthorized: boolean;
  preview?: boolean;
}) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(initialAuthorized || preview);
  const [replays, setReplays] = useState<CasterReplaySummary[]>([]);
  const [loading, setLoading] = useState(initialAuthorized || preview);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const [locking, setLocking] = useState(false);

  const endpoint = preview
    ? "/api/v2/replays?scope=public&limit=24"
    : "/api/meta-studio/caster/replays";

  useEffect(() => {
    if (!authorized) return;
    const controller = new AbortController();

    void fetch(endpoint, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          items?: CasterReplaySummary[];
          error?: string;
        } | null;
        if (response.status === 401 || response.status === 403) {
          if (!preview) setAuthorized(false);
        }
        if (!response.ok) {
          throw new Error(payload?.error ?? "Your recent replays could not be loaded.");
        }
        setReplays(Array.isArray(payload?.items) ? payload.items : []);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error
          ? reason.message
          : "Your recent replays could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [authorized, endpoint, preview, refreshKey]);

  const readyReplays = useMemo(
    () => replays.filter((replay) => replay.status === "ready"),
    [replays],
  );
  const pendingReplays = useMemo(
    () => replays.filter((replay) => replay.status !== "ready"),
    [replays],
  );

  const openReplay = useCallback((replayId: string) => {
    router.push(casterReplayPath(replayId, preview));
  }, [preview, router]);

  const refreshReplays = useCallback(() => {
    setLoading(true);
    setError("");
    setRefreshKey((value) => value + 1);
  }, []);

  function submitReference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const replayId = parseCasterReplayReference(reference);
    if (!replayId) {
      setReferenceError("Paste a RiftLite web replay link or an rl2_ replay ID.");
      return;
    }
    setReferenceError("");
    openReplay(replayId);
  }

  async function lockStudio() {
    if (preview) return;
    setLocking(true);
    setError("");
    try {
      const response = await fetch("/api/meta-studio/session", {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Caster Studio could not lock this session.");
      setAuthorized(false);
      setReplays([]);
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Caster Studio could not lock this session.");
      setLocking(false);
    }
  }

  if (!authorized) return <CasterStudioAccess />;

  return (
    <main className={styles.libraryPage}>
      <div className={styles.libraryGlow} />
      <header className={styles.libraryHeader}>
        <Link className={styles.libraryBrand} href={preview ? "/meta-studio?preview=1" : "/meta-studio"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" src="/brand/riftlite-logo-transparent.png" />
          <div>
            <span>PRIVATE CREATOR WORKSPACE</span>
            <b>Caster Studio</b>
          </div>
        </Link>
        <div className={styles.headerActions}>
          {preview ? <span className={styles.previewBadge}>Local preview</span> : null}
          <Link href={preview ? "/meta-studio?preview=1" : "/meta-studio"}>Meta Studio</Link>
          {!preview ? (
            <button disabled={locking} onClick={() => void lockStudio()} type="button">
              <LockKeyhole /> {locking ? "Locking..." : "Lock studio"}
            </button>
          ) : null}
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span><Sparkles /> BUILT FOR COMMENTARY</span>
          <h1>Turn a replay into a story.</h1>
          <p>
            Open a RiftLite web replay, prepare your talking points, and record
            from a clean presentation view without rebuilding the match by hand.
          </p>
        </div>
        <form className={styles.openReplayForm} onSubmit={submitReference}>
          <label htmlFor="caster-replay-reference">Open a replay</label>
          <div>
            <Search aria-hidden="true" />
            <input
              autoComplete="off"
              id="caster-replay-reference"
              onChange={(event) => {
                setReference(event.currentTarget.value);
                setReferenceError("");
              }}
              placeholder="Paste a web replay link or rl2_ ID"
              value={reference}
            />
            <button type="submit">Open <ArrowRight /></button>
          </div>
          <p aria-live="polite" className={referenceError ? styles.formError : ""}>
            {referenceError || "Private replays stay behind your approved RiftLite account."}
          </p>
        </form>
      </section>

      <section className={styles.workflowStrip} aria-label="Caster Studio workflow">
        <div><span>1</span><p><b>Choose a replay</b><small>Recent matches or any replay link</small></p></div>
        <div><span>2</span><p><b>Prepare the cast</b><small>Bookmarks, cards and talking points</small></p></div>
        <div><span>3</span><p><b>Record cleanly</b><small>A purpose-built 16:9 presentation</small></p></div>
      </section>

      <section className={styles.replaySection}>
        <header>
          <div>
            <span>YOUR LIBRARY</span>
            <h2>Recent web replays</h2>
          </div>
          <button
            aria-label="Refresh recent replays"
            disabled={loading}
            onClick={refreshReplays}
            type="button"
          >
            <RefreshCw className={loading ? styles.spinning : ""} /> Refresh
          </button>
        </header>

        {error ? (
          <div className={styles.errorState} role="alert">
            <ShieldCheck />
            <div><b>Recent replays did not load</b><p>{error}</p></div>
            <button onClick={refreshReplays} type="button">Try again</button>
          </div>
        ) : loading ? (
          <div className={styles.loadingState}><LoaderCircle /><span>Loading your web replays...</span></div>
        ) : readyReplays.length ? (
          <div className={styles.replayGrid}>
            {readyReplays.map((replay) => (
              <ReplayCard key={replay.replayId} preview={preview} replay={replay} />
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <Clapperboard />
            <h3>No ready web replays yet</h3>
            <p>Upload a replay from RiftLite, or paste a public replay link above to start.</p>
            <Link href="/replays">Open replay library <ExternalLink /></Link>
          </div>
        )}

        {pendingReplays.length ? (
          <p className={styles.pendingNote}>
            {pendingReplays.length} recent {pendingReplays.length === 1 ? "replay is" : "replays are"}
            {" "}still processing or need attention in the main replay library.
          </p>
        ) : null}
      </section>
    </main>
  );
}

function ReplayCard({ replay, preview }: { replay: CasterReplaySummary; preview: boolean }) {
  const title = replayTitle(replay);
  const detail = replayDetail(replay);
  const capturedAt = replay.capturedAt || replay.createdAt;
  return (
    <Link className={styles.replayCard} href={casterReplayPath(replay.replayId, preview)}>
      <div className={styles.replayCardArt}>
        <Clapperboard />
        <span>{replay.platform || "replay"}</span>
      </div>
      <div className={styles.replayCardBody}>
        <span className={styles.readyBadge}><i /> Ready to cast</span>
        <h3>{title}</h3>
        <p>{detail}</p>
        <footer>
          <span><Clock3 /> {formatReplayDate(capturedAt)}</span>
          <b>Open studio <ArrowRight /></b>
        </footer>
      </div>
    </Link>
  );
}

function replayTitle(replay: CasterReplaySummary): string {
  const player = replay.listing?.playerName.trim();
  const opponent = replay.listing?.opponentName.trim();
  if (player && opponent) return `${player} vs ${opponent}`;
  return replay.title.trim() || "Untitled replay";
}

function replayDetail(replay: CasterReplaySummary): string {
  const playerLegend = replay.listing?.playerLegend.trim();
  const opponentLegend = replay.listing?.opponentLegend.trim();
  if (playerLegend && opponentLegend) return `${playerLegend} vs ${opponentLegend}`;
  const format = replay.listing?.format;
  return [format && format !== "unknown" ? format.toUpperCase() : "", replay.visibility]
    .filter(Boolean)
    .join(" · ");
}

function formatReplayDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

function casterReplayPath(replayId: string, preview: boolean): string {
  const path = `/meta-studio/caster/${encodeURIComponent(replayId)}`;
  return preview ? `${path}?preview=1` : path;
}
