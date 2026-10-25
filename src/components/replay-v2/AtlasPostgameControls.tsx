"use client";

import { useEffect, useRef, useState } from "react";
import type { useAtlasPostgame } from "./useAtlasPostgame";
import styles from "./AtlasPostgameControls.module.css";

type Props = {
  atlas: ReturnType<typeof useAtlasPostgame>;
  disabled: boolean;
  covered: boolean;
  knownCards?: boolean;
  capturedOpening?: boolean;
  mulliganSummary?: boolean;
  onChangeView: () => void;
};

export function AtlasPostgameControls({ atlas, disabled, covered, capturedOpening = false, mulliganSummary = false, knownCards = false, onChangeView }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { dialog.current?.close(); }, [atlas.boundaryKey]);
  const owner = atlas.metadata?.canManage === true;
  if (!owner && !atlas.metadata?.available) return null;
  return <>
    <div className={styles.views} aria-label="Card information" role="group" data-atlas-view-controls>
      <button type="button" aria-pressed={!atlas.allCards && !knownCards} disabled={disabled || atlas.busy}
        onClick={() => { onChangeView(); atlas.showPlayerView(); }}>Player view</button>
      <button type="button" aria-pressed={atlas.allCards} disabled={disabled || atlas.busy || !atlas.metadata?.available}
        title={atlas.metadata?.available ? "Show card identities from the matching Atlas post-game replay" : "Available after RiftLite automatically syncs the completed Atlas replay"}
        onClick={() => { onChangeView(); void atlas.showAllCards(); }}>All cards{atlas.busy ? "…" : ""}</button>
    </div>
    <button className={styles.manage} type="button" data-control="atlas-postgame"
      onClick={() => { setMessage(""); dialog.current?.showModal(); }}>
      {owner ? "Card views" : "About All cards"}
    </button>
    {atlas.allCards && !covered && !disabled ? <span className={styles.coverage} role="status">{mulliganSummary ? "Mulligan summary · returned cards unknown" : capturedOpening ? "Captured opening · Player view preserved" : "Captured view here · no matching Atlas frame"}</span> : null}
    {atlas.error ? <span className={styles.error} role="alert">{atlas.error}</span> : null}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="atlas-postgame-title" onClick={event => {
      if (event.target === dialog.current) { const box = dialog.current.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.current.close(); }
    }}>
      <header><h2 id="atlas-postgame-title">All cards from Atlas</h2><button type="button" aria-label="Close Atlas replay" onClick={() => dialog.current?.close()}>×</button></header>
      <p>RiftLite automatically collects the completed Atlas replay after your match, keeping our opening capture and timeline. Choose <b>All cards</b> to see the extra card information where the two replays match.</p>
      <p>Player view stays as recorded. Your notes and their positions stay the same. Missing opening information and restricted cards are never guessed.</p>
      {owner ? <>
        {!atlas.metadata?.available ? <p>All cards will appear after the desktop app syncs this game. Keep Atlas signed in and Interactive replays enabled. Atlas may restrict some replay data.</p> : null}
        <input ref={input} type="file" accept=".json,application/json" aria-label="Atlas replay JSON" className={styles.file} onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (!file) return;
          setMessage(""); onChangeView();
          void atlas.importFile(file).then(ok => { if (ok) setMessage("Atlas replay attached. Close this panel and choose All cards to view it. Your sharing choice is shown below."); });
        }} />
        <details><summary>Import a file instead</summary>
          <p className={styles.hint}>If automatic sync is missing, download the completed game’s JSON from Atlas. For a multi-game match, choose each game’s file separately.</p>
          <button className={styles.primary} type="button" disabled={atlas.busy} onClick={() => input.current?.click()}>{atlas.busy ? "Working…" : "Choose Atlas JSON"}</button>
        </details>
        <p className={styles.hint}>All cards is shared by default with people who can already access this replay. Untick a game below to keep its extra card information only for you. Your notes stay private.</p>
      </> : <p>All cards is available to people who can already access this replay. Each viewer’s notes stay private.</p>}
      {atlas.metadata?.games.map(game => <section className={styles.game} key={game.gameId}>
        <div><b>Game {game.gameNumber}</b><span>{game.frameCount} Atlas frames · {game.shared ? "Shared with replay viewers" : "Only you"}</span></div>
        {owner ? <label><input type="checkbox" checked={game.shared} disabled={atlas.busy} onChange={event => void atlas.setShared(game.gameId, event.currentTarget.checked)} /> Share All cards with replay viewers</label> : null}
      </section>)}
      {owner && atlas.metadata?.available ? <p className={styles.hint}>Sharing All cards does not share your private notes or change who can access this replay.</p> : null}
      {message ? <p role="status" className={styles.success}>{message}</p> : null}
      {atlas.error ? <p role="alert" className={styles.error}>{atlas.error}</p> : null}
      <footer><button type="button" onClick={() => dialog.current?.close()}>Done</button></footer>
    </dialog>
  </>;
}
