import { useEffect, useId, useMemo, useState, type RefObject } from "react";
import { getReplayTargetArrows, replayTargetArrowPath } from "@/lib/replay-v2/target-arrows";
import type { ReplayState, ReplayTargetArrow } from "@/lib/replay-v2/types";
import styles from "./ReplayTargetArrows.module.css";

type PositionedArrow = ReplayTargetArrow & {
  fromX: number; fromY: number; toX: number; toY: number;
};

/** Resolve board and chain instances separately; a card may appear in both. */
export function replayArrowElement(root: HTMLElement, id: string, anchor: "board" | "chain"): HTMLElement | undefined {
  if (anchor === "board") {
    const marker = Array.from(root.querySelectorAll<HTMLElement>("[data-replay-arrow-anchor-id]"))
      .find(element => element.dataset.replayArrowAnchorId === id);
    if (marker) return marker;
  }
  return Array.from(root.querySelectorAll<HTMLElement>("[data-card-id][data-replay-card-anchor]"))
    .find(element => element.dataset.cardId === id && element.dataset.replayCardAnchor === anchor);
}

export function ReplayTargetArrows({ rootRef, state, eventIndex, perspectivePlayerId, speed, playing, suppressed }: {
  rootRef: RefObject<HTMLDivElement | null>;
  state: ReplayState;
  eventIndex: number;
  perspectivePlayerId: string;
  speed: number;
  playing: boolean;
  suppressed: boolean;
}) {
  const markerPrefix = `recorded-target-${useId().replace(/:/g, "")}`;
  const captured = useMemo(() => suppressed ? [] : getReplayTargetArrows(state), [state, suppressed]);
  const signature = JSON.stringify(captured);
  const [positioned, setPositioned] = useState<{ signature: string; arrows: PositionedArrow[] }>({ signature: "", arrows: [] });
  // The board owns the ref: its DOM attachment follows child layout effects.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !captured.length) return;
    let frame = 0;
    let disposed = false;
    // Follow the existing short card movement, then stop sampling entirely.
    const followUntil = performance.now() + 460 / Math.max(1, speed);
    const measure = () => {
      if (disposed) return;
      const bounds = root.getBoundingClientRect();
      const scale = bounds.width / Math.max(1, root.offsetWidth);
      if (!(scale > 0)) return;
      const arrows: PositionedArrow[] = [];
      for (const arrow of captured) {
        const source = replayArrowElement(root, arrow.sourceCardId, arrow.sourceAnchor);
        const target = replayArrowElement(root, arrow.targetCardId, arrow.targetAnchor);
        if (!source || !target) continue;
        const from = source.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        if (!from.width || !from.height || !to.width || !to.height) continue;
        const fromX = (from.left + from.width / 2 - bounds.left) / scale;
        const fromY = (from.top + from.height / 2 - bounds.top) / scale;
        const centerX = (to.left + to.width / 2 - bounds.left) / scale;
        const centerY = (to.top + to.height / 2 - bounds.top) / scale;
        const distance = Math.hypot(centerX - fromX, centerY - fromY);
        if (distance < 10) continue;
        // End near the card's edge so the arrowhead leaves its artwork readable.
        const inset = Math.min(Math.min(to.width, to.height) / scale * .38, distance * .25);
        arrows.push({ ...arrow, fromX, fromY,
          toX: centerX - (centerX - fromX) / distance * inset,
          toY: centerY - (centerY - fromY) / distance * inset });
      }
      setPositioned(previous => previous.signature === signature && JSON.stringify(previous.arrows) === JSON.stringify(arrows)
        ? previous : { signature, arrows });
    };
    const follow = () => {
      measure();
      if (!disposed && performance.now() < followUntil) frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); };
    // signature encodes the validated arrows; ordinary clock ticks need no new sampling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, eventIndex, rootRef, speed, perspectivePlayerId, playing]);
  const arrows = positioned.signature === signature ? positioned.arrows : [];
  if (!arrows.length) return null;
  const ours = arrows.some(arrow => arrow.actorPlayerId === perspectivePlayerId);
  const theirs = arrows.some(arrow => arrow.actorPlayerId !== perspectivePlayerId);
  return <>
    <div className={styles.key} data-recorded-target-key>
      <span>Targets</span>
      {ours ? <span className={styles.ours}><i />Our arrows</span> : null}
      {theirs ? <span className={styles.theirs}><i />Enemy arrows</span> : null}
    </div>
    <svg aria-label={`${arrows.length} recorded targeting ${arrows.length === 1 ? "arrow" : "arrows"}`} className={styles.layer} role="img" viewBox="0 0 1590 962">
      <defs>{["ours", "theirs"].map(side => <marker id={`${markerPrefix}-${side}`} key={side} markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
        <path d="M0 0 L8 4 L0 8 Z" fill={side === "ours" ? "#77f0e4" : "#ffab85"} />
      </marker>)}</defs>
      {arrows.map(arrow => {
        const side = arrow.actorPlayerId === perspectivePlayerId ? "ours" : "theirs";
        const d = replayTargetArrowPath(arrow);
        return <g className={styles[side]} data-recorded-target-arrow={side} key={arrow.id}>
          <path className={styles.outline} d={d} />
          <path className={styles.arrow} d={d} markerEnd={`url(#${markerPrefix}-${side})`} />
          <circle className={styles.source} cx={arrow.fromX} cy={arrow.fromY} r="5" />
        </g>;
      })}
    </svg>
  </>;
}
