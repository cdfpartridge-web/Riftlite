"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Eye,
  GitMerge,
  Link2,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { getAuth, onIdTokenChanged, type User } from "firebase/auth";

import { firebaseClientApp } from "@/lib/firebase/client";
import { parseReplayCombinationRequest } from "@/lib/replay-combiner/input";

import styles from "./ReplayCombiner.module.css";

type CombinationDiagnostics = {
  primarySourceReplayId: string;
  pairedSnapshotEvents: number;
  pairedActionEvents: number;
  unpairedPrimaryEvents: number;
  unpairedSecondaryEvents: number;
  enrichedCards: number;
  enrichedFields: number;
  coveragePercent: number;
  warningCodes: string[];
};

type CombinationResponse = {
  replay?: {
    replayId?: string;
    visibility?: string;
  };
  created?: boolean;
  playerPath?: string;
  confidence?: "exact" | "strong" | "review";
  diagnostics?: CombinationDiagnostics;
  error?: string;
  code?: string;
};

type CombinationSuccess = {
  replayId: string;
  playerPath: string;
  created: boolean;
  confidence: "exact" | "strong" | "review";
  diagnostics: CombinationDiagnostics;
};

export function ReplayCombiner() {
  const auth = useMemo(() => getAuth(firebaseClientApp), []);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [leftReplay, setLeftReplay] = useState("");
  const [rightReplay, setRightReplay] = useState("");
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<CombinationSuccess | null>(null);

  useEffect(() => onIdTokenChanged(
    auth,
    (nextUser) => {
      setUser(nextUser && !nextUser.isAnonymous ? nextUser : null);
      setAuthReady(true);
    },
    () => {
      setUser(null);
      setAuthReady(true);
    },
  ), [auth]);

  async function combineReplays() {
    setError("");
    setSuccess(null);
    if (!user) {
      setError("Sign in to create and own the combined replay.");
      return;
    }
    if (!permissionConfirmed) {
      setError("Confirm that both players gave permission before combining their perspectives.");
      return;
    }

    try {
      const request = parseReplayCombinationRequest({
        leftReplay,
        rightReplay,
        permissionConfirmed: true,
      });
      setBusy(true);
      const token = await user.getIdToken();
      const response = await fetch("/api/v2/replays/combine", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leftReplay: request.leftReplayId,
          rightReplay: request.rightReplayId,
          permissionConfirmed: true,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(apiError(payload, "Those replay perspectives could not be combined."));
      }
      const parsed = parseSuccess(payload);
      if (!parsed) throw new Error("The combined replay was created, but its permanent link was invalid.");
      setSuccess(parsed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Those replay perspectives could not be combined.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />
      <section className={styles.shell}>
        <Link className={styles.backLink} href="/replays">
          <ArrowLeft aria-hidden="true" size={16} /> Replay library
        </Link>

        <header className={styles.hero}>
          <div className={styles.eyebrow}><GitMerge aria-hidden="true" size={16} /> Replay Combiner</div>
          <h1>Two perspectives. One complete table.</h1>
          <p>
            Paste the replay link from each player. RiftLite checks that they describe the same Atlas match,
            then creates a separate unlisted replay with both captured hands and choices available.
          </p>
          <div className={styles.trustRow}>
            <span><Eye aria-hidden="true" size={16} /> Unlisted output</span>
            <span><ShieldCheck aria-hidden="true" size={16} /> Permission required</span>
            <span><Eye aria-hidden="true" size={16} /> Processed replay data only</span>
          </div>
        </header>

        <div className={styles.layout}>
          <section className={styles.formCard} aria-labelledby="combine-heading">
            <div className={styles.cardHeading}>
              <div className={styles.stepNumber}>1</div>
              <div>
                <h2 id="combine-heading">Add both replay links</h2>
                <p>Either a full riftlite.com/replays link or an rl2_ replay ID works.</p>
              </div>
            </div>

            <div className={styles.inputs}>
              <label>
                <span><UsersRound aria-hidden="true" size={15} /> Player one&apos;s perspective</span>
                <div className={styles.inputShell}>
                  <Link2 aria-hidden="true" size={18} />
                  <input
                    autoComplete="off"
                    disabled={busy}
                    onChange={(event) => setLeftReplay(event.target.value)}
                    placeholder="https://www.riftlite.com/replays/rl2_..."
                    spellCheck={false}
                    value={leftReplay}
                  />
                </div>
              </label>
              <div className={styles.mergeLine} aria-hidden="true"><span>+</span></div>
              <label>
                <span><UsersRound aria-hidden="true" size={15} /> Player two&apos;s perspective</span>
                <div className={styles.inputShell}>
                  <Link2 aria-hidden="true" size={18} />
                  <input
                    autoComplete="off"
                    disabled={busy}
                    onChange={(event) => setRightReplay(event.target.value)}
                    placeholder="https://www.riftlite.com/replays/rl2_..."
                    spellCheck={false}
                    value={rightReplay}
                  />
                </div>
              </label>
            </div>

            <label className={styles.permission}>
              <input
                checked={permissionConfirmed}
                disabled={busy}
                onChange={(event) => setPermissionConfirmed(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>I have both players&apos; permission.</strong>
                I confirm both players agreed to combine their replay perspectives and reveal the private
                information captured in them.
              </span>
            </label>

            {!authReady ? (
              <div className={styles.authMessage}><LoaderCircle className={styles.spin} size={17} /> Checking your RiftLite account…</div>
            ) : !user ? (
              <div className={styles.authMessage}>
                <LockKeyhole size={17} />
                <span>You need a RiftLite account to own the unlisted result.</span>
                <Link href="/account">Sign in</Link>
              </div>
            ) : (
              <div className={styles.authMessage}>
                <CheckCircle2 size={17} />
                <span>Combined replay will belong to {user.email || "your linked RiftLite account"}.</span>
              </div>
            )}

            <button
              className={styles.combineButton}
              disabled={busy || !user || !leftReplay.trim() || !rightReplay.trim() || !permissionConfirmed}
              onClick={() => void combineReplays()}
              type="button"
            >
              {busy ? <LoaderCircle className={styles.spin} aria-hidden="true" size={19} /> : <GitMerge aria-hidden="true" size={19} />}
              {busy ? "Checking and combining…" : "Create unlisted combined replay"}
            </button>

            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </section>

          <aside className={styles.infoCard}>
            <div className={styles.stepNumber}>2</div>
            <h2>What RiftLite checks</h2>
            <ol>
              <li><strong>Access</strong><span>Your own Private replay works. Someone else&apos;s replay must be Unlisted or Public.</span></li>
              <li><strong>Match identity</strong><span>The players, game or series identity, timing, and event timeline must agree.</span></li>
              <li><strong>Opposite views</strong><span>The files must come from opposite player perspectives, not two copies from one player.</span></li>
              <li><strong>Safe merge</strong><span>Conflicting public board state stops the merge instead of silently guessing.</span></li>
            </ol>
            <div className={styles.rawNotice}>
              <ShieldCheck aria-hidden="true" size={20} />
              <p><strong>Raw captures are never shared between accounts.</strong> This prototype combines only the already processed replay artifacts each link is allowed to open.</p>
            </div>
          </aside>
        </div>

        {success ? <CombinationResult success={success} /> : null}
      </section>
    </div>
  );
}

function CombinationResult({ success }: { success: CombinationSuccess }) {
  const diagnostics = success.diagnostics;
  return (
    <section className={styles.result} aria-live="polite">
      <div className={styles.resultIcon}><CheckCircle2 aria-hidden="true" size={30} /></div>
      <div className={styles.resultBody}>
        <div className={styles.resultTitleRow}>
          <div>
            <span className={styles.resultKicker}>Combined replay ready</span>
            <h2>{success.created ? "Your unlisted team replay has been created." : "The existing unlisted team replay is ready."}</h2>
          </div>
          <span className={styles.privateBadge}><Eye size={14} /> Unlisted</span>
        </div>
        <div className={styles.diagnostics}>
          <div><span>Match confidence</span><strong>{success.confidence}</strong></div>
          <div><span>Timeline coverage</span><strong>{formatPercent(diagnostics.coveragePercent)}</strong></div>
          <div><span>Cards revealed</span><strong>{diagnostics.enrichedCards}</strong></div>
          <div><span>Fields enriched</span><strong>{diagnostics.enrichedFields}</strong></div>
          <div><span>Paired actions</span><strong>{diagnostics.pairedActionEvents}</strong></div>
          <div><span>Paired snapshots</span><strong>{diagnostics.pairedSnapshotEvents}</strong></div>
        </div>
        {diagnostics.warningCodes.length ? (
          <p className={styles.warning}>Created with review notes: {diagnostics.warningCodes.join(", ")}.</p>
        ) : (
          <p className={styles.cleanResult}>Both perspectives aligned without merge warnings.</p>
        )}
        <div className={styles.resultActions}>
          <Link className={styles.openButton} href={success.playerPath} target="_blank">
            Open combined replay <ExternalLink aria-hidden="true" size={17} />
          </Link>
          <Link className={styles.secondaryButton} href="/replays">Back to replay library</Link>
        </div>
      </div>
    </section>
  );
}

async function readJson(response: Response): Promise<CombinationResponse> {
  try {
    return await response.json() as CombinationResponse;
  } catch {
    return {};
  }
}

function apiError(payload: CombinationResponse, fallback: string): string {
  return typeof payload.error === "string" && payload.error.trim() ? payload.error : fallback;
}

function parseSuccess(payload: CombinationResponse): CombinationSuccess | null {
  const replayId = payload.replay?.replayId ?? "";
  const playerPath = payload.playerPath ?? "";
  const diagnostics = payload.diagnostics;
  if (
    !/^rl2_[a-f0-9]{32}$/.test(replayId) ||
    playerPath !== `/replays/${replayId}` ||
    !diagnostics ||
    !["exact", "strong", "review"].includes(payload.confidence ?? "")
  ) return null;
  return {
    replayId,
    playerPath,
    created: payload.created === true,
    confidence: payload.confidence as CombinationSuccess["confidence"],
    diagnostics,
  };
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}
