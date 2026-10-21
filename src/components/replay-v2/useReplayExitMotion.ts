"use client";

import { useLayoutEffect, useRef } from "react";
import {
  REPLAY_CARD_MOVEMENT_MAX_CUES,
  replayCardMovementCues,
  type ReplayMovementSource,
} from "./card-movement-cues";
import styles from "./useReplayExitMotion.module.css";

export type ReplayExitMotionOptions = {
  rootRef: { current: HTMLDivElement | null };
  replay: ReplayMovementSource;
  eventIndex: number;
  gameId: string | null;
  speed: number;
  suppressMotion: boolean;
  enabled: boolean;
  motionEpoch: number;
};

type SourceVisual = {
  visual: HTMLElement;
  owner: string | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
};
type Ghost = { element: HTMLElement; animation: Animation; speed: number };
const MAX_SOURCE_VISUALS = 256;
const playbackSpeed = (speed: number) => Number.isFinite(speed) ? Math.min(16, Math.max(1, speed)) : 1;

/** Run before the board's ordinary FLIP hook, which changes live card transforms. */
export function useReplayExitMotion({
  rootRef, replay, eventIndex, gameId, speed, suppressMotion, enabled, motionEpoch,
}: ReplayExitMotionOptions): void {
  const previous = useRef<{
    root: HTMLElement;
    replay: ReplayMovementSource;
    eventIndex: number;
    gameId: string | null;
    epoch: number;
    visuals: Map<string, SourceVisual[]>;
  } | null>(null);
  const ghosts = useRef(new Map<string, Ghost>());
  const reducedMotion = useRef(false);

  const clearGhosts = () => {
    for (const ghost of ghosts.current.values()) {
      ghost.animation.onfinish = null;
      ghost.animation.oncancel = null;
      try { ghost.animation.cancel(); } catch { /* A completed animation may already be detached. */ }
      ghost.element.remove();
    }
    ghosts.current.clear();
  };

  useLayoutEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    reducedMotion.current = query?.matches ?? false;
    const changed = () => {
      reducedMotion.current = query?.matches ?? false;
      previous.current = null;
      clearGhosts();
    };
    query?.addEventListener?.("change", changed);
    return () => {
      query?.removeEventListener?.("change", changed);
      previous.current = null;
      clearGhosts();
    };
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const old = previous.current;
    const rate = playbackSpeed(speed);
    if (!root || !enabled || suppressMotion || reducedMotion.current) {
      clearGhosts();
      previous.current = null;
      return;
    }
    const discontinuity = !old || old.root !== root || old.replay !== replay || old.gameId !== gameId ||
      old.epoch !== motionEpoch || eventIndex < old.eventIndex;
    if (discontinuity) clearGhosts();
    else {
      for (const ghost of ghosts.current.values()) {
        if (ghost.speed === rate) continue;
        const currentRate = Number.isFinite(ghost.animation.playbackRate) ? ghost.animation.playbackRate : 1;
        const nextRate = currentRate * rate / ghost.speed;
        try {
          if (typeof ghost.animation.updatePlaybackRate === "function") ghost.animation.updatePlaybackRate(nextRate);
          else ghost.animation.playbackRate = nextRate;
          ghost.speed = rate;
        } catch { /* Finished animations need no retiming. */ }
      }
      // Pausing, resuming and speed changes must not create duplicate ghosts or
      // replace the saved layout with a mid-flight FLIP measurement.
      if (eventIndex === old.eventIndex) return;
    }

    const bounds = root.getBoundingClientRect();
    const scaleX = root.offsetWidth > 0 ? bounds.width / root.offsetWidth : 1;
    const scaleY = root.offsetHeight > 0 ? bounds.height / root.offsetHeight : scaleX;
    if (!(bounds.width > 0 && bounds.height > 0 && Number.isFinite(scaleX) && scaleX > 0 && Number.isFinite(scaleY) && scaleY > 0)) {
      clearGhosts();
      previous.current = null;
      return;
    }
    const visuals = new Map<string, SourceVisual[]>();
    const nodes = root.querySelectorAll<HTMLElement>("[data-card-motion-id]");
    for (const element of Array.from(nodes).slice(0, MAX_SOURCE_VISUALS)) {
      if (element.closest("[data-replay-exit-motion]")) continue;
      const cardId = element.dataset.cardId ?? element.dataset.cardMotionId;
      const rect = element.getBoundingClientRect();
      if (!cardId || !usableRect(rect) || !element.firstElementChild) continue;
      const ownerElement = element.closest<HTMLElement>("[data-player-id], [data-analysis-drop-player-id]");
      const source: SourceVisual = {
        visual: renderedVisual(element.firstElementChild as HTMLElement),
        owner: ownerElement?.dataset.playerId ?? ownerElement?.dataset.analysisDropPlayerId,
        x: (rect.left - bounds.left) / scaleX,
        y: (rect.top - bounds.top) / scaleY,
        width: rect.width / scaleX,
        height: rect.height / scaleY,
      };
      const existing = visuals.get(cardId) ?? [];
      existing.push(source);
      visuals.set(cardId, existing);
    }
    previous.current = { root, replay, eventIndex, gameId, epoch: motionEpoch, visuals };
    if (discontinuity || !old) return;

    const cues = replayCardMovementCues(replay, {
      fromExclusiveIndex: old.eventIndex, toInclusiveIndex: eventIndex, gameId, suppressMotion,
    });
    const piles = Array.from(root.querySelectorAll<HTMLElement>("[data-replay-pile-player-id][data-replay-pile-zone]"));
    for (const cue of cues) {
      if (ghosts.current.has(cue.id) || visuals.has(cue.cardId)) continue;
      const candidates = (old.visuals.get(cue.cardId) ?? []).filter((item) => !item.owner || item.owner === cue.from.playerId);
      // Duplicate DOM representations are ambiguous; never fly the wrong card.
      if (candidates.length !== 1) continue;
      const source = candidates[0];
      const pile = piles.find((node) => node.dataset.replayPilePlayerId === cue.to.playerId && node.dataset.replayPileZone === cue.destinationZone);
      if (!pile) continue;
      const destination = pile.getBoundingClientRect();
      if (!usableRect(destination)) continue;
      while (ghosts.current.size >= REPLAY_CARD_MOVEMENT_MAX_CUES) {
        const [key, ghost] = ghosts.current.entries().next().value!;
        ghost.animation.onfinish = null;
        ghost.animation.oncancel = null;
        try { ghost.animation.cancel(); } catch { /* Detached animation. */ }
        ghost.element.remove();
        ghosts.current.delete(key);
      }
      const element = document.createElement("div");
      element.className = styles.ghost;
      element.dataset.replayExitMotion = cue.kind;
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
      Object.assign(element.style, { left: `${source.x}px`, top: `${source.y}px`, width: `${source.width}px`, height: `${source.height}px` });
      if (cue.forceCardBack) {
        const back = document.createElement("span");
        back.className = styles.back;
        back.textContent = "R";
        element.append(back);
      } else element.append(source.visual.cloneNode(true));
      root.append(element);
      const dx = (destination.left + destination.width / 2 - bounds.left) / scaleX - source.x - source.width / 2;
      const dy = (destination.top + destination.height / 2 - bounds.top) / scaleY - source.y - source.height / 2;
      try {
        const animation = element.animate([
          { transform: "translate(0, 0) scale(1)", opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) scale(.26)`, opacity: 0 },
        ], { duration: 480 / rate, easing: "cubic-bezier(.3,.05,.4,1)", fill: "both" });
        const ghost = { element, animation, speed: rate };
        ghosts.current.set(cue.id, ghost);
        const finished = () => {
          if (ghosts.current.get(cue.id) === ghost) ghosts.current.delete(cue.id);
          element.remove();
        };
        animation.onfinish = finished;
        animation.oncancel = finished;
      } catch { element.remove(); }
    }
  }, [rootRef, replay, eventIndex, gameId, speed, suppressMotion, enabled, motionEpoch]);
}

function usableRect(rect: DOMRect): boolean {
  return [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 && rect.height > 0 && rect.width < 10_000 && rect.height < 10_000;
}

/** Keep only the already-visible face. No event handlers, IDs or card metadata. */
function renderedVisual(face: HTMLElement): HTMLElement {
  const clone = face.cloneNode(true) as HTMLElement;
  for (const element of [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === "class" || attribute.name === "style" || (element.tagName === "IMG" && attribute.name === "src")) continue;
      element.removeAttribute(attribute.name);
    }
    if (element.tagName === "IMG") element.setAttribute("alt", "");
  }
  return clone;
}
