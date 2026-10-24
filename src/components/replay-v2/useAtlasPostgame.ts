"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CanonicalReplayV2, ReplayState } from "@/lib/replay-v2";
import { decodeAtlasPostgameReplay, encodeAtlasPostgameReplay, matchAtlasPostgameReplay, projectAtlasPostgameState, type AtlasPostgameSource, type AtlasPostgameAlignment } from "@/lib/replay-v2/atlas-postgame";
import { ReviewRequestError, StaleReviewRequest, useReviewAccountSession } from "./review-account-client";

export type AtlasPostgameGame = {
  gameId: string; gameNumber: number; frameCount: number; sha256: string; shared: boolean;
  firstElapsedMs: number; lastElapsedMs: number; matchedEventCount?: number;
};
type Metadata = { accountId: string; canManage: boolean; available: boolean; games: AtlasPostgameGame[] };
type Prepared = { sha256: string; source: AtlasPostgameSource; alignment: AtlasPostgameAlignment };
type View = { scope: string; metadata: Metadata | null; prepared: Prepared[]; allCards: boolean; busy: boolean; error: string };
const empty = (scope: string): View => ({ scope, metadata: null, prepared: [], allCards: false, busy: false, error: "" });
const metadataOf = (payload: Record<string, unknown>): Metadata => ({
  accountId: String(payload.accountId), canManage: payload.canManage === true,
  available: payload.available === true, games: Array.isArray(payload.games) ? payload.games as AtlasPostgameGame[] : [],
});
const errorText = (error: unknown) => error instanceof Error ? error.message : "Atlas replay could not be loaded. Please try again.";

/** The original replay remains immutable. Imported identities live only in this account-scoped memory cache. */
export function useAtlasPostgame({ replayId, apiBasePath, replay, enabled = true }: {
  replayId: string; apiBasePath: string; replay: CanonicalReplayV2 | null; enabled?: boolean;
}) {
  const endpoint = `${apiBasePath}/${encodeURIComponent(replayId)}/atlas-postgame`;
  const [stored, setStored] = useState<View>(() => empty(endpoint));
  const state = stored.scope === endpoint ? stored : empty(endpoint);
  const stateRef = useRef(state);
  const serial = useRef(0);
  const [boundary, setBoundary] = useState(0);
  const commit = useCallback((next: View) => { stateRef.current = next; setStored(next); }, []);
  const clear = useCallback(() => {
    serial.current += 1;
    commit(empty(endpoint));
    setBoundary(value => value + 1);
  }, [commit, endpoint]);
  const { ready, key, request } = useReviewAccountSession(clear);
  useLayoutEffect(() => {
    // Drop private data before paint when a different canonical replay replaces this one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    clear();
    return () => { serial.current += 1; };
  }, [clear, replay]);

  const refresh = useCallback(async () => {
    if (!enabled || !ready || !replay || stateRef.current.busy) return;
    const ticket = ++serial.current;
    try {
      const payload = await request(`${endpoint}?metadata=1`);
      if (ticket !== serial.current) return;
      const metadata = metadataOf(payload);
      const previous = stateRef.current;
      const sameAccount = previous.metadata?.accountId === metadata.accountId;
      const prepared = sameAccount ? previous.prepared.filter(item => metadata.games.some(game => game.gameId === item.alignment.gameId && game.sha256 === item.sha256)) : [];
      if (!sameAccount && previous.metadata) setBoundary(value => value + 1);
      commit({ ...previous, scope: endpoint, metadata, prepared, allCards: previous.allCards && sameAccount && prepared.length > 0, error: "" });
    } catch (error) {
      if (error instanceof StaleReviewRequest || ticket !== serial.current) return;
      // An older server may not expose the optional endpoint yet. Normal playback still works.
      const quiet = error instanceof ReviewRequestError && [401, 403, 404].includes(error.status);
      commit({ ...empty(endpoint), error: quiet ? "" : errorText(error) });
      setBoundary(value => value + 1);
    }
  }, [commit, enabled, endpoint, ready, replay, request]);
  useEffect(() => {
    queueMicrotask(() => void refresh());
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    const timer = window.setInterval(focus, 60_000);
    return () => { window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); window.clearInterval(timer); };
  }, [key, refresh]);

  const showPlayerView = useCallback(() => {
    serial.current += 1;
    commit({ ...stateRef.current, allCards: false, busy: false });
  }, [commit]);
  const showAllCards = useCallback(async () => {
    const previous = stateRef.current;
    if (!enabled || !ready || !replay || previous.busy || !previous.metadata?.available) return;
    const ticket = ++serial.current;
    commit({ ...previous, busy: true, error: "" });
    try {
      // Recheck access before each reveal, including when a decoded attachment is cached.
      const payload = await request(endpoint);
      if (ticket !== serial.current) return;
      const metadata = metadataOf(payload);
      if (metadata.accountId !== previous.metadata.accountId) { clear(); return; }
      const exports = Array.isArray(payload.exports) ? payload.exports as { gameId: string; replay: unknown }[] : [];
      const prepared = exports.map(entry => {
        const game = metadata.games.find(candidate => candidate.gameId === entry.gameId);
        if (!game) throw new Error("Atlas replay information changed. Please reload it.");
        const cached = previous.prepared.find(item => item.alignment.gameId === game.gameId && item.sha256 === game.sha256);
        if (cached) return cached;
        const source = decodeAtlasPostgameReplay(entry.replay);
        const alignment = matchAtlasPostgameReplay(replay, source);
        if (alignment.gameId !== game.gameId) throw new Error("This Atlas file does not match the selected game.");
        return { source, alignment, sha256: game.sha256 };
      });
      commit({ scope: endpoint, metadata, prepared, allCards: prepared.length > 0, busy: false, error: "" });
    } catch (error) {
      if (error instanceof StaleReviewRequest || ticket !== serial.current) return;
      commit({ ...empty(endpoint), metadata: previous.metadata, error: errorText(error) });
      setBoundary(value => value + 1);
    }
  }, [clear, commit, enabled, endpoint, ready, replay, request]);

  const importFile = useCallback(async (file: File): Promise<boolean> => {
    const previous = stateRef.current;
    if (!replay || !previous.metadata?.canManage || previous.busy) return false;
    const ticket = ++serial.current;
    commit({ ...previous, allCards: false, busy: true, error: "" });
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error("This Atlas file is too large. Export one completed game at a time.");
      const source = decodeAtlasPostgameReplay(await file.text());
      const alignment = matchAtlasPostgameReplay(replay, source);
      const body = JSON.stringify({ replay: encodeAtlasPostgameReplay(source), expectedAccountId: previous.metadata.accountId, expectedSha256: previous.metadata.games.find(game => game.gameId === alignment.gameId)?.sha256 ?? null });
      if (new TextEncoder().encode(body).length > 4 * 1024 * 1024) throw new Error("This Atlas game is too large to attach. Your original replay has not changed.");
      if (ticket !== serial.current) return false;
      const payload = await request(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
      if (ticket !== serial.current) return false;
      const metadata = metadataOf(payload);
      if (metadata.accountId !== previous.metadata.accountId) { clear(); return false; }
      commit({ scope: endpoint, metadata, prepared: [], allCards: false, busy: false, error: "" });
      return true;
    } catch (error) {
      if (error instanceof StaleReviewRequest || ticket !== serial.current) return false;
      commit({ ...previous, allCards: false, busy: false, error: errorText(error) });
      return false;
    }
  }, [clear, commit, endpoint, replay, request]);

  const setShared = useCallback(async (gameId: string, shared: boolean) => {
    const previous = stateRef.current;
    if (!previous.metadata?.canManage || previous.busy) return;
    const ticket = ++serial.current;
    commit({ ...previous, busy: true, error: "" });
    try {
      const payload = await request(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gameId, shared, expectedAccountId: previous.metadata.accountId, expectedSha256: previous.metadata.games.find(game => game.gameId === gameId)?.sha256 }) });
      if (ticket !== serial.current) return;
      const metadata = metadataOf(payload);
      if (metadata.accountId !== previous.metadata.accountId) { clear(); return; }
      commit({ ...previous, metadata, busy: false, error: "" });
    } catch (error) {
      if (error instanceof StaleReviewRequest || ticket !== serial.current) return;
      commit({ ...previous, allCards: false, prepared: [], busy: false, error: errorText(error) });
    }
  }, [clear, commit, endpoint, request]);

  const project = useCallback((current: ReplayState | null) => {
    if (!current || !enabled || !state.allCards) return null;
    const attachment = state.prepared.find(item => item.alignment.gameId === current.gameId);
    return attachment ? projectAtlasPostgameState(current, attachment.source, attachment.alignment) : null;
  }, [enabled, state.allCards, state.prepared]);
  return useMemo(() => ({ ...state, boundaryKey: `${endpoint}:${key}:${boundary}`, showPlayerView, showAllCards, importFile, setShared, project }), [state, endpoint, key, boundary, showPlayerView, showAllCards, importFile, setShared, project]);
}
