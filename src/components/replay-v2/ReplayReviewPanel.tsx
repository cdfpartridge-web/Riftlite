"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { formatReplayClipTimecode } from "./clip";
import { searchReplayReview, type ReplayCombat, type ReplayCombatBoard, type ReplayReviewEntry, type ReplayReviewIndex } from "./review-model";
import styles from "./ReplayReviewPanel.module.css";

type ReviewTab = "walkthrough" | "combat" | "search";
const tabs: { id: ReviewTab; label: string }[] = [
  { id: "walkthrough", label: "Walkthrough" },
  { id: "combat", label: "Combat" },
  { id: "search", label: "Search" },
];
const kinds: { id: ReplayReviewEntry["kind"] | "all"; label: string }[] = [
  { id: "all", label: "All actions" }, { id: "play", label: "Cards played" },
  { id: "move", label: "Card movement" }, { id: "combat", label: "Combat" },
  { id: "score", label: "Score changes" }, { id: "status", label: "Status / might" },
  { id: "mulligan", label: "Mulligans" }, { id: "reveal", label: "Reveals" },
  { id: "turn", label: "Turns" }, { id: "opening", label: "Openings" }, { id: "end", label: "Game ends" },
];

export function ReplayReviewPanel({ index, panelId, hidden = false, accountControls, initialGameId, currentEventIndex, range, canAddNote, noteDraftOpen, onSeek, onAddNote, onClose }: {
  index: ReplayReviewIndex;
  panelId: string;
  hidden?: boolean;
  accountControls?: ReactNode;
  initialGameId: string | null;
  currentEventIndex: number;
  range: { startMs: number; endMs: number };
  canAddNote: boolean;
  noteDraftOpen: boolean;
  onSeek: (eventIndex: number) => void;
  onAddNote: (eventIndex: number) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ReviewTab>("walkthrough");
  const [gameId, setGameId] = useState(() => index.games.some((game) => game.id === initialGameId) ? initialGameId! : index.games[0]?.id ?? "");
  const [selectedMomentId, setSelectedMomentId] = useState<string | null>(null);
  const [selectedCombatId, setSelectedCombatId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ReplayReviewEntry["kind"] | "all">("all");
  const [resultLimit, setResultLimit] = useState(40);
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const inRange = (atMs: number) => atMs >= range.startMs && atMs <= range.endMs;
  const moments = index.moments.filter((moment) => (!gameId || moment.gameId === gameId) && inRange(moment.atMs));
  const momentIndex = Math.max(0, moments.findIndex((moment) => moment.id === selectedMomentId));
  const moment = moments[momentIndex];
  const combats = index.combats.filter((combat) => (!gameId || combat.gameId === gameId) && combat.endMs >= range.startMs && combat.startMs <= range.endMs);
  const combat = combats.find((item) => item.id === selectedCombatId) ?? combats[0];
  const results = useMemo(() => searchReplayReview(index, query, gameId || undefined, kind)
    .filter((entry) => entry.atMs >= range.startMs && entry.atMs <= range.endMs), [gameId, index, kind, query, range.endMs, range.startMs]);
  const partial = index.games.some((game) => (!gameId || game.id === gameId) && game.partial);

  function chooseMoment(next: number) {
    const target = moments[next];
    if (!target) return;
    setSelectedMomentId(target.id);
    onSeek(target.eventIndex);
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, position: number) {
    const next = event.key === "ArrowRight" ? (position + 1) % tabs.length
      : event.key === "ArrowLeft" ? (position + tabs.length - 1) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    setTab(tabs[next].id);
    tabRefs.current[next]?.focus();
  }

  return (
    <aside aria-label="Game review" className={styles.panel} data-replay-review hidden={hidden} id={panelId} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>Learn from this replay</span><h2>Game review</h2></div>
        <button className={styles.back} onClick={onClose} type="button">Back to replay</button>
      </header>
      {accountControls}
      <div aria-label="Review tools" className={styles.tabs} role="tablist">
        {tabs.map((item, position) => <button aria-controls={`${id}-${item.id}-panel`} aria-selected={tab === item.id}
          id={`${id}-${item.id}-tab`} key={item.id} onClick={() => setTab(item.id)} onKeyDown={(event) => onTabKey(event, position)}
          ref={(element) => { tabRefs.current[position] = element; }} role="tab" tabIndex={tab === item.id ? 0 : -1} type="button">{item.label}</button>)}
      </div>
      <div className={styles.gameFilter}>
        <label htmlFor={`${id}-game`}>Game</label>
        <select id={`${id}-game`} onChange={(event) => { setGameId(event.target.value); setSelectedMomentId(null); setSelectedCombatId(null); setResultLimit(40); }} value={gameId}>
          {index.games.length > 1 && <option value="">All games</option>}
          {index.games.map((game) => <option key={game.id} value={game.id}>Game {game.number}{game.partial ? " · Partial capture" : ""}</option>)}
        </select>
      </div>
      <div aria-labelledby={`${id}-${tab}-tab`} className={styles.body} id={`${id}-${tab}-panel`} role="tabpanel" tabIndex={0}>
        {tab === "walkthrough" ? <>
          <p className={styles.intro}>A few recorded moments to revisit. Look at the board, then think through your choice.</p>
          {partial && <p className={styles.notice}>This capture is incomplete. Some moments may be missing.</p>}
          {moment ? <>
            <div className={styles.progress}><span>Moment {momentIndex + 1} of {moments.length}</span><span>Game {moment.gameNumber}</span></div>
            <article className={styles.moment}>
              <span className={styles.time}>{formatReplayClipTimecode(moment.atMs)}</span>
              <h3>{moment.label}</h3><p>{moment.summary}</p>
              <button aria-pressed={currentEventIndex === moment.eventIndex} className={styles.primary} onClick={() => onSeek(moment.eventIndex)} type="button">Show this moment</button>
              <div className={styles.prompt}><span>Think it through</span><p>{moment.prompt}</p></div>
              {canAddNote && <button className={styles.secondary} onClick={() => onAddNote(moment.eventIndex)} type="button">{noteDraftOpen ? "Resume your note" : "Add a thought"}</button>}
              {moment.combatId && <button className={styles.textButton} onClick={() => { setSelectedCombatId(moment.combatId!); setTab("combat"); }} type="button">See combat breakdown →</button>}
            </article>
            <div className={styles.navigation}><button disabled={momentIndex === 0} onClick={() => chooseMoment(momentIndex - 1)} type="button">← Previous</button><button disabled={momentIndex >= moments.length - 1} onClick={() => chooseMoment(momentIndex + 1)} type="button">Next moment →</button></div>
            <details className={styles.momentList}><summary>Choose a moment</summary>{moments.map((item, position) => <button aria-current={item.id === moment.id ? "step" : undefined} key={item.id} onClick={() => chooseMoment(position)} type="button"><span>{position + 1}. {item.label}</span><small>Game {item.gameNumber} · {formatReplayClipTimecode(item.atMs)}</small></button>)}</details>
          </> : <Empty title="No review moments in this range" text="Try another game or return to the full replay. Only captured actions can be reviewed." />}
        </> : null}
        {tab === "combat" ? <>
          <p className={styles.intro}>Follow battlefield contests through the recorded board changes.</p>
          {combat ? <>
            <label className={styles.field}>Battlefield moment<select aria-label="Battlefield moment" onChange={(event) => setSelectedCombatId(event.target.value)} value={combat.id}>{combats.map((item) => <option key={item.id} value={item.id}>Game {item.gameNumber} · {formatReplayClipTimecode(item.startMs)} · {item.label}</option>)}</select></label>
            <CombatDetail combat={combat} currentEventIndex={currentEventIndex} key={combat.id} onSeek={onSeek} range={range} />
          </> : <Empty title="No battlefield contests captured" text="Combat breakdowns appear when the replay records a contested battlefield. Search can still help you find individual actions." />}
        </> : null}
        {tab === "search" ? <>
          <p className={styles.intro}>Find a card or action, then jump straight to it.</p>
          <label className={styles.field}>Card or action<input autoComplete="off" onChange={(event) => { setQuery(event.target.value); setResultLimit(40); }} placeholder="e.g. Yasuo, move, score" type="search" value={query} /></label>
          <label className={styles.field}>Action type<select onChange={(event) => { setKind(event.target.value as typeof kind); setResultLimit(40); }} value={kind}>{kinds.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <p aria-live="polite" className={styles.resultCount}>{results.length} {results.length === 1 ? "recorded action" : "recorded actions"}{query.trim() ? ` matching “${query.trim()}”` : " · select one to jump"}</p>
          {results.length ? <><div className={styles.entries}>{results.slice(0, resultLimit).map((entry) => <EntryButton currentEventIndex={currentEventIndex} entry={entry} key={entry.id} onSeek={onSeek} />)}</div>{results.length > resultLimit && <button className={styles.secondary} onClick={() => setResultLimit((count) => count + 40)} type="button">Show 40 more</button>}</> : <Empty title="No matching actions" text="Try a shorter card name, choose All actions, or change the game filter." />}
        </> : null}
      </div>
      <footer className={styles.footer}>Based on captured actions. Hidden cards stay hidden.</footer>
    </aside>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className={styles.empty}><h3>{title}</h3><p>{text}</p></div>;
}

function EntryButton({ entry, currentEventIndex, onSeek }: { entry: ReplayReviewEntry; currentEventIndex: number; onSeek: (eventIndex: number) => void }) {
  return <button aria-current={entry.eventIndex === currentEventIndex ? "true" : undefined} className={styles.entry} data-review-event={entry.eventIndex} onClick={() => onSeek(entry.eventIndex)} type="button"><small>Game {entry.gameNumber} · {formatReplayClipTimecode(entry.atMs)}</small><b>{entry.label}</b><span>{entry.summary}</span></button>;
}

function CombatDetail({ combat, currentEventIndex, range, onSeek }: { combat: ReplayCombat; currentEventIndex: number; range: { startMs: number; endMs: number }; onSeek: (eventIndex: number) => void }) {
  const [stage, setStage] = useState<"before" | "after">("before");
  const changes = combat.changes.filter((entry) => entry.atMs >= range.startMs && entry.atMs <= range.endMs);
  const targetIndex = stage === "before" ? combat.startEventIndex : combat.endEventIndex;
  const targetMs = stage === "before" ? combat.startMs : combat.endMs;
  return <>
    <h3 className={styles.combatTitle}>{combat.label}</h3>
    {combat.incomplete && <p className={styles.notice}>The capture does not show the complete contest.</p>}
    <div aria-label="Combat board comparison" className={styles.stageSwitch} role="group"><button aria-pressed={stage === "before"} onClick={() => setStage("before")} type="button">Before</button><button aria-pressed={stage === "after"} onClick={() => setStage("after")} type="button">After</button></div>
    <CombatBoard board={combat[stage]} />
    <button className={styles.secondary} disabled={targetMs < range.startMs || targetMs > range.endMs} onClick={() => onSeek(targetIndex)} type="button">Show {stage} on board</button>
    <h3 className={styles.sectionTitle}>What happened</h3>
    <div className={styles.entries}>{changes.map((entry) => <EntryButton currentEventIndex={currentEventIndex} entry={entry} key={entry.id} onSeek={onSeek} />)}</div>
  </>;
}

function CombatBoard({ board }: { board: ReplayCombatBoard }) {
  return <div className={styles.combatBoard}>{board.sides.map((side) => <section className={styles.side} key={side.playerId}>
    <h4><span>{side.label}</span>{side.might && <b>{side.might.total}{side.might.unknownCount > 0 ? " + ?" : ""} might</b>}</h4>
    {side.cards.length ? side.cards.map((card) => <div className={styles.card} key={card.id}><div><b>{card.hidden ? "Hidden card" : card.name}</b>{card.might !== undefined && <strong>{card.might}</strong>}</div>{card.equipment.length > 0 && <p>Gear: {card.equipment.join(", ")}</p>}{(card.exhausted || card.statuses.length > 0) && <p className={styles.statuses}>{[...(card.exhausted ? ["Exhausted"] : []), ...card.statuses].join(" · ")}</p>}</div>) : <p className={styles.muted}>No units captured here</p>}
  </section>)}</div>;
}
