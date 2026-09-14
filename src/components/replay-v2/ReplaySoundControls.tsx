"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Volume2, VolumeX } from "lucide-react";
import styles from "./ReplaySoundControls.module.css";

export function ReplaySoundControls({ enabled, volume, onEnabledChange, onVolumeChange }: {
  enabled: boolean;
  volume: number;
  onEnabledChange: (enabled: boolean) => void;
  onVolumeChange: (volume: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const audible = enabled && volume > 0;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <div className={styles.controls} ref={rootRef} data-control="replay-sound"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault(); event.stopPropagation();
          setOpen(false); settingsRef.current?.focus();
        }
      }}>
      <button aria-label={enabled ? "Mute replay sounds" : "Enable replay sounds"}
        aria-pressed={enabled} className={styles.toggle} type="button"
        title={enabled ? "Mute replay sounds" : "Enable turn and point sounds"}
        onClick={() => onEnabledChange(!enabled)}>
        {audible ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
      </button>
      <button aria-label="Replay sound settings" aria-expanded={open} aria-controls={panelId}
        className={styles.settings} onClick={() => setOpen(!open)} ref={settingsRef} type="button">
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? <div className={styles.panel} id={panelId} role="group" aria-label="Replay sound settings">
        <div className={styles.heading}><span>Replay sounds</span><span>{enabled ? "On" : "Muted"}</span></div>
        <label className={styles.volume}>
          <span>Volume <b>{Math.round(volume * 100)}%</b></span>
          <input aria-label="Replay sound volume" aria-valuetext={`${Math.round(volume * 100)} percent`}
            min={0} max={100} step={5} type="range" value={Math.round(volume * 100)}
            onChange={(event) => onVolumeChange(Number(event.currentTarget.value) / 100)} />
        </label>
        <p>Turn start · Point scored</p>
      </div> : null}
    </div>
  );
}
