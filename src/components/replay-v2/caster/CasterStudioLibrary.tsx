"use client";

import {
  ArrowRight,
  Clapperboard,
  Clock3,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
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
  const [playerQuery, setPlayerQuery] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [selectedLegend, setSelectedLegend] = useState("");
  const [visibility, setVisibility] = useState<"all" | "private" | "unlisted">("all");
  const [visibleCount, setVisibleCount] = useState(96);

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

  const readyReplays = useMemo(() => replays.filter((replay) => replay.status === "ready"), [replays]);
  const playerDirectory = useMemo(() => replayPlayerDirectory(readyReplays), [readyReplays]);
  const legendOptions = useMemo(() => replayLegendOptions(readyReplays), [readyReplays]);
  const visiblePlayers = useMemo(() => {
    const query = normalizeFilterValue(playerQuery);
    return playerDirectory
      .filter((player) => !query || normalizeFilterValue(player.name).includes(query))
      .slice(0, 80);
  }, [playerDirectory, playerQuery]);
  const filteredReplays = useMemo(() => readyReplays.filter((replay) => {
    if (visibility !== "all" && replay.visibility !== visibility) return false;
    const listing = replay.listing;
    if (selectedPlayer) {
      const players = [listing?.playerName, listing?.opponentName].map(normalizeFilterValue);
      if (!players.includes(selectedPlayer)) return false;
    }
    if (selectedLegend) {
      const legends = [listing?.playerLegend, listing?.opponentLegend].map(normalizeFilterValue);
      if (!legends.includes(selectedLegend)) return false;
    }
    return true;
  }), [readyReplays, selectedLegend, selectedPlayer, visibility]);

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
            <b>Replay Research</b>
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
          <span><Sparkles /> PRIVATE META STUDIO</span>
          <h1>Research the replay corpus.</h1>
          <p>
            Browse private and unlisted RiftLite web replays across the community,
            find a player or Legend, and open a blind-review presentation without
            exposing this workspace to ordinary accounts.
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
            {referenceError || "Only the allowlisted Meta Studio account can search or open this corpus."}
          </p>
        </form>
      </section>

      <section className={styles.workflowStrip} aria-label="Replay research workflow">
        <div><span>1</span><p><b>Find a player</b><small>See appearances across private replays</small></p></div>
        <div><span>2</span><p><b>Filter the field</b><small>Narrow by Legend and visibility</small></p></div>
        <div><span>3</span><p><b>Review privately</b><small>Hide player names inside the viewer</small></p></div>
      </section>

      <section className={styles.researchSummary} aria-label="Private replay corpus summary">
        <div><Clapperboard /><span><b>{readyReplays.length.toLocaleString("en-GB")}</b> replays</span></div>
        <div><Users /><span><b>{playerDirectory.length.toLocaleString("en-GB")}</b> players</span></div>
        <div><ShieldCheck /><span><b>{readyReplays.filter((replay) => replay.visibility === "private").length.toLocaleString("en-GB")}</b> private</span></div>
        <div><EyeOff /><span><b>Blind review</b> available</span></div>
      </section>

      <section className={styles.researchWorkspace}>
        <aside className={styles.playerDirectory} aria-label="Players in the replay corpus">
          <header><span>PLAYER DIRECTORY</span><h2>Players and appearances</h2></header>
          <label className={styles.playerSearch}>
            <Search aria-hidden="true" />
            <span className="sr-only">Find a player</span>
            <input
              onChange={(event) => setPlayerQuery(event.currentTarget.value)}
              placeholder="Find a player..."
              value={playerQuery}
            />
          </label>
          <div className={styles.playerList}>
            <button
              className={!selectedPlayer ? styles.playerActive : ""}
              onClick={() => { setSelectedPlayer(""); setVisibleCount(96); }}
              type="button"
            >
              <span>All players</span><b>{readyReplays.length.toLocaleString("en-GB")}</b>
            </button>
            {visiblePlayers.map((player) => (
              <button
                className={selectedPlayer === player.key ? styles.playerActive : ""}
                key={player.key}
                onClick={() => { setSelectedPlayer(player.key); setVisibleCount(96); }}
                type="button"
              >
                <span>{player.name}</span><b>{player.count.toLocaleString("en-GB")}</b>
              </button>
            ))}
          </div>
          {playerDirectory.length > visiblePlayers.length ? (
            <small>Type a name to search all {playerDirectory.length.toLocaleString("en-GB")} players.</small>
          ) : null}
        </aside>

        <div className={styles.researchResults}>
          <div className={styles.researchFilters}>
            <label>
              <span>Legend</span>
              <select onChange={(event) => { setSelectedLegend(event.currentTarget.value); setVisibleCount(96); }} value={selectedLegend}>
                <option value="">All Legends</option>
                {legendOptions.map((legend) => <option key={legend.key} value={legend.key}>{legend.name}</option>)}
              </select>
            </label>
            <label>
              <span>Visibility</span>
              <select
                onChange={(event) => { setVisibility(event.currentTarget.value as typeof visibility); setVisibleCount(96); }}
                value={visibility}
              >
                <option value="all">Private + unlisted</option>
                <option value="private">Private only</option>
                <option value="unlisted">Unlisted only</option>
              </select>
            </label>
            <div className={styles.resultCount}>
              <span>Matching replays</span>
              <b>{filteredReplays.length.toLocaleString("en-GB")}</b>
            </div>
          </div>

      <section className={styles.replaySection}>
        <header>
          <div>
            <span>PRIVATE CORPUS</span>
            <h2>{selectedPlayer ? "Selected player replays" : "Community web replays"}</h2>
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
            <div><b>Replay research did not load</b><p>{error}</p></div>
            <button onClick={refreshReplays} type="button">Try again</button>
          </div>
        ) : loading ? (
          <div className={styles.loadingState}><LoaderCircle /><span>Loading the private replay corpus...</span></div>
        ) : filteredReplays.length ? (
          <div className={styles.replayGrid}>
            {filteredReplays.slice(0, visibleCount).map((replay) => (
              <ReplayCard key={replay.replayId} preview={preview} replay={replay} />
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <Clapperboard />
            <h3>No replays match these filters</h3>
            <p>Clear the player or Legend filter to widen the private corpus.</p>
            <button onClick={() => { setSelectedPlayer(""); setSelectedLegend(""); setVisibility("all"); setVisibleCount(96); }} type="button">
              Clear filters
            </button>
          </div>
        )}
        {filteredReplays.length > visibleCount ? (
          <button className={styles.loadMore} onClick={() => setVisibleCount((value) => value + 96)} type="button">
            Show more replays
          </button>
        ) : null}
      </section>
        </div>
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
        <span className={styles.readyBadge}><i /> {replay.visibility} replay</span>
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

function normalizeFilterValue(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function replayPlayerDirectory(replays: CasterReplaySummary[]) {
  const players = new Map<string, { key: string; name: string; count: number }>();
  for (const replay of replays) {
    const names = new Map(
      [replay.listing?.playerName, replay.listing?.opponentName]
        .map((name) => [normalizeFilterValue(name), name?.trim() ?? ""] as const)
        .filter(([key, name]) => key && name),
    );
    for (const [key, name] of names) {
      const existing = players.get(key);
      players.set(key, existing ? { ...existing, count: existing.count + 1 } : { key, name, count: 1 });
    }
  }
  return [...players.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function replayLegendOptions(replays: CasterReplaySummary[]) {
  const legends = new Map<string, string>();
  for (const replay of replays) {
    for (const name of [replay.listing?.playerLegend, replay.listing?.opponentLegend]) {
      const key = normalizeFilterValue(name);
      if (key && name?.trim()) legends.set(key, name.trim());
    }
  }
  return [...legends].map(([key, name]) => ({ key, name })).sort((left, right) => left.name.localeCompare(right.name));
}
