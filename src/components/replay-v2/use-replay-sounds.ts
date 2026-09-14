"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";
import { latestReplaySoundCue, replaySoundCues } from "./replay-sound-cues";
import { createReplaySoundPlayer, type ReplaySoundPlayer } from "./replay-sound-player";

export const REPLAY_SOUND_PREFERENCE_KEY = "riftlite.replay-sounds.v1";
const DEFAULT_PREFERENCE = { enabled: false, volume: 0.5 };
type SoundPreference = typeof DEFAULT_PREFERENCE;

function readPreference(): SoundPreference {
  try {
    const stored = JSON.parse(window.localStorage.getItem(REPLAY_SOUND_PREFERENCE_KEY) ?? "null");
    return {
      enabled: stored?.enabled === true,
      volume: typeof stored?.volume === "number" && Number.isFinite(stored.volume)
        ? Math.min(1, Math.max(0, stored.volume)) : DEFAULT_PREFERENCE.volume,
    };
  } catch { return DEFAULT_PREFERENCE; }
}

export function useReplaySounds(replay: CanonicalReplayV2 | null) {
  const [preference, setPreference] = useState(DEFAULT_PREFERENCE);
  const preferenceRef = useRef(preference);
  const playerRef = useRef<ReplaySoundPlayer | null>(null);
  const cues = useMemo(() => replay ? replaySoundCues(replay) : [], [replay]);

  const silence = useCallback(() => playerRef.current?.stop(), []);
  const unlock = useCallback(() => {
    if (!preferenceRef.current.enabled || preferenceRef.current.volume === 0) return;
    playerRef.current ??= createReplaySoundPlayer();
    void playerRef.current.unlock();
  }, []);

  useEffect(() => {
    let active = true;
    // Keep the server and first client render muted; storage never unlocks audio.
    queueMicrotask(() => {
      if (!active) return;
      preferenceRef.current = readPreference();
      setPreference(preferenceRef.current);
    });
    const onVisibilityChange = () => { if (document.hidden) silence(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [silence]);

  useEffect(() => {
    // Reloads and switching replay IDs must not carry a previous cue across.
    silence();
  }, [replay, silence]);

  const updatePreference = useCallback((next: SoundPreference) => {
    preferenceRef.current = next;
    setPreference(next);
    try { window.localStorage.setItem(REPLAY_SOUND_PREFERENCE_KEY, JSON.stringify(next)); }
    catch { /* Playback still works when storage is unavailable. */ }
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    updatePreference({ ...preferenceRef.current, enabled });
    if (enabled) unlock();
    else silence();
  }, [silence, unlock, updatePreference]);

  const setVolume = useCallback((volume: number) => {
    if (!Number.isFinite(volume)) return;
    updatePreference({ ...preferenceRef.current, volume: Math.min(1, Math.max(0, volume)) });
    silence();
    unlock();
  }, [silence, unlock, updatePreference]);

  // Called only by the natural playback clock, never by a projection/seek effect.
  const advance = useCallback((fromIndex: number, toIndex: number) => {
    const { enabled, volume } = preferenceRef.current;
    if (!enabled || volume === 0 || document.hidden) return;
    const cue = latestReplaySoundCue(cues, fromIndex, toIndex);
    if (cue) playerRef.current?.play(cue.kind, volume);
  }, [cues]);

  return { ...preference, setEnabled, setVolume, unlock, silence, advance };
}
