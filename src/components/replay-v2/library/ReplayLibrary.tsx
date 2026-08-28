"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Copy,
  ExternalLink,
  Globe2,
  GitMerge,
  Link2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Share2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { getAuth, onIdTokenChanged, type User } from "firebase/auth";

import { firebaseClientApp } from "@/lib/firebase/client";
import {
  prepareReplayUpload,
  type PreparedReplayUpload,
} from "@/components/replay-v2/library/upload-helpers";

import styles from "./ReplayLibrary.module.css";

type ReplayScope = "public" | "mine";
type ReplayVisibility = "private" | "unlisted" | "public";
type ReplayStatus = "uploading" | "processing" | "ready" | "failed";
type ReplayFormat = "bo1" | "bo3" | "unknown";
type ReplayResult = "win" | "loss" | "draw" | "unknown";
type ReplaySort = "newest" | "oldest" | "player-legend" | "opponent-legend";

type ReplayListingMetadata = {
  version: 1;
  playerName: string;
  opponentName: string;
  playerLegend: string;
  opponentLegend: string;
  format: ReplayFormat;
  result: ReplayResult;
};

type ReplaySummary = {
  replayId: string;
  visibility: ReplayVisibility;
  status: ReplayStatus;
  title: string;
  platform: string;
  messageCount: number | null;
  listing?: ReplayListingMetadata;
  capturedAt?: string;
  createdAt: string;
  updatedAt: string;
  failure?: {
    code: string;
    message: string;
  };
  warnings?: Array<{
    code: string;
    message: string;
  }>;
};

type UploadStage =
  | "idle"
  | "preparing"
  | "ready"
  | "initializing"
  | "uploading"
  | "processing"
  | "complete"
  | "error";

type UploadState = {
  stage: UploadStage;
  progress: number;
  message: string;
  replayId?: string;
};

type InitReplayResponse = {
  replay?: ReplaySummary;
  uploadRequired?: boolean;
  upload?: {
    method?: string;
    endpoint?: string;
    contentType?: string;
    headers?: Record<string, string>;
  } | null;
  completeEndpoint?: string;
  statusEndpoint?: string;
  playerPath?: string;
};

const INITIAL_UPLOAD_STATE: UploadState = {
  stage: "idle",
  progress: 0,
  message: "Choose a raw capture to begin.",
};

const visibilityCopy: Record<ReplayVisibility, string> = {
  private: "Only you can open it.",
  unlisted: "Anyone with its permanent link can watch.",
  public: "Listed here for everyone to discover.",
};

export function ReplayLibrary({
  embedded = false,
  initialScope = "public",
}: {
  embedded?: boolean;
  initialScope?: ReplayScope;
}) {
  const auth = useMemo(() => getAuth(firebaseClientApp), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement>(null);
  const deleteReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const [scope, setScope] = useState<ReplayScope>(embedded ? "mine" : initialScope);
  const [authReady, setAuthReady] = useState(embedded);
  const [user, setUser] = useState<User | null>(null);
  const [publicReplays, setPublicReplays] = useState<ReplaySummary[]>([]);
  const [myReplays, setMyReplays] = useState<ReplaySummary[]>([]);
  const [publicLoading, setPublicLoading] = useState(!embedded && initialScope === "public");
  const [publicLoaded, setPublicLoaded] = useState(false);
  const [publicLoadingMore, setPublicLoadingMore] = useState(false);
  const [mineLoading, setMineLoading] = useState(false);
  const [publicError, setPublicError] = useState("");
  const [publicMoreError, setPublicMoreError] = useState("");
  const [publicNextCursor, setPublicNextCursor] = useState<string | null>(null);
  const [publicHasMore, setPublicHasMore] = useState(false);
  const [mineError, setMineError] = useState("");
  const [embeddedOwnerUnavailable, setEmbeddedOwnerUnavailable] = useState(false);
  const [prepared, setPrepared] = useState<PreparedReplayUpload | null>(null);
  const [visibility, setVisibility] = useState<ReplayVisibility>("private");
  const [uploadState, setUploadState] = useState<UploadState>(INITIAL_UPLOAD_STATE);
  const [busyReplayId, setBusyReplayId] = useState("");
  const [cardMessages, setCardMessages] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<ReplaySummary | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [search, setSearch] = useState("");
  const [playerLegend, setPlayerLegend] = useState("");
  const [opponentLegend, setOpponentLegend] = useState("");
  const [format, setFormat] = useState<"" | ReplayFormat>("");
  const [result, setResult] = useState<"" | ReplayResult>("");
  const [status, setStatus] = useState<"" | ReplayStatus>("");
  const [visibilityFilter, setVisibilityFilter] = useState<"" | ReplayVisibility>("");
  const [sort, setSort] = useState<ReplaySort>("newest");

  const resetFilters = useCallback(() => {
    setSearch("");
    setPlayerLegend("");
    setOpponentLegend("");
    setFormat("");
    setResult("");
    setStatus("");
    setVisibilityFilter("");
    setSort("newest");
  }, []);

  const closeDeleteDialog = useCallback(() => {
    if (pendingDelete && busyReplayId === pendingDelete.replayId) return;
    setPendingDelete(null);
    setDeleteError("");
    window.setTimeout(() => deleteReturnFocusRef.current?.focus(), 0);
  }, [busyReplayId, pendingDelete]);

  useEffect(() => {
    return onIdTokenChanged(
      auth,
      (nextUser) => {
        const linkedUser = nextUser && !nextUser.isAnonymous ? nextUser : null;
        setUser(linkedUser);
        setAuthReady(true);
        if (!linkedUser) {
          setMyReplays([]);
          setMineError("");
        }
      },
      () => {
        setUser(null);
        setAuthReady(true);
      },
    );
  }, [auth]);

  useEffect(() => {
    if (!pendingDelete) return;
    deleteConfirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busyReplayId !== pendingDelete.replayId) {
        event.preventDefault();
        closeDeleteDialog();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busyReplayId, closeDeleteDialog, pendingDelete]);

  const loadPublicReplays = useCallback(async (cursor: string | null = null) => {
    const append = Boolean(cursor);
    if (append) {
      setPublicLoadingMore(true);
      setPublicMoreError("");
    } else {
      setPublicLoading(true);
      setPublicError("");
      setPublicMoreError("");
      setPublicNextCursor(null);
      setPublicHasMore(false);
    }
    try {
      const endpoint = cursor
        ? `/api/v2/replays?scope=public&cursor=${encodeURIComponent(cursor)}`
        : "/api/v2/replays?scope=public";
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(apiError(payload, "Public replays are unavailable right now."));
      const items = readReplayItems(payload);
      const pageInfo = readReplayPageInfo(payload);
      setPublicReplays((current) => append ? mergeReplayItems(current, items) : items);
      setPublicNextCursor(pageInfo.nextCursor);
      setPublicHasMore(pageInfo.hasMore);
      setPublicLoaded(true);
    } catch (error) {
      const message = errorMessage(error, "Public replays are unavailable right now.");
      if (append) setPublicMoreError(message);
      else setPublicError(message);
    } finally {
      if (append) setPublicLoadingMore(false);
      else setPublicLoading(false);
    }
  }, []);

  const loadMyReplays = useCallback(async (activeUser: User | null) => {
    setMineLoading(true);
    setMineError("");
    try {
      const response = activeUser
        ? await authenticatedFetch(activeUser, "/api/v2/replays?scope=mine", { cache: "no-store" })
        : await fetch("/api/v2/replays?scope=mine", {
            cache: "no-store",
            credentials: "include",
          });
      const payload = await readJson(response);
      if (embedded && response.status === 401) {
        setMyReplays([]);
        setMineError("");
        setEmbeddedOwnerUnavailable(true);
        setScope("public");
        resetFilters();
        return;
      }
      if (!response.ok) throw new Error(apiError(payload, "Your replays could not be loaded."));
      setEmbeddedOwnerUnavailable(false);
      setMyReplays(readReplayItems(payload));
    } catch (error) {
      setMineError(errorMessage(error, "Your replays could not be loaded."));
    } finally {
      setMineLoading(false);
    }
  }, [embedded, resetFilters]);

  useEffect(() => {
    if (scope === "public" && !publicLoaded) void loadPublicReplays();
  }, [loadPublicReplays, publicLoaded, scope]);

  useEffect(() => {
    if (scope === "mine" && authReady && (user || embedded)) void loadMyReplays(user);
  }, [authReady, embedded, loadMyReplays, scope, user]);

  useEffect(() => {
    if (scope !== "mine" || (!user && !embedded) || !myReplays.some((replay) => replay.status === "processing")) return;

    let timer: number | undefined;
    const stopPolling = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };
    const poll = () => void loadMyReplays(user);
    const startPolling = () => {
      if (document.visibilityState !== "visible" || timer !== undefined) return;
      timer = window.setInterval(poll, 5_000);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        stopPolling();
        return;
      }
      poll();
      startPolling();
    };

    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopPolling();
    };
  }, [embedded, loadMyReplays, myReplays, scope, user]);

  async function selectFile(file: File | undefined) {
    if (!file) return;
    setPrepared(null);
    setUploadState({ stage: "preparing", progress: 8, message: "Checking and compressing capture…" });
    try {
      const nextPrepared = await prepareReplayUpload(file);
      setPrepared(nextPrepared);
      setUploadState({
        stage: "ready",
        progress: 24,
        message: `${nextPrepared.messageCount.toLocaleString("en-GB")} captured messages checked. Ready to upload.`,
      });
    } catch (error) {
      setUploadState({
        stage: "error",
        progress: 0,
        message: errorMessage(error, "This capture could not be prepared."),
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function uploadPreparedCapture() {
    if (!prepared || !user) return;

    try {
      setUploadState({ stage: "initializing", progress: 32, message: "Reserving its permanent replay link…" });
      const token = await user.getIdToken();
      const initResponse = await fetch("/api/v2/replays/init", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          captureId: prepared.captureId,
          sha256: prepared.sha256,
          bytes: prepared.bytes.byteLength,
          visibility,
          platform: prepared.platform,
          messageCount: prepared.messageCount,
          ...(prepared.capturedAt ? { capturedAt: prepared.capturedAt } : {}),
        }),
      });
      const initPayload = (await readJson(initResponse)) as InitReplayResponse & Record<string, unknown>;
      if (!initResponse.ok) throw new Error(apiError(initPayload, "Replay upload could not be initialized."));

      const replayId = readReplayId(initPayload);
      if (!replayId) throw new Error("Replay upload returned an invalid permanent link.");

      await ensureReplayVisibility(token, replayId, visibility, replayVisibilityFromPayload(initPayload));

      if (initPayload.uploadRequired) {
        const upload = initPayload.upload;
        if (!upload || upload.method !== "PUT" || !safeApiPath(upload.endpoint)) {
          throw new Error("Replay upload returned an invalid upload destination.");
        }

        setUploadState({ stage: "uploading", progress: 42, message: "Uploading private source capture…", replayId });
        await putReplayBytes({
          endpoint: upload.endpoint,
          token,
          bytes: prepared.bytes,
          headers: upload.headers,
          onProgress(progress) {
            setUploadState({
              stage: "uploading",
              progress: 42 + Math.round(progress * 0.38),
              message: "Uploading private source capture…",
              replayId,
            });
          },
        });
      }

      if (!safeApiPath(initPayload.completeEndpoint)) {
        throw new Error("Replay upload returned an invalid processing destination.");
      }
      setUploadState({ stage: "processing", progress: 86, message: "Building the deterministic replay…", replayId });
      const completeResponse = await fetch(initPayload.completeEndpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const completePayload = await readJson(completeResponse);
      if (!completeResponse.ok) {
        throw new Error(apiError(completePayload, "Replay processing did not complete."));
      }
      await ensureReplayVisibility(token, replayId, visibility, replayVisibilityFromPayload(completePayload));

      setPrepared(null);
      setUploadState({
        stage: "complete",
        progress: 100,
        message: "Replay ready. Its permanent link will not change.",
        replayId,
      });
      setScope("mine");
      await Promise.all([
        loadMyReplays(user),
        visibility === "public" ? loadPublicReplays() : Promise.resolve(),
      ]);
    } catch (error) {
      setUploadState((current) => ({
        ...current,
        stage: "error",
        message: errorMessage(error, "Replay upload stopped before completion."),
      }));
    }
  }

  async function updateVisibility(replay: ReplaySummary, nextVisibility: ReplayVisibility) {
    if (!user || replay.visibility === nextVisibility) return;
    setBusyReplayId(replay.replayId);
    setCardMessage(replay.replayId, "Saving visibility…");
    try {
      const response = await authenticatedFetch(
        user,
        `/api/v2/replays/${encodeURIComponent(replay.replayId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility: nextVisibility }),
        },
      );
      const payload = await readJson(response);
      if (!response.ok) throw new Error(apiError(payload, "Visibility could not be changed."));
      setMyReplays((current) =>
        current.map((item) =>
          item.replayId === replay.replayId ? { ...item, visibility: nextVisibility } : item,
        ),
      );
      setCardMessage(replay.replayId, `Visibility set to ${nextVisibility}.`);
      await loadPublicReplays();
    } catch (error) {
      setCardMessage(replay.replayId, errorMessage(error, "Visibility could not be changed."));
    } finally {
      setBusyReplayId("");
    }
  }

  async function retryProcessing(replayId: string) {
    if (!user) return;
    setBusyReplayId(replayId);
    setCardMessage(replayId, "Retrying replay processing…");
    try {
      const response = await authenticatedFetch(
        user,
        `/api/v2/replays/${encodeURIComponent(replayId)}/complete`,
        { method: "POST" },
      );
      const payload = await readJson(response);
      if (!response.ok) throw new Error(apiError(payload, "Replay processing could not be retried."));
      setCardMessage(replayId, "Replay processing completed.");
      await Promise.all([loadMyReplays(user), loadPublicReplays()]);
    } catch (error) {
      setCardMessage(replayId, errorMessage(error, "Replay processing could not be retried."));
    } finally {
      setBusyReplayId("");
    }
  }

  function requestReplayDelete(replay: ReplaySummary, trigger: HTMLButtonElement) {
    deleteReturnFocusRef.current = trigger;
    setDeleteError("");
    setPendingDelete(replay);
  }

  async function confirmReplayDelete() {
    if (!pendingDelete || (!user && !embedded)) return;
    const replay = pendingDelete;
    setBusyReplayId(replay.replayId);
    setDeleteError("");
    try {
      const endpoint = `/api/v2/replays/${encodeURIComponent(replay.replayId)}`;
      const response = user
        ? await authenticatedFetch(user, endpoint, { method: "DELETE" })
        : await fetch(endpoint, { method: "DELETE", credentials: "include" });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(apiError(payload, "Replay could not be deleted."));
      setMyReplays((current) => current.filter((item) => item.replayId !== replay.replayId));
      setPublicReplays((current) => current.filter((item) => item.replayId !== replay.replayId));
      setCardMessages((current) => {
        const next = { ...current };
        delete next[replay.replayId];
        return next;
      });
      setPendingDelete(null);
    } catch (error) {
      setDeleteError(errorMessage(error, "Replay could not be deleted."));
    } finally {
      setBusyReplayId("");
    }
  }

  function setCardMessage(replayId: string, message: string) {
    setCardMessages((current) => ({ ...current, [replayId]: message }));
  }

  async function copyLink(replay: ReplaySummary) {
    try {
      await navigator.clipboard.writeText(replayUrl(replay.replayId));
      setCardMessage(replay.replayId, "Permanent link copied.");
    } catch {
      setCardMessage(replay.replayId, "Copy was blocked by the browser.");
    }
  }

  async function shareReplay(replay: ReplaySummary) {
    const url = replayUrl(replay.replayId);
    if (!navigator.share) {
      await copyLink(replay);
      return;
    }
    try {
      await navigator.share({ title: replay.title, url });
      setCardMessage(replay.replayId, "Replay shared.");
    } catch (error) {
      if (isAbortError(error)) return;
      setCardMessage(replay.replayId, "Sharing was blocked by the browser.");
    }
  }

  const sourceReplays = scope === "public" ? publicReplays : myReplays;
  const playerLegends = useMemo(() => replayLegendOptions(sourceReplays, "playerLegend"), [sourceReplays]);
  const opponentLegends = useMemo(() => replayLegendOptions(sourceReplays, "opponentLegend"), [sourceReplays]);
  const displayedReplays = useMemo(() => filterAndSortReplays(sourceReplays, {
    search,
    playerLegend,
    opponentLegend,
    format,
    result,
    status,
    visibility: visibilityFilter,
    sort,
  }), [format, opponentLegend, playerLegend, result, search, sort, sourceReplays, status, visibilityFilter]);
  const filtersActive = Boolean(search || playerLegend || opponentLegend || format || result || status || visibilityFilter || sort !== "newest");
  const loading = scope === "public" ? publicLoading : mineLoading;
  const listError = scope === "public" ? publicError : mineError;
  const uploadBusy = ["preparing", "initializing", "uploading", "processing"].includes(uploadState.stage);

  return (
    <main
      className={`${styles.page} ${embedded ? styles.embeddedPage : ""}`}
      data-replay-library-embedded={embedded ? "true" : undefined}
    >
      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.eyebrow}><span /> RiftLite Replay</div>
        <div className={styles.heroContent}>
          <div>
            <h1>Every match, rebuilt as a living board.</h1>
            <p>
              Watch deterministic Atlas and TCGA replays, share a permanent link, upload a private capture, or combine
              two consented perspectives into one unlisted replay.
            </p>
          </div>
          <div className={styles.heroTrust}>
            <ShieldCheck aria-hidden="true" size={22} />
            <div>
              <strong>Raw captures stay private</strong>
              <span>Only the processed replay follows your chosen visibility.</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.libraryShell}>
        <div className={styles.toolbar}>
          <div className={styles.tabs} role="tablist" aria-label="Replay library views">
            <button
              aria-selected={scope === "public"}
              className={scope === "public" ? styles.activeTab : undefined}
              onClick={() => { setScope("public"); resetFilters(); }}
              role="tab"
              type="button"
            >
              <Globe2 aria-hidden="true" size={17} /> Public replays
            </button>
            <button
              aria-selected={scope === "mine"}
              className={scope === "mine" ? styles.activeTab : undefined}
              disabled={embedded && embeddedOwnerUnavailable}
              onClick={() => { setScope("mine"); resetFilters(); }}
              role="tab"
              type="button"
            >
              <LockKeyhole aria-hidden="true" size={17} /> My replays
            </button>
          </div>
          <div className={styles.toolbarActions}>
            {!embedded ? (
              <Link className={styles.combineLink} href="/replays/combine">
                <GitMerge aria-hidden="true" size={16} /> Combine two replays
              </Link>
            ) : null}
            <button
              className={styles.refreshButton}
              disabled={loading || publicLoadingMore || (scope === "mine" && !user && !embedded)}
              onClick={() => void (scope === "public" ? loadPublicReplays() : loadMyReplays(user))}
              type="button"
            >
              <RefreshCw aria-hidden="true" className={loading ? styles.spinning : undefined} size={16} />
              Refresh
            </button>
          </div>
        </div>

        {scope === "mine" && !embedded ? (
          <UploadPanel
            authReady={authReady}
            busy={uploadBusy}
            onFile={(file) => void selectFile(file)}
            onUpload={() => void uploadPreparedCapture()}
            prepared={prepared}
            fileInputRef={fileInputRef}
            state={uploadState}
            user={user}
            visibility={visibility}
            onVisibility={setVisibility}
          />
        ) : null}

        {!authReady && scope === "mine" ? <LoadingPanel label="Checking your RiftLite account…" /> : null}

        {authReady && scope === "mine" && !user && !embedded ? (
          <section className={styles.accountPanel}>
            <LockKeyhole aria-hidden="true" size={25} />
            <div>
              <h2>Sign in to manage your replays</h2>
              <p>Your linked RiftLite account unlocks private uploads, visibility controls, and your replay history.</p>
            </div>
          </section>
        ) : null}

        {embedded && embeddedOwnerUnavailable ? (
          <section className={styles.accountPanel}>
            <LockKeyhole aria-hidden="true" size={25} />
            <div>
              <h2>Showing public replays</h2>
              <p>Reconnect your account in RiftLite, then refresh this tab to open your private replay library.</p>
            </div>
          </section>
        ) : null}

        {scope === "public" || (authReady && (user || embedded)) ? (
          <section aria-live="polite" className={styles.results}>
            <div className={styles.resultsHeading}>
              <div>
                <span>{scope === "public" ? "Discover" : "Your collection"}</span>
                <h2>{scope === "public" ? "Public match replays" : "Uploaded replays"}</h2>
              </div>
              {!loading && !listError ? (
                <p>{displayedReplays.length === sourceReplays.length ? displayedReplays.length : `${displayedReplays.length} of ${sourceReplays.length}`} replay{displayedReplays.length === sourceReplays.length && displayedReplays.length === 1 ? "" : "s"}</p>
              ) : null}
            </div>

            {!loading && !listError && sourceReplays.length > 0 ? (
              <ReplayFilters
                filters={{ search, playerLegend, opponentLegend, format, result, status, visibility: visibilityFilter, sort }}
                mine={scope === "mine"}
                opponentLegends={opponentLegends}
                playerLegends={playerLegends}
                onChange={(field, value) => {
                  if (field === "search") setSearch(value);
                  if (field === "playerLegend") setPlayerLegend(value);
                  if (field === "opponentLegend") setOpponentLegend(value);
                  if (field === "format") setFormat(value as "" | ReplayFormat);
                  if (field === "result") setResult(value as "" | ReplayResult);
                  if (field === "status") setStatus(value as "" | ReplayStatus);
                  if (field === "visibility") setVisibilityFilter(value as "" | ReplayVisibility);
                  if (field === "sort") setSort(value as ReplaySort);
                }}
                onClear={resetFilters}
                showClear={filtersActive}
              />
            ) : null}

            {loading ? <ReplayGridSkeleton /> : null}
            {!loading && listError ? (
              <NoticePanel icon="error" message={listError} />
            ) : null}
            {!loading && !listError && sourceReplays.length === 0 ? (
              <EmptyLibrary embedded={embedded} scope={scope} />
            ) : null}
            {!loading && !listError && sourceReplays.length > 0 && displayedReplays.length === 0 ? (
              <div className={styles.emptyPanel}>
                <h3>No replays match these filters</h3>
                <p>Try a different legend, opponent, or search term.</p>
                <button className={styles.clearFilters} onClick={resetFilters} type="button">Clear filters</button>
              </div>
            ) : null}
            {!loading && !listError && displayedReplays.length > 0 ? (
              <div className={styles.replayGrid}>
                {displayedReplays.map((replay) => (
                  <ReplayCard
                    busy={busyReplayId === replay.replayId}
                    canDelete={scope === "mine" && Boolean(user || (embedded && !embeddedOwnerUnavailable))}
                    embedded={embedded}
                    key={replay.replayId}
                    message={cardMessages[replay.replayId]}
                    mine={scope === "mine" && Boolean(user)}
                    onCopy={() => void copyLink(replay)}
                    onDelete={(trigger) => requestReplayDelete(replay, trigger)}
                    onRetry={() => void retryProcessing(replay.replayId)}
                    onShare={() => void shareReplay(replay)}
                    onVisibility={(next) => void updateVisibility(replay, next)}
                    replay={replay}
                  />
                ))}
              </div>
            ) : null}
            {!loading && !listError && scope === "public" && sourceReplays.length > 0 && (publicHasMore || publicMoreError) ? (
              <div className={styles.paginationPanel}>
                <p>
                  {publicMoreError || `${publicReplays.length} replays loaded. Keep exploring the public archive.`}
                </p>
                <button
                  disabled={publicLoadingMore || !publicNextCursor}
                  onClick={() => void loadPublicReplays(publicNextCursor)}
                  type="button"
                >
                  {publicLoadingMore ? <LoaderCircle aria-hidden="true" className={styles.spinning} size={16} /> : null}
                  {publicLoadingMore ? "Loading more…" : publicMoreError ? "Try loading again" : "Load more replays"}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </section>
      {pendingDelete ? (
        <div
          className={styles.deleteDialogBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDeleteDialog();
          }}
        >
          <section
            aria-describedby="delete-replay-description"
            aria-labelledby="delete-replay-title"
            aria-modal="true"
            className={styles.deleteDialog}
            role="dialog"
          >
            <span className={styles.deleteDialogIcon}><Trash2 aria-hidden="true" size={22} /></span>
            <div>
              <span className={styles.sectionKicker}>Permanent action</span>
              <h2 id="delete-replay-title">Delete this Web Replay?</h2>
              <p id="delete-replay-description">
                <strong>{replayCardTitle(pendingDelete)}</strong> and its uploaded replay data will be permanently removed.
                Existing links will stop working. This cannot be undone.
              </p>
              {deleteError ? <p className={styles.deleteDialogError} role="alert">{deleteError}</p> : null}
            </div>
            <div className={styles.deleteDialogActions}>
              <button
                disabled={busyReplayId === pendingDelete.replayId}
                onClick={closeDeleteDialog}
                type="button"
              >
                Cancel
              </button>
              <button
                className={styles.confirmDeleteButton}
                disabled={busyReplayId === pendingDelete.replayId}
                onClick={() => void confirmReplayDelete()}
                ref={deleteConfirmRef}
                type="button"
              >
                {busyReplayId === pendingDelete.replayId
                  ? <LoaderCircle aria-hidden="true" className={styles.spinning} size={16} />
                  : <Trash2 aria-hidden="true" size={16} />}
                {busyReplayId === pendingDelete.replayId ? "Deleting…" : "Delete replay"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

type FilterValues = {
  search: string;
  playerLegend: string;
  opponentLegend: string;
  format: "" | ReplayFormat;
  result: "" | ReplayResult;
  status: "" | ReplayStatus;
  visibility: "" | ReplayVisibility;
  sort: ReplaySort;
};

function ReplayFilters({ filters, mine, onChange, onClear, opponentLegends, playerLegends, showClear }: {
  filters: FilterValues;
  mine: boolean;
  onChange: (field: keyof FilterValues, value: string) => void;
  onClear: () => void;
  opponentLegends: string[];
  playerLegends: string[];
  showClear: boolean;
}) {
  return (
    <div className={styles.filters} aria-label="Replay filters">
      <label className={styles.searchFilter}>
        <span>Search</span>
        <input onChange={(event) => onChange("search", event.target.value)} placeholder="Player, opponent, or replay" type="search" value={filters.search} />
      </label>
      <FilterSelect label="Player legend" onChange={(value) => onChange("playerLegend", value)} value={filters.playerLegend}>
        <option value="">All legends</option>
        {playerLegends.map((legend) => <option key={legend} value={legend}>{legend}</option>)}
      </FilterSelect>
      <FilterSelect label="Opponent legend" onChange={(value) => onChange("opponentLegend", value)} value={filters.opponentLegend}>
        <option value="">All opponents</option>
        {opponentLegends.map((legend) => <option key={legend} value={legend}>{legend}</option>)}
      </FilterSelect>
      <FilterSelect label="Format" onChange={(value) => onChange("format", value)} value={filters.format}>
        <option value="">All formats</option><option value="bo1">BO1</option><option value="bo3">BO3</option>
      </FilterSelect>
      <FilterSelect label="Result" onChange={(value) => onChange("result", value)} value={filters.result}>
        <option value="">All results</option><option value="win">Win</option><option value="loss">Loss</option><option value="draw">Draw</option>
      </FilterSelect>
      {mine ? (
        <>
          <FilterSelect label="Status" onChange={(value) => onChange("status", value)} value={filters.status}>
            <option value="">All statuses</option><option value="ready">Ready</option><option value="processing">Processing</option><option value="uploading">Uploading</option><option value="failed">Failed</option>
          </FilterSelect>
          <FilterSelect label="Visibility" onChange={(value) => onChange("visibility", value)} value={filters.visibility}>
            <option value="">All visibility</option><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option>
          </FilterSelect>
        </>
      ) : null}
      <FilterSelect label="Sort" onChange={(value) => onChange("sort", value)} value={filters.sort}>
        <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="player-legend">Player legend A-Z</option><option value="opponent-legend">Opponent legend A-Z</option>
      </FilterSelect>
      {showClear ? <button className={styles.clearFilters} onClick={onClear} type="button">Clear</button> : null}
    </div>
  );
}

function FilterSelect({ children, label, onChange, value }: {
  children: React.ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return <label><span>{label}</span><select onChange={(event) => onChange(event.target.value)} value={value}>{children}</select></label>;
}

function UploadPanel({
  authReady,
  busy,
  fileInputRef,
  onFile,
  onUpload,
  onVisibility,
  prepared,
  state,
  user,
  visibility,
}: {
  authReady: boolean;
  busy: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File | undefined) => void;
  onUpload: () => void;
  onVisibility: (visibility: ReplayVisibility) => void;
  prepared: PreparedReplayUpload | null;
  state: UploadState;
  user: User | null;
  visibility: ReplayVisibility;
}) {
  if (!authReady || !user) return null;
  const completePath = state.replayId ? `/replays/${encodeURIComponent(state.replayId)}` : "";

  return (
    <section className={styles.uploadPanel}>
      <div className={styles.uploadIntro}>
        <span className={styles.sectionKicker}>Manual upload</span>
        <h2>Turn a capture into a replay</h2>
        <p>Choose a RiftLite Atlas or TCGA raw-capture v1 file. JSON is compressed locally before the private source is sent.</p>
      </div>

      <label
        className={`${styles.dropZone} ${busy ? styles.dropZoneDisabled : ""}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!busy) onFile(event.dataTransfer.files[0]);
        }}
      >
        <input
          accept=".json,.json.gz,application/json,application/gzip"
          disabled={busy}
          onChange={(event) => onFile(event.currentTarget.files?.[0])}
          ref={fileInputRef}
          type="file"
        />
        <span className={styles.uploadIcon}><CloudUpload aria-hidden="true" size={23} /></span>
        <span>
          <strong>{prepared ? "Capture checked" : "Choose or drop a capture"}</strong>
          <small>.json or .json.gz · up to 32 MB before compression</small>
        </span>
      </label>

      <div className={styles.visibilityField}>
        <label htmlFor="replay-visibility">Who can watch?</label>
        <select
          disabled={busy}
          id="replay-visibility"
          onChange={(event) => onVisibility(event.target.value as ReplayVisibility)}
          value={visibility}
        >
          <option value="private">Private</option>
          <option value="unlisted">Unlisted</option>
          <option value="public">Public</option>
        </select>
        <p>{visibilityCopy[visibility]}</p>
      </div>

      <div className={styles.uploadProgress}>
        <div className={styles.progressHeader}>
          <span className={state.stage === "error" ? styles.errorText : state.stage === "complete" ? styles.successText : undefined}>
            {uploadStateIcon(state.stage)} {state.message}
          </span>
          {state.progress > 0 ? <strong>{state.progress}%</strong> : null}
        </div>
        <div aria-label="Replay upload progress" aria-valuemax={100} aria-valuemin={0} aria-valuenow={state.progress} className={styles.progressTrack} role="progressbar">
          <span className={state.stage === "error" ? styles.progressError : undefined} style={{ width: `${state.progress}%` }} />
        </div>
      </div>

      <div className={styles.uploadActions}>
        {state.stage === "complete" && completePath ? (
          <Link className={styles.primaryButton} href={completePath}>
            Open replay <ExternalLink aria-hidden="true" size={15} />
          </Link>
        ) : (
          <button
            className={styles.primaryButton}
            disabled={!prepared || busy}
            onClick={onUpload}
            type="button"
          >
            {state.stage === "error" && prepared ? "Retry upload" : "Upload replay"}
            {busy ? <LoaderCircle aria-hidden="true" className={styles.spinning} size={16} /> : <CloudUpload aria-hidden="true" size={16} />}
          </button>
        )}
        <span>Uploads are checksum-verified and safe to retry.</span>
      </div>
    </section>
  );
}

function ReplayCard({
  busy,
  canDelete,
  embedded,
  message,
  mine,
  onCopy,
  onDelete,
  onRetry,
  onShare,
  onVisibility,
  replay,
}: {
  busy: boolean;
  canDelete: boolean;
  embedded: boolean;
  message?: string;
  mine: boolean;
  onCopy: () => void;
  onDelete: (trigger: HTMLButtonElement) => void;
  onRetry: () => void;
  onShare: () => void;
  onVisibility: (visibility: ReplayVisibility) => void;
  replay: ReplaySummary;
}) {
  const path = `/replays/${encodeURIComponent(replay.replayId)}${embedded ? "?embed=1" : ""}`;
  return (
    <article className={styles.replayCard}>
      <div className={styles.cardAccent} aria-hidden="true" />
      <header>
        <div className={styles.cardIcon}>{visibilityIcon(replay.visibility)}</div>
        <StatusPill status={replay.status} />
      </header>

      <div className={styles.cardBody}>
        <p className={styles.cardMeta}>{formatReplayDate(replay.capturedAt || replay.createdAt)} · {replay.platform || "Atlas"}</p>
        <h3>{replayCardTitle(replay)}</h3>
        {replay.listing ? (
          <div className={styles.cardMatchup}>
            <strong>{replay.listing.playerLegend} <span>vs</span> {replay.listing.opponentLegend}</strong>
            <small>{replay.listing.playerName} vs {replay.listing.opponentName} · {formatLabel(replay.listing.format)} · {resultLabel(replay.listing.result)}</small>
          </div>
        ) : null}
        <div className={styles.cardFacts}>
          <span><strong>{replay.messageCount?.toLocaleString("en-GB") ?? "—"}</strong> messages</span>
          <span><strong>{visibilityLabel(replay.visibility)}</strong> visibility</span>
        </div>

        {replay.status === "failed" && replay.failure?.message ? (
          <p className={styles.failureMessage}><AlertCircle aria-hidden="true" size={15} /> {replay.failure.message}</p>
        ) : null}
        {replay.status === "ready" && replay.warnings?.length ? (
          <p className={styles.warningMessage}>
            <AlertCircle aria-hidden="true" size={15} /> Partial capture: {replay.warnings[0].message}
          </p>
        ) : null}
        {replay.status === "processing" ? <p className={styles.processingMessage}>The replay is being rebuilt into deterministic actions.</p> : null}
        {replay.status === "uploading" ? <p className={styles.processingMessage}>Select the original capture above to safely resume this upload.</p> : null}
      </div>

      {mine ? (
        <div className={styles.cardVisibility}>
          <label htmlFor={`visibility-${replay.replayId}`}>Visibility</label>
          <select
            disabled={busy}
            id={`visibility-${replay.replayId}`}
            onChange={(event) => onVisibility(event.target.value as ReplayVisibility)}
            value={replay.visibility}
          >
            <option value="private">Private</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </select>
        </div>
      ) : null}

      <footer>
        {replay.status === "ready" ? (
          <Link className={styles.openButton} href={path}>Watch replay <ExternalLink aria-hidden="true" size={14} /></Link>
        ) : replay.status === "failed" && mine ? (
          <button className={styles.openButton} disabled={busy} onClick={onRetry} type="button">
            Retry processing {busy ? <LoaderCircle aria-hidden="true" className={styles.spinning} size={14} /> : <RefreshCw aria-hidden="true" size={14} />}
          </button>
        ) : (
          <span className={styles.pendingButton}>Available when ready</span>
        )}
        <div className={styles.shareActions}>
          <button aria-label="Copy permanent replay link" onClick={onCopy} type="button"><Copy aria-hidden="true" size={15} /></button>
          <button aria-label="Share replay" onClick={onShare} type="button"><Share2 aria-hidden="true" size={15} /></button>
          {canDelete ? (
            <button
              aria-label={`Delete ${replayCardTitle(replay)}`}
              className={styles.deleteReplayButton}
              disabled={busy}
              onClick={(event) => onDelete(event.currentTarget)}
              type="button"
            >
              <Trash2 aria-hidden="true" size={15} />
            </button>
          ) : null}
        </div>
      </footer>
      {message ? <p className={styles.cardMessage} role="status">{message}</p> : null}
    </article>
  );
}

function StatusPill({ status }: { status: ReplayStatus }) {
  const labels: Record<ReplayStatus, string> = {
    uploading: "Uploading",
    processing: "Processing",
    ready: "Ready",
    failed: "Failed",
  };
  return <span className={`${styles.statusPill} ${styles[`status_${status}`]}`}>{labels[status]}</span>;
}

function replayCardTitle(replay: ReplaySummary): string {
  const suppliedTitle = replay.title.trim();
  const listing = replay.listing;
  const listingLegendsAreKnown = listing && [listing.playerLegend, listing.opponentLegend]
    .every((legend) => legend.trim() && !/^unknown(?: legend)?$/i.test(legend.trim()));
  const suppliedTitleIsGenerated = !suppliedTitle ||
    /^riftlite (?:atlas|tcga) replay$/i.test(suppliedTitle) ||
    /^.+\s+vs\s+.+$/i.test(suppliedTitle);
  if (listingLegendsAreKnown && suppliedTitleIsGenerated) {
    return `${listing.playerLegend} vs ${listing.opponentLegend}`;
  }
  return suppliedTitle || (replay.platform === "tcga" ? "RiftLite TCGA replay" : "RiftLite Atlas replay");
}

function ReplayGridSkeleton() {
  return (
    <div aria-label="Loading replays" className={styles.replayGrid}>
      {[0, 1, 2].map((item) => <div className={styles.skeletonCard} key={item} />)}
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return <div className={styles.loadingPanel}><LoaderCircle aria-hidden="true" className={styles.spinning} size={20} /> {label}</div>;
}

function NoticePanel({ icon, message }: { icon: "error"; message: string }) {
  return <div className={styles.noticePanel}>{icon === "error" ? <AlertCircle aria-hidden="true" size={21} /> : null}<p>{message}</p></div>;
}

function EmptyLibrary({ embedded, scope }: { embedded: boolean; scope: ReplayScope }) {
  const heading = scope === "public"
    ? "No public replays yet"
    : embedded
      ? "No uploaded replays yet"
      : "Your replay library is empty";
  const message = scope === "public"
    ? "Public, processed RiftLite replays will appear here."
    : embedded
      ? "Enable automatic upload in RiftLite Settings and complete a game on TCGA or RiftAtlas."
      : "Upload your first raw capture above. It starts private by default.";
  return (
    <div className={styles.emptyPanel}>
      {scope === "public" ? <Globe2 aria-hidden="true" size={28} /> : <CloudUpload aria-hidden="true" size={28} />}
      <h3>{heading}</h3>
      <p>{message}</p>
    </div>
  );
}

function uploadStateIcon(stage: UploadStage) {
  if (stage === "complete") return <CheckCircle2 aria-hidden="true" size={16} />;
  if (stage === "error") return <AlertCircle aria-hidden="true" size={16} />;
  if (["preparing", "initializing", "uploading", "processing"].includes(stage)) {
    return <LoaderCircle aria-hidden="true" className={styles.spinning} size={16} />;
  }
  return <ShieldCheck aria-hidden="true" size={16} />;
}

function visibilityIcon(visibility: ReplayVisibility) {
  if (visibility === "public") return <Globe2 aria-hidden="true" size={20} />;
  if (visibility === "unlisted") return <Link2 aria-hidden="true" size={20} />;
  return <LockKeyhole aria-hidden="true" size={20} />;
}

function visibilityLabel(visibility: ReplayVisibility): string {
  return visibility.charAt(0).toUpperCase() + visibility.slice(1);
}

function formatLabel(format: ReplayFormat): string {
  return format === "bo1" ? "BO1" : format === "bo3" ? "BO3" : "Match";
}

function resultLabel(result: ReplayResult): string {
  return result === "win" ? "Win" : result === "loss" ? "Loss" : result === "draw" ? "Draw" : "Result pending";
}

export function filterAndSortReplays(replays: ReplaySummary[], filters: FilterValues): ReplaySummary[] {
  const query = filters.search.trim().toLowerCase();
  return replays.filter((replay) => {
    const listing = replay.listing;
    if (query && ![
      replay.title,
      listing?.playerName,
      listing?.opponentName,
      listing?.playerLegend,
      listing?.opponentLegend,
    ].some((value) => value?.toLowerCase().includes(query))) return false;
    if (filters.playerLegend && listing?.playerLegend !== filters.playerLegend) return false;
    if (filters.opponentLegend && listing?.opponentLegend !== filters.opponentLegend) return false;
    if (filters.format && listing?.format !== filters.format) return false;
    if (filters.result && listing?.result !== filters.result) return false;
    if (filters.status && replay.status !== filters.status) return false;
    if (filters.visibility && replay.visibility !== filters.visibility) return false;
    return true;
  }).sort((left, right) => {
    if (filters.sort === "player-legend") return replayListingText(left, "playerLegend").localeCompare(replayListingText(right, "playerLegend"));
    if (filters.sort === "opponent-legend") return replayListingText(left, "opponentLegend").localeCompare(replayListingText(right, "opponentLegend"));
    const difference = replayTimestamp(left) - replayTimestamp(right);
    return filters.sort === "oldest" ? difference : -difference;
  });
}

function replayLegendOptions(replays: ReplaySummary[], key: "playerLegend" | "opponentLegend"): string[] {
  return [...new Set(replays.map((replay) => replay.listing?.[key]).filter((value): value is string => Boolean(value && value !== "Unknown legend")))]
    .sort((left, right) => left.localeCompare(right));
}

function replayListingText(replay: ReplaySummary, key: "playerLegend" | "opponentLegend"): string {
  return replay.listing?.[key] || "\uffff";
}

function replayTimestamp(replay: ReplaySummary): number {
  const value = Date.parse(replay.capturedAt || replay.createdAt);
  return Number.isFinite(value) ? value : 0;
}

function formatReplayDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Recently uploaded";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

async function authenticatedFetch(user: User, input: string, init: RequestInit = {}): Promise<Response> {
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

async function ensureReplayVisibility(
  token: string,
  replayId: string,
  desired: ReplayVisibility,
  reported: ReplayVisibility | null,
): Promise<void> {
  if (reported === desired) return;
  const response = await fetch(`/api/v2/replays/${encodeURIComponent(replayId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ visibility: desired }),
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(apiError(payload, "Replay visibility could not be secured."));
  if (replayVisibilityFromPayload(payload) !== desired) {
    throw new Error("Replay visibility was not confirmed by the server.");
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json() as unknown;
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function readReplayItems(payload: Record<string, unknown>): ReplaySummary[] {
  if (!Array.isArray(payload.items)) return [];
  return payload.items.flatMap((value) => {
    if (!isRecord(value) || typeof value.replayId !== "string" || !value.replayId) return [];
    if (!isReplayStatus(value.status) || !isReplayVisibility(value.visibility)) return [];
    const listing = readListingMetadata(value.listing);
    const warnings = readReplayWarnings(value.warnings);
    return [{
      replayId: value.replayId,
      visibility: value.visibility,
      status: value.status,
      title: typeof value.title === "string"
        ? value.title
        : value.platform === "tcga"
          ? "RiftLite TCGA replay"
          : "RiftLite Atlas replay",
      platform: typeof value.platform === "string" ? value.platform : "atlas",
      messageCount: typeof value.messageCount === "number" ? value.messageCount : null,
      ...(listing ? { listing } : {}),
      ...(typeof value.capturedAt === "string" && value.capturedAt ? { capturedAt: value.capturedAt } : {}),
      createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
      ...(isRecord(value.failure) && typeof value.failure.message === "string" && typeof value.failure.code === "string"
        ? { failure: { code: value.failure.code, message: value.failure.message } }
        : {}),
      ...(warnings.length ? { warnings } : {}),
    }];
  });
}

function readReplayWarnings(value: unknown): NonNullable<ReplaySummary["warnings"]> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((warning) => (
    isRecord(warning) && typeof warning.code === "string" && typeof warning.message === "string"
      ? [{ code: warning.code, message: warning.message }]
      : []
  ));
}

function readReplayPageInfo(payload: Record<string, unknown>): { hasMore: boolean; nextCursor: string | null } {
  if (!isRecord(payload.pageInfo)) return { hasMore: false, nextCursor: null };
  const nextCursor = typeof payload.pageInfo.nextCursor === "string" && payload.pageInfo.nextCursor
    ? payload.pageInfo.nextCursor
    : null;
  return {
    hasMore: payload.pageInfo.hasMore === true && Boolean(nextCursor),
    nextCursor,
  };
}

function mergeReplayItems(current: ReplaySummary[], incoming: ReplaySummary[]): ReplaySummary[] {
  const merged = new Map(current.map((replay) => [replay.replayId, replay]));
  for (const replay of incoming) merged.set(replay.replayId, replay);
  return [...merged.values()];
}

function readListingMetadata(value: unknown): ReplayListingMetadata | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined;
  if (
    typeof value.playerName !== "string" || typeof value.opponentName !== "string" ||
    typeof value.playerLegend !== "string" || typeof value.opponentLegend !== "string" ||
    (value.format !== "bo1" && value.format !== "bo3" && value.format !== "unknown") ||
    (value.result !== "win" && value.result !== "loss" && value.result !== "draw" && value.result !== "unknown")
  ) return undefined;
  return {
    version: 1,
    playerName: value.playerName,
    opponentName: value.opponentName,
    playerLegend: value.playerLegend,
    opponentLegend: value.opponentLegend,
    format: value.format,
    result: value.result,
  };
}

function readReplayId(payload: InitReplayResponse): string {
  if (payload.replay && typeof payload.replay.replayId === "string") return payload.replay.replayId;
  if (typeof payload.playerPath === "string") {
    const match = /^\/replays\/([^/?#]+)$/.exec(payload.playerPath);
    if (match) return decodeURIComponent(match[1]);
  }
  return "";
}

function replayVisibilityFromPayload(payload: Record<string, unknown>): ReplayVisibility | null {
  if (!isRecord(payload.replay)) return null;
  return isReplayVisibility(payload.replay.visibility) ? payload.replay.visibility : null;
}

function apiError(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.error === "string" && payload.error.length <= 300 ? payload.error : fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function safeApiPath(value: unknown): value is string {
  return typeof value === "string" && /^\/api\/v2\/replays\/[A-Za-z0-9_-]+(?:\/raw|\/complete)$/.test(value);
}

function replayUrl(replayId: string): string {
  return new URL(`/replays/${encodeURIComponent(replayId)}`, window.location.origin).toString();
}

function isReplayStatus(value: unknown): value is ReplayStatus {
  return value === "uploading" || value === "processing" || value === "ready" || value === "failed";
}

function isReplayVisibility(value: unknown): value is ReplayVisibility {
  return value === "private" || value === "unlisted" || value === "public";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function putReplayBytes({
  bytes,
  endpoint,
  headers,
  onProgress,
  token,
}: {
  bytes: Uint8Array;
  endpoint: string;
  headers?: Record<string, string>;
  onProgress: (progress: number) => void;
  token: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", endpoint);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.setRequestHeader("Content-Type", "application/gzip");
    for (const [name, value] of Object.entries(headers ?? {})) {
      if (typeof value === "string" && /^X-Replay-(?:SHA256|Bytes)$/i.test(name)) {
        request.setRequestHeader(name, value);
      }
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("The replay upload was interrupted. You can safely retry it."));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      let message = "The replay upload was rejected. You can safely retry it.";
      try {
        const payload = JSON.parse(request.responseText) as unknown;
        if (isRecord(payload) && typeof payload.error === "string" && payload.error.length <= 300) {
          message = payload.error;
        }
      } catch {
        // The fixed message deliberately avoids exposing an unexpected response body.
      }
      reject(new Error(message));
    };
    const requestBody = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(requestBody).set(bytes);
    request.send(requestBody);
  });
}
