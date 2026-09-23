"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Eye, LockKeyhole, RotateCcw, Shuffle } from "lucide-react";
import { ReplayV2Player } from "@/components/replay-v2/ReplayV2Player";
import type { CanonicalReplayV2, ReplayState } from "@/lib/replay-v2";
import type {
  OpeningCatalog,
  OpeningQuestion,
  OpeningReveal,
} from "@/lib/opening-lab/types";
import styles from "./OpeningLab.module.css";

async function request<T>(body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/opening-lab", {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.error || "Practice could not be loaded.");
  return payload;
}

function attemptedReplay(
  question: OpeningQuestion,
  state: ReplayState | null,
): CanonicalReplayV2 {
  const replay = structuredClone(question.replay);
  if (state && replay.events[0]?.kind === "snapshot")
    replay.events[0].snapshot = {
      room: state.room,
      players: state.players,
      chain: state.chain,
      log: [],
    };
  return replay;
}

export function OpeningLab() {
  const [catalog, setCatalog] = useState<OpeningCatalog | null>(null);
  const [legend, setLegend] = useState("");
  const [opponent, setOpponent] = useState("");
  const [question, setQuestion] = useState<OpeningQuestion | null>(null);
  const [reveal, setReveal] = useState<OpeningReveal | null>(null);
  const [attempt, setAttempt] = useState<CanonicalReplayV2 | null>(null);
  const [compare, setCompare] = useState<"recorded" | "mine">("recorded");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reset, setReset] = useState(0);
  const [finished, setFinished] = useState(false);
  const [reviewed, setReviewed] = useState<number[]>([]);
  const boardState = useRef<ReplayState | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    request<OpeningCatalog>(undefined, controller.signal)
      .then((value) => {
        setCatalog(value);
        setLegend(value.legends[0] ?? "");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, []);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const next = await request<OpeningQuestion>({
        action: "start",
        legend,
        opponent,
      });
      if (!mounted.current) return;
      setQuestion(next);
      setReveal(null);
      setAttempt(null);
      setReviewed([]);
      setFinished(false);
      setReset(0);
      boardState.current = null;
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "Practice could not be loaded.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function lock() {
    if (!question) return;
    setBusy(true);
    setError("");
    const locked = attemptedReplay(question, boardState.current);
    try {
      const answer = await request<OpeningReveal>({
        action: "reveal",
        token: question.token,
        locked: true,
      });
      if (!mounted.current) return;
      setAttempt(locked);
      setReveal(answer);
      setCompare("recorded");
      setReviewed((old) =>
        old.includes(question.turn) ? old : [...old, question.turn],
      );
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : "The continuation could not be loaded.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function next() {
    if (!reveal?.next) {
      setFinished(true);
      return;
    }
    setQuestion(reveal.next);
    setReveal(null);
    setAttempt(null);
    setReset(0);
    setError("");
    boardState.current = null;
  }
  const replay = reveal
    ? compare === "mine" && attempt
      ? attempt
      : reveal.replay
    : question?.replay;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>RiftLite training</div>
          <h1>Opening Turns Lab</h1>
          <p>Take the board. Try your line. See what happened.</p>
        </div>
        <span className={styles.privacy}>
          <LockKeyhole size={16} /> Anonymous public & unlisted games
        </span>
      </header>
      <section className={styles.setup} aria-label="Opening practice filters">
        <label>
          Your legend
          <select
            value={legend}
            onChange={(e) => setLegend(e.target.value)}
            disabled={busy || !catalog}
          >
            {!catalog?.legends.length && (
              <option value="">
                {catalog ? "No openings available" : "Loading legends…"}
              </option>
            )}
            {catalog?.legends.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Opponent
          <select
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
            disabled={busy}
          >
            <option value="">Any opponent</option>
            {catalog?.opponents.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <button
          className={styles.primary}
          disabled={busy || !legend}
          onClick={start}
        >
          <Shuffle size={16} />
          {busy && !question
            ? "Finding an opening…"
            : question
              ? "New opening"
              : "Start practice"}
        </button>
        <span className={styles.scope}>
          Recorded decks for your selected legend · five of your turns
        </span>
      </section>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      {catalog?.limited && (
        <p className={styles.note}>
          Practice currently searches a limited replay pool. More games may be
          available outside it.
        </p>
      )}
      {!question && (
        <section className={styles.empty}>
          <div className={styles.eyebrow}>Real positions. Your decisions.</div>
          <h2>Practise an opening from a real game</h2>
          <p>
            Drag cards to the base or battlefields, exhaust runes, adjust
            counters and undo moves using the Web Replay board. Lock your
            position to reveal the recorded turn.
          </p>
          <p className={styles.note}>
            Card effects and payments are manual. Your choices are ungraded; a
            recorded play is one possible line.
          </p>
          {catalog && catalog.legends.length === 0 && (
            <p>No eligible public or unlisted openings are available yet.</p>
          )}
        </section>
      )}
      {question && !finished && (
        <>
          <section className={styles.turnbar}>
            <div>
              <strong>
                {question.legend} <span>vs</span> {question.opponent}
              </strong>
              <div className={styles.note}>
                Going {question.initiative} ·{" "}
                {reveal ? "Recorded continuation" : "Your decision"}
              </div>
            </div>
            <ol aria-label="Opening progress">
              {[1, 2, 3, 4, 5].map((turn) => (
                <li
                  key={turn}
                  aria-current={question.turn === turn ? "step" : undefined}
                  data-done={reviewed.includes(turn)}
                >
                  Turn {turn}
                  {reviewed.includes(turn) ? " ✓" : ""}
                </li>
              ))}
            </ol>
          </section>
          <div className={styles.workbench}>
            <div
              className={styles.board}
              aria-label="Interactive opening board"
              aria-busy={busy}
              inert={busy || undefined}
            >
              {replay && (
                <ReplayV2Player
                  key={`${question.token}-${reset}-${reveal ? compare : "practice"}`}
                  replayId="opening-practice"
                  embed
                  trainingReplay={replay}
                  trainingEditable={!reveal}
                  onTrainingStateChange={(state) => {
                    boardState.current = state;
                  }}
                />
              )}
            </div>
            <aside className={styles.panel}>
              <div className={styles.eyebrow}>
                Your turn {question.turn} / 5
              </div>
              <h2>
                {reveal ? "Compare the lines" : "How would you play this?"}
              </h2>
              {!reveal ? (
                <>
                  <p>
                    Move cards on the board to sketch your line. Use the card
                    menu for rune exhaustion, counters and other actions.
                  </p>
                  <p className={styles.note}>
                    Hidden cards stay hidden. Card effects and resource payments
                    are yours to resolve.
                  </p>
                  <button
                    className={styles.primary}
                    disabled={busy}
                    onClick={lock}
                  >
                    <LockKeyhole size={16} />
                    {busy ? "Loading continuation…" : "Lock position & reveal"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setReset((v) => v + 1);
                      boardState.current = null;
                    }}
                  >
                    <RotateCcw size={16} />
                    Reset this position
                  </button>
                </>
              ) : (
                <>
                  <div
                    className={styles.comparison}
                    aria-label="Compare positions"
                  >
                    <button
                      aria-pressed={compare === "recorded"}
                      onClick={() => setCompare("recorded")}
                    >
                      <Eye size={15} />
                      Recorded play
                    </button>
                    <button
                      aria-pressed={compare === "mine"}
                      onClick={() => setCompare("mine")}
                    >
                      Your position
                    </button>
                  </div>
                  <p>
                    {compare === "recorded"
                      ? "Press Play on the board to watch the real continuation."
                      : "Your locked position is preserved for comparison."}
                  </p>
                  {reveal.changes.length ? (
                    <ul>
                      {reveal.changes.map((change, i) => (
                        <li key={i}>{change}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.note}>
                      Watch the board for the recorded sequence.
                    </p>
                  )}
                  <p className={styles.note}>
                    Observed play · no best-move grade. The next decision
                    returns to the original game.
                  </p>
                  <button className={styles.primary} onClick={next}>
                    {reveal.next ? "Next turn" : "Finish opening"}
                    <ArrowRight size={16} />
                  </button>
                </>
              )}
            </aside>
          </div>
        </>
      )}
      {finished && (
        <section className={styles.empty}>
          <div className={styles.eyebrow}>Opening complete</div>
          <h2>Five turns, five decisions.</h2>
          <p>
            You explored {question?.legend} into {question?.opponent}. Try
            another real opening to see how a different hand changes your plan.
          </p>
          <button className={styles.primary} disabled={busy} onClick={start}>
            <Shuffle size={16} />
            Try another opening
          </button>
          <button onClick={() => setFinished(false)}>
            Review the final turn
          </button>
        </section>
      )}
    </main>
  );
}
