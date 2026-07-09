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
  Link2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Share2,
  ShieldCheck,
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

type ReplaySummary = {
  replayId: string;
  visibility: ReplayVisibility;
  status: ReplayStatus;
  title: string;
  platform: string;
  messageCount: number | null;
  createdAt: string;
  updatedAt: string;
  failure?: {
    code: string;
    message: string;
  };
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

export function ReplayLibrary() {
  const auth = useMemo(() => getAuth(firebaseClientApp), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<ReplayScope>("public");
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [publicReplays, setPublicReplays] = useState<ReplaySummary[]>([]);
  const [myReplays, setMyReplays] = useState<ReplaySummary[]>([]);
  const [publicLoading, setPublicLoading] = useState(true);
  const [mineLoading, setMineLoading] = useState(false);
  const [publicError, setPublicError] = useState("");
  const [mineError, setMineError] = useState("");
  const [prepared, setPrepared] = useState<PreparedReplayUpload | null>(null);
  const [visibility, setVisibility] = useState<ReplayVisibility>("private");
  const [uploadState, setUploadState] = useState<UploadState>(INITIAL_UPLOAD_STATE);
  const [busyReplayId, setBusyReplayId] = useState("");
  const [cardMessages, setCardMessages] = useState<Record<string, string>>({});

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

  const loadPublicReplays = useCallback(async () => {
    setPublicLoading(true);
    setPublicError("");
    try {
      const response = await fetch("/api/v2/replays?scope=public", { cache: "no-store" });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(apiError(payload, "Public replays are unavailable right now."));
      setPublicReplays(readReplayItems(payload));
    } catch (error) {
      setPublicError(errorMessage(error, "Public replays are unavailable right now."));
    } finally {
      setPublicLoading(false);
    }
  }, []);

  const loadMyReplays = useCallback(async (activeUser: User) => {
    setMineLoading(true);
    setMineError("");
    try {
      const response = await authenticatedFetch(activeUser, "/api/v2/replays?scope=mine", {
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(apiError(payload, "Your replays could not be loaded."));
      setMyReplays(readReplayItems(payload));
    } catch (error) {
      setMineError(errorMessage(error, "Your replays could not be loaded."));
    } finally {
      setMineLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPublicReplays();
  }, [loadPublicReplays]);

  useEffect(() => {
    if (scope === "mine" && authReady && user) void loadMyReplays(user);
  }, [authReady, loadMyReplays, scope, user]);

  useEffect(() => {
    if (scope !== "mine" || !user || !myReplays.some((replay) => replay.status === "processing")) return;
    const timer = window.setInterval(() => void loadMyReplays(user), 5_000);
    return () => window.clearInterval(timer);
  }, [loadMyReplays, myReplays, scope, user]);

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
          platform: "atlas",
          messageCount: prepared.messageCount,
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

  const displayedReplays = scope === "public" ? publicReplays : myReplays;
  const loading = scope === "public" ? publicLoading : mineLoading;
  const listError = scope === "public" ? publicError : mineError;
  const uploadBusy = ["preparing", "initializing", "uploading", "processing"].includes(uploadState.stage);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.eyebrow}><span /> RiftLite Replay</div>
        <div className={styles.heroContent}>
          <div>
            <h1>Every match, rebuilt as a living board.</h1>
            <p>
              Watch deterministic Atlas replays, share a permanent link, or turn a RiftLite raw capture into a
              private replay in a few clicks.
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
              onClick={() => setScope("public")}
              role="tab"
              type="button"
            >
              <Globe2 aria-hidden="true" size={17} /> Public replays
            </button>
            <button
              aria-selected={scope === "mine"}
              className={scope === "mine" ? styles.activeTab : undefined}
              onClick={() => setScope("mine")}
              role="tab"
              type="button"
            >
              <LockKeyhole aria-hidden="true" size={17} /> My replays
            </button>
          </div>
          <button
            className={styles.refreshButton}
            disabled={loading || (scope === "mine" && !user)}
            onClick={() => void (scope === "public" ? loadPublicReplays() : user && loadMyReplays(user))}
            type="button"
          >
            <RefreshCw aria-hidden="true" className={loading ? styles.spinning : undefined} size={16} />
            Refresh
          </button>
        </div>

        {scope === "mine" ? (
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

        {authReady && scope === "mine" && !user ? (
          <section className={styles.accountPanel}>
            <LockKeyhole aria-hidden="true" size={25} />
            <div>
              <h2>Sign in to manage your replays</h2>
              <p>Your linked RiftLite account unlocks private uploads, visibility controls, and your replay history.</p>
            </div>
          </section>
        ) : null}

        {scope === "public" || (authReady && user) ? (
          <section aria-live="polite" className={styles.results}>
            <div className={styles.resultsHeading}>
              <div>
                <span>{scope === "public" ? "Discover" : "Your collection"}</span>
                <h2>{scope === "public" ? "Public match replays" : "Uploaded replays"}</h2>
              </div>
              {!loading && !listError ? <p>{displayedReplays.length} replay{displayedReplays.length === 1 ? "" : "s"}</p> : null}
            </div>

            {loading ? <ReplayGridSkeleton /> : null}
            {!loading && listError ? (
              <NoticePanel icon="error" message={listError} />
            ) : null}
            {!loading && !listError && displayedReplays.length === 0 ? (
              <EmptyLibrary scope={scope} />
            ) : null}
            {!loading && !listError && displayedReplays.length > 0 ? (
              <div className={styles.replayGrid}>
                {displayedReplays.map((replay) => (
                  <ReplayCard
                    busy={busyReplayId === replay.replayId}
                    key={replay.replayId}
                    message={cardMessages[replay.replayId]}
                    mine={scope === "mine"}
                    onCopy={() => void copyLink(replay)}
                    onRetry={() => void retryProcessing(replay.replayId)}
                    onShare={() => void shareReplay(replay)}
                    onVisibility={(next) => void updateVisibility(replay, next)}
                    replay={replay}
                  />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </section>
    </main>
  );
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
        <p>Choose a RiftLite raw-capture v1 file. JSON is compressed locally before the private source is sent.</p>
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
  message,
  mine,
  onCopy,
  onRetry,
  onShare,
  onVisibility,
  replay,
}: {
  busy: boolean;
  message?: string;
  mine: boolean;
  onCopy: () => void;
  onRetry: () => void;
  onShare: () => void;
  onVisibility: (visibility: ReplayVisibility) => void;
  replay: ReplaySummary;
}) {
  const path = `/replays/${encodeURIComponent(replay.replayId)}`;
  return (
    <article className={styles.replayCard}>
      <div className={styles.cardAccent} aria-hidden="true" />
      <header>
        <div className={styles.cardIcon}>{visibilityIcon(replay.visibility)}</div>
        <StatusPill status={replay.status} />
      </header>

      <div className={styles.cardBody}>
        <p className={styles.cardMeta}>{formatReplayDate(replay.createdAt)} · {replay.platform || "Atlas"}</p>
        <h3>{replay.title || "RiftLite Atlas replay"}</h3>
        <div className={styles.cardFacts}>
          <span><strong>{replay.messageCount?.toLocaleString("en-GB") ?? "—"}</strong> messages</span>
          <span><strong>{visibilityLabel(replay.visibility)}</strong> visibility</span>
        </div>

        {replay.status === "failed" && replay.failure?.message ? (
          <p className={styles.failureMessage}><AlertCircle aria-hidden="true" size={15} /> {replay.failure.message}</p>
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

function EmptyLibrary({ scope }: { scope: ReplayScope }) {
  return (
    <div className={styles.emptyPanel}>
      {scope === "public" ? <Globe2 aria-hidden="true" size={28} /> : <CloudUpload aria-hidden="true" size={28} />}
      <h3>{scope === "public" ? "The public stage is waiting" : "Your replay library is empty"}</h3>
      <p>{scope === "public" ? "Public, processed RiftLite replays will appear here." : "Upload your first raw capture above. It starts private by default."}</p>
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
    return [{
      replayId: value.replayId,
      visibility: value.visibility,
      status: value.status,
      title: typeof value.title === "string" ? value.title : "RiftLite Atlas replay",
      platform: typeof value.platform === "string" ? value.platform : "atlas",
      messageCount: typeof value.messageCount === "number" ? value.messageCount : null,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
      ...(isRecord(value.failure) && typeof value.failure.message === "string" && typeof value.failure.code === "string"
        ? { failure: { code: value.failure.code, message: value.failure.message } }
        : {}),
    }];
  });
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
