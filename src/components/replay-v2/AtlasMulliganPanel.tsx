import type { ReactNode } from "react";
import type { ReplayCardState } from "@/lib/replay-v2";
import type { AtlasMulliganSummary } from "@/lib/replay-v2/atlas-postgame";
import styles from "./AtlasMulliganPanel.module.css";

/** A post-game summary, never a reconstruction of the hidden pre-mulligan hand. */
export function AtlasMulliganPanel({ playerName, summary, renderCard }: {
  playerName: string;
  summary: AtlasMulliganSummary["players"][string];
  renderCard: (card: ReplayCardState) => ReactNode;
}) {
  return <section className={styles.panel} data-atlas-mulligan aria-label={`${playerName} mulligan summary`}>
    <header><strong>{playerName}</strong><span>All cards · Mulligan summary</span></header>
    <div className={styles.groups}>
      {([
        ["Kept cards", summary.kept, "kept"],
        ["Replacement draws", summary.replacements, "replacements"],
      ] as const).map(([label, cards, kind]) => <section className={styles.group} key={kind} data-atlas-mulligan-group={kind}>
        <h3>{label} <span>{cards.length}</span></h3>
        <div className={styles.cards}>{cards.map(card => <div key={card.id}>{renderCard(card)}</div>)}{!cards.length ? <p>None</p> : null}</div>
      </section>)}
      <section className={styles.group} data-atlas-mulligan-group="returned">
        <h3>Returned cards <span>{summary.returnedCount}</span></h3>
        <div className={styles.cards}>{summary.returnedCount ? <div className={styles.unknown} aria-label={`${summary.returnedCount} returned cards, identities unknown`}><b>?</b><strong>Unknown</strong><span>{summary.returnedCount} {summary.returnedCount === 1 ? "card" : "cards"}</span></div> : <p>None</p>}</div>
      </section>
    </div>
    <p className={styles.note}>Atlas does not include the identities of returned cards. First-turn draws are not shown here.</p>
  </section>;
}
