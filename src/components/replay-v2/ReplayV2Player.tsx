"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getAuth } from "firebase/auth";

import {
  seekReplay,
  seekReplayByEventIndex,
  type CanonicalReplayV2,
  type JsonObject,
  type JsonValue,
  type ReplayCardState,
  type ReplayChainEntry,
  type ReplayEvent,
  type ReplayPlayerState,
  type ReplayState,
} from "@/lib/replay-v2";
import { firebaseClientApp } from "@/lib/firebase/client";

import styles from "./ReplayV2Player.module.css";
import {
  activeScene,
  battlefieldCards,
  battlefieldZoneForPlayer,
  boardZones,
  cardImageUrl,
  cardName,
  championCard,
  deckCards,
  discardCards,
  eventLabel,
  formatClock,
  gameForState,
  handCards,
  initiativeRoll,
  isBattlefieldCard,
  isDuplicateCard,
  legendCard,
  replayDurationMs,
  resolveReplayPlayers,
  sideboardCards,
  turnMarkers,
  visibleCardFields,
  zoneCards,
  type ReplayPlayerPair,
  type ReplaySceneKind,
  type ReplayTurnMarker,
} from "./model";

const DESIGN_WIDTH = 1_920;
const DESIGN_HEIGHT = 1_080;
const ACTION_ANIMATION_MS = 430;
const PLAYBACK_SPEEDS = [1, 2, 4] as const;
const FIRST_GAME_PRELUDE: Array<Exclude<ReplaySceneKind, null>> = [
  "matchup",
  "battlefields",
  "initiative",
  "opening",
  "mulligan",
  "game_start",
];
const NEXT_GAME_PRELUDE: Array<Exclude<ReplaySceneKind, null>> = [
  "game_transition",
  ...FIRST_GAME_PRELUDE,
];
const PRESENTATION_STAGE_MS: Record<Exclude<ReplaySceneKind, null>, number> = {
  matchup: 2_800,
  battlefields: 2_400,
  initiative: 2_500,
  opening: 2_700,
  mulligan: 2_300,
  game_start: 1_800,
  sideboarding: 2_500,
  game_transition: 2_000,
  game_end: 2_500,
};

export type ReplayV2PlayerProps = {
  replayId: string;
  embed?: boolean;
  apiBasePath?: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "pending"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; replay: CanonicalReplayV2 };

type DiscardOverlayState = {
  playerName: string;
  cards: ReplayCardState[];
} | null;

type PresentationCursor = {
  gameIndex: number;
  stageIndex: number;
};

export function ReplayV2Player({
  replayId,
  embed = false,
  apiBasePath = "/api/v2/replays",
}: ReplayV2PlayerProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [manualEventIndex, setManualEventIndex] = useState<number | null>(null);
  const [presentation, setPresentation] = useState<PresentationCursor | null>(null);
  const [completedPreludeGameId, setCompletedPreludeGameId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof PLAYBACK_SPEEDS)[number]>(1);
  const [showMore, setShowMore] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [discardOverlay, setDiscardOverlay] = useState<DiscardOverlayState>(null);
  const [hoveredCard, setHoveredCard] = useState<ReplayCardState | null>(null);
  const [selectedCard, setSelectedCard] = useState<ReplayCardState | null>(null);
  const [activityTab, setActivityTab] = useState<"chat" | "log">("chat");
  const [suppressMotion, setSuppressMotion] = useState(false);
  const [notice, setNotice] = useState("");
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pendingSeekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationLockedUntil = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replay = loadState.status === "ready" ? loadState.replay : null;
  const { hostRef, scale } = usePlayerScale();

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const loadReplay = async () => {
      try {
        const authorizationHeaders = await replayAuthorizationHeaders(controller.signal);
        const response = await fetch(`${apiBasePath}/${encodeURIComponent(replayId)}`, {
          credentials: "include",
          headers: { Accept: "application/json", ...authorizationHeaders },
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => null)) as unknown;
        if (response.status === 202) {
          const pending = pendingReplayDetails(body);
          if (controller.signal.aborted) return;
          if (pending.failed) {
            setLoadState({ status: "error", message: pending.message });
            return;
          }
          setLoadState({ status: "pending", message: pending.message });
          retryTimer = setTimeout(() => setReloadToken((value) => value + 1), 2_500);
          return;
        }
        if (!response.ok) {
          throw new Error(responseMessage(body) || `Replay request failed (${response.status}).`);
        }
        const nextReplay = unwrapCanonicalReplay(body);
        if (controller.signal.aborted) return;
        setLoadState({ status: "ready", replay: nextReplay });
        const sharedSeconds = Number(new URLSearchParams(window.location.search).get("t"));
        const sharedMs = Number.isFinite(sharedSeconds) && sharedSeconds > 0 ? sharedSeconds * 1_000 : 0;
        setCurrentMs(Math.min(replayDurationMs(nextReplay), sharedMs));
        setPresentation(sharedMs > 0 ? null : { gameIndex: 0, stageIndex: 0 });
        setCompletedPreludeGameId(null);
        setPlaying(false);
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "The replay could not be loaded.",
        });
      }
    };
    void loadReplay();

    return () => {
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [apiBasePath, reloadToken, replayId]);

  const durationMs = replay ? replayDurationMs(replay) : 1;
  const presentationStages = presentation ? preludeStagesForGame(presentation.gameIndex) : null;
  const presentationStage =
    presentation && presentationStages ? presentationStages[presentation.stageIndex] ?? null : null;
  const presentationEventIndex = useMemo(
    () =>
      replay && presentation && presentationStage
        ? eventIndexForPresentation(replay, presentation, presentationStage)
        : null,
    [presentation, presentationStage, replay],
  );
  const projection = useMemo(() => {
    if (!replay) return null;
    try {
      if (presentationEventIndex !== null) {
        return seekReplayByEventIndex(replay, presentationEventIndex);
      }
      return manualEventIndex === null
        ? seekReplay(replay, currentMs)
        : seekReplayByEventIndex(replay, manualEventIndex);
    } catch {
      return null;
    }
  }, [currentMs, manualEventIndex, presentationEventIndex, replay]);
  const state = projection?.state ?? null;
  const eventIndex = projection?.eventIndex ?? -1;
  const currentEvent = replay?.events[eventIndex];
  const turns = useMemo(() => (replay ? turnMarkers(replay) : []), [replay]);

  useEffect(() => {
    if (eventIndex < 0) return;
    animationLockedUntil.current = performance.now() + ACTION_ANIMATION_MS / speed;
  }, [eventIndex, speed]);

  useEffect(() => {
    if (!playing || !replay || presentation) return;
    let frame = 0;
    let lastPaint = performance.now();
    const tick = (now: number) => {
      if (now - lastPaint >= 24) {
        const elapsed = Math.min(100, Math.max(0, now - lastPaint));
        lastPaint = now;
        setManualEventIndex(null);
        setCurrentMs((value) => {
          const next = Math.min(durationMs, value + elapsed * speed);
          if (next >= durationMs) setPlaying(false);
          return next;
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationMs, playing, presentation, replay, speed]);

  useEffect(() => {
    return () => {
      if (pendingSeekTimer.current) clearTimeout(pendingSeekTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  const flashNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 2_600);
  }, []);

  const settleAnimations = useCallback((resume: boolean) => {
    const animations = canvasRef.current?.getAnimations({ subtree: true }) ?? [];
    for (const animation of animations) {
      try {
        if (resume) animation.play();
        else animation.pause();
      } catch {
        // A CSS animation can disappear between collection and control.
      }
    }
  }, []);

  const setMotionSuppressedBriefly = useCallback(() => {
    setSuppressMotion(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setSuppressMotion(false)));
  }, []);

  const seekTo = useCallback(
    (targetMs: number, options?: { immediate?: boolean; eventIndex?: number }) => {
      if (!replay) return;
      const target = Math.min(durationMs, Math.max(0, targetMs));
      const backwards = target < currentMs;
      const apply = () => {
        if (backwards || options?.immediate) setMotionSuppressedBriefly();
        setPresentation(null);
        setManualEventIndex(options?.eventIndex ?? null);
        setCurrentMs(target);
      };

      if (!backwards && !options?.immediate) {
        const remaining = animationLockedUntil.current - performance.now();
        if (remaining > 12) {
          if (pendingSeekTimer.current) clearTimeout(pendingSeekTimer.current);
          pendingSeekTimer.current = setTimeout(apply, remaining);
          return;
        }
      }
      apply();
    },
    [currentMs, durationMs, replay, setMotionSuppressedBriefly],
  );

  const beginGamePresentation = useCallback(
    (requestedIndex: number) => {
      if (!replay) return;
      const gameIndex = Math.min(Math.max(0, requestedIndex), Math.max(0, replay.series.games.length - 1));
      const game = replay.series.games[gameIndex];
      setPlaying(false);
      setManualEventIndex(null);
      setCurrentMs(game?.startedAtMs ?? 0);
      setCompletedPreludeGameId(null);
      setPresentation({ gameIndex, stageIndex: 0 });
      setMotionSuppressedBriefly();
    },
    [replay, setMotionSuppressedBriefly],
  );

  const advancePresentation = useCallback(
    (direction: -1 | 1) => {
      if (!presentation || !replay) return;
      const stages = preludeStagesForGame(presentation.gameIndex);
      const nextStage = presentation.stageIndex + direction;
      if (nextStage < 0) return;
      if (nextStage >= stages.length) {
        const game = replay.series.games[presentation.gameIndex];
        setPresentation(null);
        setManualEventIndex(null);
        setCompletedPreludeGameId(game?.id ?? null);
        setCurrentMs(game ? replayGamePlaybackStartMs(game) : currentMs);
        return;
      }
      setPresentation({ ...presentation, stageIndex: nextStage });
    },
    [currentMs, presentation, replay],
  );

  useEffect(() => {
    if (!playing || !presentationStage || !presentation) return;
    const timer = setTimeout(
      () => advancePresentation(1),
      PRESENTATION_STAGE_MS[presentationStage] / speed,
    );
    return () => clearTimeout(timer);
  }, [advancePresentation, playing, presentation, presentationStage, speed]);

  const togglePlayback = useCallback(() => {
    if (!replay) return;
    if (playing) {
      setPlaying(false);
      settleAnimations(false);
      return;
    }
    if (!presentation && currentMs >= durationMs) beginGamePresentation(0);
    setManualEventIndex(null);
    settleAnimations(true);
    setPlaying(true);
  }, [beginGamePresentation, currentMs, durationMs, playing, presentation, replay, settleAnimations]);

  const stepAction = useCallback(
    (direction: -1 | 1) => {
      if (!replay) return;
      setPlaying(false);
      if (presentation) {
        advancePresentation(direction);
        return;
      }
      if (!replay.events.length) return;
      if (direction < 0 && state) {
        const currentGame = gameForState(replay, state);
        const gameIndex = currentGame
          ? replay.series.games.findIndex((game) => game.id === currentGame.id)
          : 0;
        if (currentGame && currentMs <= currentGame.startedAtMs + 1) {
          const stages = preludeStagesForGame(Math.max(0, gameIndex));
          setPresentation({ gameIndex: Math.max(0, gameIndex), stageIndex: stages.length - 1 });
          setMotionSuppressedBriefly();
          return;
        }
      }
      const base = eventIndex < 0 ? 0 : eventIndex;
      const targetIndex = Math.min(replay.events.length - 1, Math.max(0, base + direction));
      const target = replay.events[targetIndex];
      seekTo(target.atMs, { immediate: direction < 0, eventIndex: targetIndex });
    },
    [advancePresentation, currentMs, eventIndex, presentation, replay, seekTo, setMotionSuppressedBriefly, state],
  );

  const stepGame = useCallback(
    (direction: -1 | 1) => {
      if (!replay || !state || !replay.series.games.length) return;
      const currentGame = gameForState(replay, state);
      const currentIndex = currentGame
        ? replay.series.games.findIndex((game) => game.id === currentGame.id)
        : 0;
      const nextIndex = Math.min(replay.series.games.length - 1, Math.max(0, currentIndex + direction));
      beginGamePresentation(nextIndex);
    },
    [beginGamePresentation, replay, state],
  );

  const stepTurn = useCallback(
    (direction: -1 | 1) => {
      if (!turns.length) return;
      const next =
        direction > 0
          ? turns.find((turn) => turn.atMs > currentMs + 1)
          : [...turns].reverse().find((turn) => turn.atMs < currentMs - 1);
      if (!next) return;
      setPlaying(false);
      seekTo(next.atMs, { immediate: direction < 0, eventIndex: next.eventIndex });
    },
    [currentMs, seekTo, turns],
  );

  const changeSpeed = useCallback((value: number) => {
    const next = PLAYBACK_SPEEDS.find((candidate) => candidate === value) ?? 1;
    setSpeed(next);
    flashNotice(`${next}× playback`);
  }, [flashNotice]);

  useEffect(() => {
    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.defaultPrevented || isTypingTarget(keyboardEvent.target)) return;
      if (keyboardEvent.key === "Escape") {
        setShowHelp(false);
        setDiscardOverlay(null);
        setShowMore(false);
        return;
      }
      if (keyboardEvent.key === "?" || (keyboardEvent.key === "/" && keyboardEvent.shiftKey)) {
        keyboardEvent.preventDefault();
        setShowHelp((value) => !value);
        return;
      }
      if (keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        togglePlayback();
        return;
      }
      if (keyboardEvent.key.toLowerCase() === "m") {
        keyboardEvent.preventDefault();
        setShowMore((value) => !value);
        return;
      }
      if (keyboardEvent.key === "1" || keyboardEvent.key === "2" || keyboardEvent.key === "4") {
        keyboardEvent.preventDefault();
        changeSpeed(Number(keyboardEvent.key));
        return;
      }
      if (keyboardEvent.key !== "ArrowLeft" && keyboardEvent.key !== "ArrowRight") return;
      keyboardEvent.preventDefault();
      const direction = keyboardEvent.key === "ArrowLeft" ? -1 : 1;
      if (keyboardEvent.shiftKey) stepGame(direction);
      else if (keyboardEvent.altKey) stepTurn(direction);
      else stepAction(direction);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changeSpeed, stepAction, stepGame, stepTurn, togglePlayback]);

  const shareReplay = useCallback(async () => {
    const url = new URL(`/replays/${encodeURIComponent(replayId)}`, window.location.origin);
    if (currentMs > 500) url.searchParams.set("t", String(Math.round(currentMs / 1_000)));
    try {
      if (navigator.share) {
        await navigator.share({ title: "RiftLite Replay", url: url.toString() });
        flashNotice("Replay shared");
      } else {
        await navigator.clipboard.writeText(url.toString());
        flashNotice("Replay link copied");
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      flashNotice("Could not share this replay");
    }
  }, [currentMs, flashNotice, replayId]);

  const captureFrame = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      flashNotice("Frame capture is unavailable in this browser");
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: false,
      });
      const video = document.createElement("video");
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("No frame was produced.");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `riftlite-${replayId}-${Math.round(currentMs / 1_000)}s.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
      flashNotice("Replay frame captured");
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        flashNotice("Frame capture cancelled");
      } else {
        flashNotice("Could not capture this frame");
      }
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }, [currentMs, flashNotice, replayId]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shellRef.current?.requestFullscreen();
    } catch {
      flashNotice("Fullscreen is unavailable");
    }
  }, [flashNotice]);

  const inspectedCard = useMemo(() => {
    if (hoveredCard) return hoveredCard;
    if (selectedCard) return selectedCard;
    if (!state || !replay) return null;
    const players = resolveReplayPlayers(replay, state);
    return (
      legendCard(players.bottom) ??
      boardZones(players.bottom).flatMap((zone) => zone.cards)[0] ??
      handCards(players.bottom)[0] ??
      legendCard(players.top) ??
      null
    );
  }, [hoveredCard, replay, selectedCard, state]);

  const canvasStyle = { "--replay-scale": scale } as CSSProperties;

  return (
    <div
      className={`${styles.shell} ${embed ? styles.embedShell : ""}`}
      ref={shellRef}
      data-replay-player="v2"
    >
      <div className={styles.scaleHost} ref={hostRef}>
        <div className={styles.canvas} ref={canvasRef} style={canvasStyle}>
          {loadState.status === "loading" ? (
            <StatusScreen title="Preparing replay" detail="Loading the canonical match timeline…" busy />
          ) : loadState.status === "pending" ? (
            <StatusScreen title="Replay processing" detail={loadState.message} busy />
          ) : loadState.status === "error" ? (
            <StatusScreen
              title="Replay unavailable"
              detail={loadState.message}
              actionLabel="Try again"
              onAction={() => {
                setLoadState({ status: "loading" });
                setPlaying(false);
                setCurrentMs(0);
                setManualEventIndex(null);
                setReloadToken((value) => value + 1);
              }}
            />
          ) : !replay || !projection || !state ? (
            <StatusScreen
              title="Replay could not be projected"
              detail="The canonical timeline did not produce a playable state."
              actionLabel="Reload"
              onAction={() => {
                setLoadState({ status: "loading" });
                setPlaying(false);
                setCurrentMs(0);
                setManualEventIndex(null);
                setReloadToken((value) => value + 1);
              }}
            />
          ) : (
            <>
              <ReplayBoard
                currentMs={currentMs}
                eventIndex={eventIndex}
                inspectedCard={inspectedCard}
                onCardHover={setHoveredCard}
                onCardSelect={setSelectedCard}
                onOpenDiscard={(player) =>
                  setDiscardOverlay({ playerName: player.name, cards: discardCards(player) })
                }
                playing={playing}
                replay={replay}
                sceneOverride={presentationStage}
                state={state}
                suppressCanonicalOpening={completedPreludeGameId === state.gameId}
                suppressMotion={suppressMotion}
              />
              <InspectorRail
                activityTab={activityTab}
                currentEventLabel={presentationStage ? presentationStageLabel(presentationStage) : eventLabel(currentEvent)}
                currentMs={currentMs}
                embed={embed}
                inspectedCard={inspectedCard}
                onActivityTab={setActivityTab}
                onCapture={() => void captureFrame()}
                onFullscreen={() => void toggleFullscreen()}
                onHelp={() => setShowHelp(true)}
                onShare={() => void shareReplay()}
                replay={replay}
                state={state}
              />
              <TransportControls
                currentMs={currentMs}
                durationMs={durationMs}
                eventIndex={eventIndex}
                onChangeSpeed={changeSpeed}
                onFrame={(index) => {
                  const event = replay.events[index];
                  if (event) seekTo(event.atMs, { immediate: index < eventIndex, eventIndex: index });
                }}
                onGame={(gameIndex) => beginGamePresentation(gameIndex)}
                onHelp={() => setShowHelp(true)}
                onSeek={seekTo}
                onStepAction={stepAction}
                onStepGame={stepGame}
                onStepTurn={stepTurn}
                onToggleMore={() => setShowMore((value) => !value)}
                onTogglePlayback={togglePlayback}
                playing={playing}
                presentationFrame={
                  presentation && presentationStages && presentationStage
                    ? {
                        index: presentation.stageIndex,
                        label: presentationStageLabel(presentationStage),
                        total: presentationStages.length,
                      }
                    : null
                }
                onPresentationFrame={(stageIndex) => {
                  if (!presentation || !presentationStages) return;
                  setPlaying(false);
                  setPresentation({
                    ...presentation,
                    stageIndex: Math.min(presentationStages.length - 1, Math.max(0, stageIndex)),
                  });
                }}
                replay={replay}
                showMore={showMore}
                speed={speed}
                state={state}
                turns={turns}
              />
              {discardOverlay ? (
                <DiscardOverlay
                  cards={discardOverlay.cards}
                  onCardHover={setHoveredCard}
                  onCardSelect={setSelectedCard}
                  onClose={() => setDiscardOverlay(null)}
                  playerName={discardOverlay.playerName}
                />
              ) : null}
              {showHelp ? <ShortcutHelp onClose={() => setShowHelp(false)} /> : null}
              {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplayBoard({
  currentMs,
  eventIndex,
  inspectedCard,
  onCardHover,
  onCardSelect,
  onOpenDiscard,
  playing,
  replay,
  sceneOverride,
  state,
  suppressCanonicalOpening,
  suppressMotion,
}: {
  currentMs: number;
  eventIndex: number;
  inspectedCard: ReplayCardState | null;
  onCardHover: (card: ReplayCardState | null) => void;
  onCardSelect: (card: ReplayCardState) => void;
  onOpenDiscard: (player: ReplayPlayerState) => void;
  playing: boolean;
  replay: CanonicalReplayV2;
  sceneOverride: Exclude<ReplaySceneKind, null> | null;
  state: ReplayState;
  suppressCanonicalOpening: boolean;
  suppressMotion: boolean;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const players = useMemo(() => resolveReplayPlayers(replay, state), [replay, state]);
  const battlefields = useMemo(() => battlefieldCards(state, players), [players, state]);
  const canonicalScene = activeScene(replay, state, currentMs);
  const scene = sceneOverride ?? (
    suppressCanonicalOpening && canonicalScene === "opening" ? null : canonicalScene
  );
  const action = replay.events[eventIndex];
  useCardMotion(boardRef, eventIndex, suppressMotion);
  useEventEmphasis(boardRef, action);
  const arrows = useTargetArrows(boardRef, state.chain, eventIndex);

  return (
    <section
      aria-label="Replay board"
      className={`${styles.board} ${suppressMotion ? styles.motionSuppressed : ""}`}
      ref={boardRef}
    >
      <PlayerRail
        active={state.room.activeTurnPlayerId === players.top.id}
        orientation="top"
        player={players.top}
      />
      <PlayerPileStack
        onOpenDiscard={() => onOpenDiscard(players.top)}
        orientation="top"
        player={players.top}
      />
      <PlayerHeroStack orientation="top" player={players.top} />
      <PlayerHalf
        inspectedCard={inspectedCard}
        onCardHover={onCardHover}
        onCardSelect={onCardSelect}
        orientation="top"
        player={players.top}
      />
      <CentralArena
        battlefields={battlefields}
        chain={state.chain}
        onCardHover={onCardHover}
        onCardSelect={onCardSelect}
        players={players}
      />
      <PlayerHalf
        inspectedCard={inspectedCard}
        onCardHover={onCardHover}
        onCardSelect={onCardSelect}
        orientation="bottom"
        player={players.bottom}
      />
      <PlayerHeroStack orientation="bottom" player={players.bottom} />
      <PlayerPileStack
        onOpenDiscard={() => onOpenDiscard(players.bottom)}
        orientation="bottom"
        player={players.bottom}
      />
      <PlayerRail
        active={state.room.activeTurnPlayerId === players.bottom.id}
        orientation="bottom"
        player={players.bottom}
      />
      <TargetArrowLayer arrows={arrows} />
      <div className={styles.actionCaption} key={action?.id ?? "replay-ready"}>
        <span className={styles.actionDot} />
        {eventLabel(action)}
      </div>
      {scene ? (
        <SceneOverlay
          battlefields={battlefields}
          currentMs={currentMs}
          playing={playing}
          players={players}
          replay={replay}
          scene={scene}
          state={state}
        />
      ) : null}
    </section>
  );
}

function PlayerRail({
  active,
  orientation,
  player,
}: {
  active: boolean;
  orientation: "top" | "bottom";
  player: ReplayPlayerState;
}) {
  const legend = legendCard(player);
  const score = player.score ?? looseNumber(player.boardFields.score) ?? looseNumber(player.fields.score) ?? 0;
  return (
    <header
      className={`${styles.playerRail} ${
        orientation === "top" ? styles.playerRailTop : styles.playerRailBottom
      } ${active ? styles.activePlayerRail : ""}`}
    >
      <div className={styles.playerIdentity}>
        <MiniPortrait card={legend} fallback={player.name} />
        <div>
          <span className={styles.playerEyebrow}>{orientation === "bottom" ? "Capture player" : "Opponent"}</span>
          <strong>{player.name}</strong>
        </div>
      </div>
      <div className={styles.turnStatus}>
        <span className={styles.turnPulse} />
        {active ? "Active turn" : "Waiting"}
      </div>
      <div className={styles.playerRailStats}>
        <span className={styles.pointsBadge} data-player-score={score} aria-label={`${score} points`}>
          <small>Points</small>
          <b>{score}</b>
        </span>
      </div>
    </header>
  );
}

function PlayerHeroStack({
  orientation,
  player,
}: {
  orientation: "top" | "bottom";
  player: ReplayPlayerState;
}) {
  const legend = legendCard(player);
  const champion = championCard(player);
  return (
    <aside
      aria-label={`${player.name} legend and champion`}
      className={`${styles.playerHeroStack} ${
        orientation === "top" ? styles.playerHeroStackTop : styles.playerHeroStackBottom
      }`}
    >
      <span>{player.name}</span>
      {legend ? (
        <CardTile card={legend} orientation={orientation} size="hero" />
      ) : (
        <HeroPlaceholder label="Legend" />
      )}
      {champion ? (
        <CardTile card={champion} orientation={orientation} size="hero" />
      ) : (
        <HeroPlaceholder label="Champion" />
      )}
    </aside>
  );
}

function PlayerPileStack({
  onOpenDiscard,
  orientation,
  player,
}: {
  onOpenDiscard: () => void;
  orientation: "top" | "bottom";
  player: ReplayPlayerState;
}) {
  const deck = deckCards(player);
  const discard = discardCards(player);
  const deckPile = <CardPile count={deck.length} kind="deck" label="Deck" orientation={orientation} />;
  const discardPile = (
    <CardPile
      card={discard.at(-1)}
      count={discard.length}
      kind="discard"
      label="Trash"
      onClick={onOpenDiscard}
      orientation={orientation}
    />
  );
  return (
    <aside
      aria-label={`${player.name} deck and trash`}
      className={`${styles.playerPileStack} ${
        orientation === "top" ? styles.playerPileStackTop : styles.playerPileStackBottom
      }`}
    >
      {orientation === "top" ? deckPile : discardPile}
      {orientation === "top" ? discardPile : deckPile}
    </aside>
  );
}

function PlayerHalf({
  inspectedCard,
  onCardHover,
  onCardSelect,
  orientation,
  player,
}: {
  inspectedCard: ReplayCardState | null;
  onCardHover: (card: ReplayCardState | null) => void;
  onCardSelect: (card: ReplayCardState) => void;
  orientation: "top" | "bottom";
  player: ReplayPlayerState;
}) {
  const hand = handCards(player);
  const zones = boardZones(player);
  const handRow = (
    <div
      className={`${styles.handRow} ${orientation === "top" ? styles.handRowTop : styles.handRowBottom}`}
      data-hand-row
    >
      <span className={styles.zoneLabel}>Hand · {hand.length}</span>
      <div className={styles.handCards} data-hand-cards>
        {hand.slice(0, 12).map((card, index) => (
          <CardTile
            card={card}
            forceFaceDown={orientation === "top"}
            inspected={inspectedCard?.id === card.id}
            key={card.id}
            onHover={onCardHover}
            onSelect={onCardSelect}
            orientation={orientation}
            size="hand"
            style={{ "--card-index": index, "--card-count": hand.length } as CSSProperties}
          />
        ))}
        {!hand.length ? <span className={styles.emptyZone}>No cards</span> : null}
      </div>
    </div>
  );
  const handAndRuneRow = (
    <div className={styles.handAndRuneRow} data-hand-layout={orientation}>
      {handRow}
      <RuneRail
        inspectedCard={inspectedCard}
        onCardHover={onCardHover}
        onCardSelect={onCardSelect}
        orientation={orientation}
        player={player}
      />
    </div>
  );

  return (
    <div
      className={`${styles.playerHalf} ${orientation === "top" ? styles.playerHalfTop : styles.playerHalfBottom}`}
      data-player-id={player.id}
    >
      {orientation === "top" ? handAndRuneRow : null}
      <div className={styles.boardLine}>
        <div className={styles.boardLanes}>
          {zones.map((zone, zoneIndex) => (
            <div className={styles.boardLane} key={zone.key}>
              <span className={styles.zoneLabel}>{laneLabel(zone.label, zoneIndex)}</span>
              <div className={styles.laneCards}>
                {zone.cards.slice(0, 9).map((card) => (
                  <CardTile
                    card={card}
                    inspected={inspectedCard?.id === card.id}
                    key={card.id}
                    onHover={onCardHover}
                    onSelect={onCardSelect}
                    orientation={orientation}
                    size="board"
                  />
                ))}
                {!zone.cards.length ? <span className={styles.laneGuide}>Place cards</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
      {orientation === "bottom" ? handAndRuneRow : null}
    </div>
  );
}

function RuneRail({
  inspectedCard,
  onCardHover,
  onCardSelect,
  orientation,
  player,
}: {
  inspectedCard: ReplayCardState | null;
  onCardHover: (card: ReplayCardState | null) => void;
  onCardSelect: (card: ReplayCardState) => void;
  orientation: "top" | "bottom";
  player: ReplayPlayerState;
}) {
  const runeArea = zoneCards(player, ["runeArea"]);
  const runeDeck = zoneCards(player, ["runeDeck"]);
  const capacity = Math.max(12, runeArea.length + runeDeck.length);
  const emptySlots = Math.max(0, capacity - runeArea.length);

  return (
    <div
      aria-label={`${player.name} rune cards`}
      className={`${styles.runeRail} ${orientation === "top" ? styles.runeRailTop : styles.runeRailBottom}`}
      data-rune-rail
    >
      <div
        aria-label={`${player.name} rune deck, ${runeDeck.length} cards`}
        className={styles.runeDeck}
        data-rune-deck-count={runeDeck.length}
        role="img"
      >
        <span className={styles.runeDeckStack} aria-hidden="true" />
        <span className={`${styles.runeDeckFace} ${styles.cardBack}`} aria-hidden="true">
          <span className={styles.cardBackMark}>R</span>
        </span>
        <b>{runeDeck.length}</b>
      </div>
      <div className={styles.runeSlots}>
        {runeArea.map((card) => (
          <CardTile
            card={card}
            inspected={inspectedCard?.id === card.id}
            key={card.id}
            onHover={onCardHover}
            onSelect={onCardSelect}
            orientation={orientation}
            size="rune"
          />
        ))}
        {Array.from({ length: emptySlots }, (_, index) => (
          <span aria-hidden="true" className={styles.runeSlot} data-rune-slot key={`rune-slot-${index}`} />
        ))}
      </div>
    </div>
  );
}

function CardPile({
  card,
  count,
  kind,
  label,
  onClick,
  orientation,
}: {
  card?: ReplayCardState;
  count: number;
  kind: "deck" | "discard";
  label: string;
  onClick?: () => void;
  orientation: "top" | "bottom";
}) {
  const image = cardImageUrl(card);
  const content = (
    <>
      <span className={styles.pileStack} aria-hidden="true" />
      <span
        className={`${styles.pileFace} ${kind === "deck" || !image ? styles.cardBack : ""} ${
          orientation === "top" ? styles.opponentFacing : ""
        }`}
        style={image ? { backgroundImage: `url("${escapeCssUrl(image)}")` } : undefined}
      />
      <b>{count}</b>
      <small>{label}</small>
    </>
  );
  return onClick ? (
    <button
      aria-label={`Open ${label.toLowerCase()}, ${count} cards`}
      className={styles.cardPile}
      data-open-discard
      onClick={onClick}
      type="button"
    >
      {content}
    </button>
  ) : (
    <div aria-label={`${label}, ${count} cards`} className={styles.cardPile} role="img">
      {content}
    </div>
  );
}

function CardTile({
  card,
  forceFaceDown = false,
  inspected = false,
  onHover,
  onSelect,
  orientation = "bottom",
  size = "board",
  style,
}: {
  card: ReplayCardState;
  forceFaceDown?: boolean;
  inspected?: boolean;
  onHover?: (card: ReplayCardState | null) => void;
  onSelect?: (card: ReplayCardState) => void;
  orientation?: "top" | "bottom";
  size?: "board" | "hand" | "scene" | "discard" | "hero" | "rune";
  style?: CSSProperties;
}) {
  const [failedImageKey, setFailedImageKey] = useState("");
  const image = cardImageUrl(card);
  const imageKey = `${card.id}|${image ?? ""}`;
  const imageFailed = failedImageKey === imageKey;
  const hidden = forceFaceDown || card.isPlaceholder;
  const duplicate = !hidden && isDuplicateCard(card);
  return (
    <button
      aria-label={hidden ? "Hidden card" : cardName(card)}
      className={`${styles.cardMotion} ${styles[`cardSize${capitalize(size)}`]} ${
        inspected ? styles.inspectedCard : ""
      }`}
      data-card-code={card.cardCode}
      data-card-duplicate={duplicate ? "true" : undefined}
      data-card-exhausted={card.exhausted ? "true" : "false"}
      data-card-id={card.id}
      data-card-size={size}
      data-rune-card={size === "rune" ? "true" : undefined}
      onBlur={() => onHover?.(null)}
      onClick={() => { if (!hidden) onSelect?.(card); }}
      onFocus={() => onHover?.(hidden ? null : card)}
      onMouseEnter={() => onHover?.(hidden ? null : card)}
      onMouseLeave={() => onHover?.(null)}
      style={style}
      type="button"
    >
      <span
        className={`${styles.cardFace} ${hidden || imageFailed || !image ? styles.cardBack : ""} ${
          orientation === "top" ? styles.opponentFacing : ""
        } ${card.exhausted ? styles.exhaustedCard : ""}`}
      >
        {!hidden && image && !imageFailed ? (
          // Card art is supplied by the canonical public payload, never by raw capture data.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" draggable={false} onError={() => setFailedImageKey(imageKey)} src={image} />
        ) : null}
        {!hidden && (imageFailed || !image) ? <span className={styles.cardFallback}>{cardName(card)}</span> : null}
        {hidden ? <span className={styles.cardBackMark}>R</span> : null}
        {!hidden && looseNumber(card.fields.cost) !== undefined ? (
          <b className={styles.cardCost}>{looseNumber(card.fields.cost)}</b>
        ) : null}
      </span>
      {duplicate ? <span className={styles.duplicateTag}>Duplicate</span> : null}
    </button>
  );
}

function CentralArena({
  battlefields,
  chain,
  onCardHover,
  onCardSelect,
  players,
}: {
  battlefields: Array<ReplayCardState | undefined>;
  chain: ReplayChainEntry[];
  onCardHover: (card: ReplayCardState | null) => void;
  onCardSelect: (card: ReplayCardState) => void;
  players: ReplayPlayerPair;
}) {
  const preferredTopZone = battlefieldZoneForPlayer(players.top, "battlefieldB");
  const bottomZone = battlefieldZoneForPlayer(
    players.bottom,
    preferredTopZone === "battlefieldA" ? "battlefieldB" : "battlefieldA",
  );
  const topZone = preferredTopZone === bottomZone
    ? (bottomZone === "battlefieldA" ? "battlefieldB" : "battlefieldA")
    : preferredTopZone;
  const lanes = [
    {
      battlefield: battlefields[0],
      flipped: false,
      key: bottomZone,
      label: "Battlefield",
      owner: players.bottom,
    },
    {
      battlefield: battlefields[1],
      flipped: true,
      key: topZone,
      label: "Opponent's battlefield",
      owner: players.top,
    },
  ];
  return (
    <div className={styles.centralArena}>
      {lanes.map((lane) => (
        <section
          className={styles.battlefieldZone}
          data-battlefield-name={lane.battlefield ? cardName(lane.battlefield) : undefined}
          data-battlefield-owner={lane.owner.id}
          data-battlefield-zone={lane.key}
          key={lane.key}
        >
            <span className={styles.centralLabel}>{lane.label}</span>
            <BattlefieldUnitRow
              cards={zoneCards(players.top, [lane.key])}
              onCardHover={onCardHover}
              onCardSelect={onCardSelect}
              orientation="top"
            />
            <div className={styles.battlefieldCardDock}>
              {lane.battlefield ? (
                <BattlefieldTile
                  card={lane.battlefield}
                  flipped={lane.flipped}
                  onHover={onCardHover}
                  onSelect={onCardSelect}
                  owner={lane.owner.name}
                />
              ) : (
                <div className={styles.emptyBattlefield}>
                  <Icon name="battlefield" />
                  <span>Battlefield</span>
                </div>
              )}
            </div>
            <BattlefieldUnitRow
              cards={zoneCards(players.bottom, [lane.key])}
              onCardHover={onCardHover}
              onCardSelect={onCardSelect}
              orientation="bottom"
            />
        </section>
      ))}
      {chain.length ? (
        <div className={styles.chainLane}>
          <span className={styles.centralLabel}>Chain</span>
          <div className={styles.chainEntries}>
            {chain.slice(-5).map((entry, index) => {
              const card = cardFromChain(entry, index);
              return card ? (
                <CardTile
                  card={card}
                  key={entry.id}
                  onHover={onCardHover}
                  onSelect={onCardSelect}
                  size="hand"
                />
              ) : (
                <span className={styles.chainToken} key={entry.id}>{index + 1}</span>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BattlefieldUnitRow({
  cards,
  onCardHover,
  onCardSelect,
  orientation,
}: {
  cards: ReplayCardState[];
  onCardHover: (card: ReplayCardState | null) => void;
  onCardSelect: (card: ReplayCardState) => void;
  orientation: "top" | "bottom";
}) {
  return (
    <div
      className={`${styles.battlefieldUnitRow} ${
        orientation === "top" ? styles.battlefieldUnitRowTop : styles.battlefieldUnitRowBottom
      }`}
      data-battlefield-unit-row={orientation}
    >
      {cards.slice(0, 7).map((card) => (
        <CardTile
          card={card}
          key={card.id}
          onHover={onCardHover}
          onSelect={onCardSelect}
          orientation={orientation}
          size="board"
        />
      ))}
      {!cards.length ? <span className={styles.laneGuide}>Open lane</span> : null}
    </div>
  );
}

function BattlefieldTile({
  card,
  flipped = false,
  onHover,
  onSelect,
  owner,
}: {
  card: ReplayCardState;
  flipped?: boolean;
  onHover: (card: ReplayCardState | null) => void;
  onSelect: (card: ReplayCardState) => void;
  owner: string;
}) {
  const [failedImageKey, setFailedImageKey] = useState("");
  const image = cardImageUrl(card);
  const imageKey = `${card.id}|${image ?? ""}`;
  const imageFailed = failedImageKey === imageKey;
  return (
    <button
      className={styles.battlefieldTile}
      data-battlefield-card
      data-card-code={card.cardCode}
      data-card-id={card.id}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(card)}
      onFocus={() => onHover(card)}
      onMouseEnter={() => onHover(card)}
      onMouseLeave={() => onHover(null)}
      type="button"
    >
      {image && !imageFailed ? (
        // Battlefield scans are portrait files for physically landscape cards.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className={flipped ? styles.battlefieldImageFlipped : undefined}
          draggable={false}
          onError={() => setFailedImageKey(imageKey)}
          src={image}
        />
      ) : <Icon name="battlefield" />}
      <span>{cardName(card)}</span>
      <small>{owner}</small>
    </button>
  );
}

type TargetArrow = { id: string; fromX: number; fromY: number; toX: number; toY: number };

function TargetArrowLayer({ arrows }: { arrows: TargetArrow[] }) {
  if (!arrows.length) return null;
  return (
    <svg aria-hidden="true" className={styles.targetArrows} viewBox="0 0 1590 962">
      <defs>
        <marker id="replay-arrow-head" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
          <path d="M0 0 L8 4 L0 8 Z" fill="currentColor" />
        </marker>
      </defs>
      {arrows.map((arrow) => {
        const curve = Math.max(24, Math.abs(arrow.toX - arrow.fromX) * 0.18);
        return (
          <path
            d={`M ${arrow.fromX} ${arrow.fromY} C ${arrow.fromX} ${arrow.fromY - curve}, ${arrow.toX} ${arrow.toY - curve}, ${arrow.toX} ${arrow.toY}`}
            key={arrow.id}
            markerEnd="url(#replay-arrow-head)"
          />
        );
      })}
    </svg>
  );
}

function SceneOverlay({
  battlefields,
  currentMs,
  playing,
  players,
  replay,
  scene,
  state,
}: {
  battlefields: Array<ReplayCardState | undefined>;
  currentMs: number;
  playing: boolean;
  players: ReplayPlayerPair;
  replay: CanonicalReplayV2;
  scene: Exclude<ReplaySceneKind, null>;
  state: ReplayState;
}) {
  const game = gameForState(replay, state);
  const nextGame = game
    ? replay.series.games.find((candidate) => candidate.ordinal === game.ordinal + 1)
    : replay.series.games[0];
  const firstPlayer = [players.bottom, players.top].find((player) => player.id === state.room.firstPlayerId);
  const winnerId = game?.result?.winnerPlayerId;
  const winner = [players.bottom, players.top].find((player) => player.id === winnerId);

  let content: ReactNode;
  switch (scene) {
    case "matchup":
      content = (
        <div className={styles.matchupScene}>
          <ScenePlayerHero player={players.bottom} />
          <div className={styles.versusMark}><span>VS</span><small>Game {game?.gameNumber ?? 1}</small></div>
          <ScenePlayerHero player={players.top} reverse />
        </div>
      );
      break;
    case "battlefields":
      content = (
        <div className={styles.sceneColumn}>
          <SceneHeading eyebrow={`Game ${game?.gameNumber ?? 1}`} title="Selected battlefields" />
          <div className={styles.sceneBattlefields}>
            {battlefields.slice(0, 2).map((card, index) => card ? (
              <div key={`${index ? players.top.id : players.bottom.id}-${card.id}`}>
                <BattlefieldTile
                  card={card}
                  flipped={index === 1}
                  onHover={() => undefined}
                  onSelect={() => undefined}
                  owner={index ? players.top.name : players.bottom.name}
                />
              </div>
            ) : null)}
            {!battlefields.some(Boolean) ? <p>Battlefield choices are being revealed.</p> : null}
          </div>
        </div>
      );
      break;
    case "initiative":
      content = (
        <div className={styles.sceneColumn}>
          <SceneHeading eyebrow={`Game ${game?.gameNumber ?? 1}`} title="Initiative" />
          <div className={styles.initiativeRolls}>
            <InitiativeTile player={players.bottom} roll={initiativeRoll(players.bottom, state)} />
            <div className={styles.firstPlayerBadge}>
              <Icon name="spark" />
              <span>{firstPlayer ? `${firstPlayer.name} goes first` : "First player resolving"}</span>
            </div>
            <InitiativeTile player={players.top} roll={initiativeRoll(players.top, state)} />
          </div>
        </div>
      );
      break;
    case "mulligan":
    case "opening":
      content = (
        <div className={styles.sceneColumn}>
          <SceneHeading
            eyebrow={`Game ${game?.gameNumber ?? 1}`}
            title={scene === "mulligan" ? "Mulligan" : "Opening hands"}
          />
          <div className={styles.openingHands}>
            <SceneHand faceDown label={players.top.name} player={players.top} />
            <div className={styles.handDivider}>{scene === "mulligan" ? "Replace · Redraw · Keep" : "Ready"}</div>
            <SceneHand label={players.bottom.name} player={players.bottom} />
          </div>
        </div>
      );
      break;
    case "game_start":
      content = (
        <div className={styles.gameTransition}>
          <small>{firstPlayer ? `${firstPlayer.name} has initiative` : "Opening complete"}</small>
          <strong>GAME {game?.gameNumber ?? 1}</strong>
          <span>Begin</span>
        </div>
      );
      break;
    case "sideboarding":
      content = (
        <div className={styles.sceneColumn}>
          <SceneHeading eyebrow="Between games" title="Sideboarding" />
          <div className={styles.sideboardSummary}>
            <span><b>{players.bottom.name}</b>{sideboardCards(players.bottom).length} cards available</span>
            <Icon name="swap" />
            <span><b>{players.top.name}</b>{sideboardCards(players.top).length} cards available</span>
          </div>
        </div>
      );
      break;
    case "game_transition":
      content = (
        <div className={styles.gameTransition}>
          <small>{winner ? `${winner.name} wins Game ${game?.gameNumber ?? ""}` : "Game complete"}</small>
          <strong>GAME {nextGame?.gameNumber ?? (game?.gameNumber ?? 1) + 1}</strong>
          <span>Battlefields · Initiative · Opening hands</span>
        </div>
      );
      break;
    case "game_end":
      content = (
        <div className={styles.gameTransition}>
          <small>{state.phase === "series_end" ? "Series complete" : `Game ${game?.gameNumber ?? ""} complete`}</small>
          <strong>{winner ? `${winner.name} wins` : "Result recorded"}</strong>
          <span>{formatClock(currentMs)}</span>
        </div>
      );
      break;
  }

  return (
    <div className={styles.sceneOverlay} data-scene={scene}>
      <div className={styles.sceneShade} data-scene-shade />
      <div className={styles.sceneContent} data-scene-content key={scene}>{content}</div>
      <div className={styles.scenePlaybackState}>
        <Icon name={playing ? "play" : "pause"} />
        {playing ? "Playing" : "Paused"}
      </div>
    </div>
  );
}

function SceneHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className={styles.sceneHeading}>
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      <i />
    </header>
  );
}

function ScenePlayerHero({ player, reverse = false }: { player: ReplayPlayerState; reverse?: boolean }) {
  const legend = legendCard(player);
  const champion = championCard(player);
  return (
    <div className={`${styles.scenePlayerHero} ${reverse ? styles.scenePlayerHeroReverse : ""}`}>
      <div className={styles.heroCards}>
        {legend ? <CardTile card={legend} size="scene" /> : <HeroPlaceholder label="Legend" />}
        {champion ? <CardTile card={champion} size="scene" /> : <HeroPlaceholder label="Champion" />}
      </div>
      <span>{reverse ? "Opponent" : "Capture player"}</span>
      <h2>{player.name}</h2>
      <p>{legend ? cardName(legend) : "Unknown legend"}</p>
    </div>
  );
}

function HeroPlaceholder({ label }: { label: string }) {
  return <div className={styles.heroPlaceholder}><Icon name="card" /><span>{label}</span></div>;
}

function InitiativeTile({ player, roll }: { player: ReplayPlayerState; roll: number | undefined }) {
  return (
    <div className={styles.initiativeTile}>
      <MiniPortrait card={legendCard(player)} fallback={player.name} />
      <span>{player.name}</span>
      <b>{roll ?? "—"}</b>
      <small>d20</small>
    </div>
  );
}

function SceneHand({ faceDown = false, label, player }: { faceDown?: boolean; label: string; player: ReplayPlayerState }) {
  const cards = handCards(player).slice(0, 8);
  return (
    <div className={styles.sceneHand}>
      <span>{label} · {cards.length} cards</span>
      <div>
        {cards.map((card, index) => (
          <CardTile
            card={card}
            forceFaceDown={faceDown}
            key={card.id}
            size="scene"
            style={{ "--deal-delay": `${index * 70}ms` } as CSSProperties}
          />
        ))}
        {!cards.length ? <em>Hand data is not available at this frame.</em> : null}
      </div>
    </div>
  );
}

function InspectorRail({
  activityTab,
  currentEventLabel,
  currentMs,
  embed,
  inspectedCard,
  onActivityTab,
  onCapture,
  onFullscreen,
  onHelp,
  onShare,
  replay,
  state,
}: {
  activityTab: "chat" | "log";
  currentEventLabel: string;
  currentMs: number;
  embed: boolean;
  inspectedCard: ReplayCardState | null;
  onActivityTab: (tab: "chat" | "log") => void;
  onCapture: () => void;
  onFullscreen: () => void;
  onHelp: () => void;
  onShare: () => void;
  replay: CanonicalReplayV2;
  state: ReplayState;
}) {
  const activityRef = useRef<HTMLDivElement>(null);
  const cardImage = cardImageUrl(inspectedCard ?? undefined);
  const inspectedBattlefield = isBattlefieldCard(inspectedCard ?? undefined);
  const fields = inspectedCard ? visibleCardFields(inspectedCard) : [];
  const activityLength = activityTab === "chat" ? state.chat.length : state.log.length;
  useEffect(() => {
    activityRef.current?.scrollTo({ top: activityRef.current.scrollHeight, behavior: "smooth" });
  }, [activityLength, activityTab]);

  return (
    <aside className={styles.inspectorRail} aria-label="Replay details">
      <div className={styles.railHeader}>
        <div className={styles.railBrand}>
          <span className={styles.brandMark}>R</span>
          <div><b>RiftLite</b><small>Replay</small></div>
        </div>
        <div className={styles.railActions}>
          <IconButton label="Capture replay frame" name="camera" onClick={onCapture} />
          <IconButton label="Share replay" name="share" onClick={onShare} />
          <IconButton label="Fullscreen" name="fullscreen" onClick={onFullscreen} />
          <IconButton label="Keyboard shortcuts" name="help" onClick={onHelp} />
        </div>
      </div>
      <div className={styles.replayMeta}>
        <span>{embed ? "Desktop embed" : "Web replay"}</span>
        <span>Game {state.room.gameNumber || state.gameOrdinal || 1}</span>
        <span>Turn {state.room.turnNumber ?? "—"}</span>
      </div>

      <section className={styles.cardInspector} aria-live="polite" data-card-inspector>
        <div className={`${styles.inspectorArt} ${!cardImage ? styles.inspectorArtEmpty : ""}`}>
          {cardImage ? (
            <span
              className={`${styles.inspectorArtFrame} ${
                inspectedBattlefield ? styles.inspectorArtFrameBattlefield : ""
              }`}
              data-inspector-art-frame
              data-inspector-battlefield={inspectedBattlefield ? "true" : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt={inspectedCard ? cardName(inspectedCard) : ""} src={cardImage} />
            </span>
          ) : (
            <><Icon name="card" /><span>Hover a card</span></>
          )}
        </div>
        <div className={styles.inspectorDetails}>
          <span className={styles.inspectorEyebrow}>Current card</span>
          <h2>{inspectedCard ? cardName(inspectedCard) : "No card selected"}</h2>
          {inspectedCard?.cardCode ? <code>{inspectedCard.cardCode}</code> : null}
          {fields.length ? (
            <dl>
              {fields.map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          ) : (
            <p>{inspectedCard ? "No additional public card details at this frame." : "Hover or focus a card on the board to inspect it."}</p>
          )}
        </div>
      </section>

      <section className={styles.activityPanel} data-activity-panel>
        <header>
          <div className={styles.activityTabs} role="tablist" aria-label="Replay activity">
            <button
              aria-selected={activityTab === "chat"}
              className={activityTab === "chat" ? styles.activeActivityTab : ""}
              onClick={() => onActivityTab("chat")}
              role="tab"
              type="button"
            >
              Chat <span>{state.chat.length}</span>
            </button>
            <button
              aria-selected={activityTab === "log"}
              className={activityTab === "log" ? styles.activeActivityTab : ""}
              onClick={() => onActivityTab("log")}
              role="tab"
              type="button"
            >
              Match log <span>{state.log.length}</span>
            </button>
          </div>
        </header>
        <div className={styles.activityList} ref={activityRef} role="tabpanel">
          {activityTab === "chat"
            ? state.chat.slice(-120).map((entry) => (
                <article className={styles.chatEntry} key={entry.id}>
                  <span>{relativeReplayTime(replay, entry.at)}</span>
                  <div><b>{entry.author || "Player"}</b><p>{entry.text}</p></div>
                </article>
              ))
            : state.log.slice(-160).map((entry) => (
                <article className={styles.logEntry} key={entry.id}>
                  <span>{relativeReplayTime(replay, entry.at)}</span>
                  <p>{entry.text}</p>
                </article>
              ))}
          {activityLength === 0 ? (
            <div className={styles.emptyActivity}><Icon name={activityTab === "chat" ? "chat" : "list"} /><span>No {activityTab} entries yet</span></div>
          ) : null}
        </div>
      </section>
      <div className={styles.nowPlaying}>
        <span className={styles.nowPulse} />
        <div><small>{formatClock(currentMs)}</small><b>{currentEventLabel}</b></div>
      </div>
    </aside>
  );
}

function TransportControls({
  currentMs,
  durationMs,
  eventIndex,
  onChangeSpeed,
  onFrame,
  onGame,
  onHelp,
  onPresentationFrame,
  onSeek,
  onStepAction,
  onStepGame,
  onStepTurn,
  onToggleMore,
  onTogglePlayback,
  playing,
  presentationFrame,
  replay,
  showMore,
  speed,
  state,
  turns,
}: {
  currentMs: number;
  durationMs: number;
  eventIndex: number;
  onChangeSpeed: (speed: number) => void;
  onFrame: (index: number) => void;
  onGame: (gameIndex: number) => void;
  onHelp: () => void;
  onPresentationFrame: (stageIndex: number) => void;
  onSeek: (atMs: number, options?: { immediate?: boolean; eventIndex?: number }) => void;
  onStepAction: (direction: -1 | 1) => void;
  onStepGame: (direction: -1 | 1) => void;
  onStepTurn: (direction: -1 | 1) => void;
  onToggleMore: () => void;
  onTogglePlayback: () => void;
  playing: boolean;
  presentationFrame: { index: number; label: string; total: number } | null;
  replay: CanonicalReplayV2;
  showMore: boolean;
  speed: number;
  state: ReplayState;
  turns: ReplayTurnMarker[];
}) {
  const currentGame = gameForState(replay, state);
  const currentTurnIndex = lastTurnIndexAtTime(turns, currentMs);
  return (
    <footer className={styles.transport} aria-label="Replay controls">
      {showMore ? (
        <div className={styles.morePanel} data-control="more-panel">
          <section>
            <header>
              <span>{presentationFrame ? "Opening frame" : "Frame"}</span>
              <b>
                {presentationFrame
                  ? `${presentationFrame.index + 1} / ${presentationFrame.total}`
                  : `${Math.max(0, eventIndex + 1)} / ${replay.events.length}`}
              </b>
            </header>
            <input
              aria-label={presentationFrame ? "Opening sequence frame" : "Replay frame"}
              data-control="frame-navigator"
              max={presentationFrame ? Math.max(0, presentationFrame.total - 1) : Math.max(0, replay.events.length - 1)}
              min={0}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (presentationFrame) onPresentationFrame(value);
                else onFrame(value);
              }}
              step={1}
              type="range"
              value={presentationFrame ? presentationFrame.index : Math.max(0, eventIndex)}
            />
            {presentationFrame ? <small className={styles.presentationFrameLabel}>{presentationFrame.label}</small> : null}
          </section>
          <section>
            <header><span>Game</span><b>{currentGame?.gameNumber ?? 1}</b></header>
            <div className={styles.navigatorButtons}>
              <ControlButton label="Previous game" name="previous" onClick={() => onStepGame(-1)} small />
              {replay.series.games.map((game, gameIndex) => (
                <button
                  aria-current={currentGame?.id === game.id ? "true" : undefined}
                  className={currentGame?.id === game.id ? styles.activeNavigatorButton : ""}
                  key={game.id}
                  onClick={() => onGame(gameIndex)}
                  type="button"
                >G{game.gameNumber}</button>
              ))}
              <ControlButton label="Next game" name="next" onClick={() => onStepGame(1)} small />
            </div>
          </section>
          <section>
            <header><span>Turn</span><b>{currentTurnIndex >= 0 ? turns[currentTurnIndex]?.turn : state.room.turnNumber ?? "—"}</b></header>
            <div className={styles.navigatorButtons}>
              <ControlButton label="Previous turn" name="previous" onClick={() => onStepTurn(-1)} small />
              <span>{turns.length ? `${currentTurnIndex + 1} of ${turns.length}` : "No turn markers"}</span>
              <ControlButton label="Next turn" name="next" onClick={() => onStepTurn(1)} small />
            </div>
          </section>
          <section>
            <header><span>Speed</span><b>{speed}×</b></header>
            <div className={styles.speedButtons}>
              {PLAYBACK_SPEEDS.map((value) => (
                <button
                  aria-pressed={speed === value}
                  className={speed === value ? styles.activeSpeedButton : ""}
                  data-control={`speed-${value}`}
                  key={value}
                  onClick={() => onChangeSpeed(value)}
                  type="button"
                >{value}×</button>
              ))}
              <button onClick={onHelp} type="button"><Icon name="keyboard" /> Shortcuts</button>
            </div>
          </section>
        </div>
      ) : null}
      <input
        aria-label="Replay progress"
        className={styles.progressRange}
        data-control="timeline"
        max={durationMs}
        min={0}
        onChange={(event) => onSeek(Number(event.currentTarget.value), { immediate: Number(event.currentTarget.value) < currentMs })}
        step={50}
        style={{ "--progress": `${(currentMs / durationMs) * 100}%` } as CSSProperties}
        type="range"
        value={Math.min(durationMs, currentMs)}
      />
      <div className={styles.transportInner}>
        <div className={styles.transportGroup}>
          <ControlButton dataControl="start" label="Replay beginning" name="skipStart" onClick={() => onSeek(0, { immediate: true })} />
          <ControlButton dataControl="previous-action" label="Previous action" name="previous" onClick={() => onStepAction(-1)} />
          <ControlButton dataControl="rewind-15" label="Rewind 15 seconds" name="rewind" onClick={() => onSeek(currentMs - 15_000, { immediate: true })} text="15" />
        </div>
        <button
          aria-label={playing ? "Pause replay" : "Play replay"}
          className={styles.playButton}
          data-control="play-pause"
          onClick={onTogglePlayback}
          type="button"
        >
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <div className={styles.transportGroup}>
          <ControlButton dataControl="forward-15" label="Forward 15 seconds" name="forward" onClick={() => onSeek(currentMs + 15_000)} text="15" />
          <ControlButton dataControl="next-action" label="Next action" name="next" onClick={() => onStepAction(1)} />
          <ControlButton dataControl="end" label="Replay end" name="skipEnd" onClick={() => onSeek(durationMs)} />
        </div>
        <div className={styles.timeReadout}>
          <b>{formatClock(currentMs)}</b><span>/ {formatClock(durationMs)}</span>
        </div>
        <button className={styles.speedControl} data-control="speed" onClick={() => onChangeSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1)} type="button">
          {speed}×
        </button>
        <button
          aria-expanded={showMore}
          className={`${styles.moreButton} ${showMore ? styles.moreButtonActive : ""}`}
          data-control="more"
          onClick={onToggleMore}
          type="button"
        >
          <Icon name="sliders" /> {showMore ? "Less" : "More"}
        </button>
      </div>
    </footer>
  );
}

function DiscardOverlay({
  cards,
  onCardHover,
  onCardSelect,
  onClose,
  playerName,
}: {
  cards: ReplayCardState[];
  onCardHover: (card: ReplayCardState | null) => void;
  onCardSelect: (card: ReplayCardState) => void;
  onClose: () => void;
  playerName: string;
}) {
  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={onClose}>
      <section
        aria-label={`${playerName} trash`}
        aria-modal="true"
        className={styles.discardModal}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div><span>Public zone</span><h2>{playerName} · Trash</h2><p>{cards.length} cards at this frame</p></div>
          <IconButton label="Close trash" name="close" onClick={onClose} />
        </header>
        <div className={styles.discardGrid}>
          {cards.map((card) => (
            <CardTile card={card} key={card.id} onHover={onCardHover} onSelect={onCardSelect} size="discard" />
          ))}
          {!cards.length ? <div className={styles.emptyDiscard}><Icon name="trash" /><span>Trash is empty</span></div> : null}
        </div>
      </section>
    </div>
  );
}

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    ["Space", "Play or pause"],
    ["← / →", "Previous or next action"],
    ["Shift + ← / →", "Previous or next game"],
    ["Alt + ← / →", "Previous or next turn"],
    ["1 / 2 / 4", "Set playback speed"],
    ["M", "Show or hide More controls"],
    ["?", "Show this shortcut guide"],
    ["Esc", "Close the active panel"],
  ];
  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={onClose}>
      <section className={styles.helpModal} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <header><div><span>Replay controls</span><h2>Keyboard shortcuts</h2></div><IconButton label="Close shortcuts" name="close" onClick={onClose} /></header>
        <div className={styles.shortcutGrid}>
          {shortcuts.map(([keys, action]) => <div key={keys}><kbd>{keys}</kbd><span>{action}</span></div>)}
        </div>
        <p>Transport buttons rewind and fast-forward by a fixed 15 seconds. Backward seeks reconstruct instantly; forward seeks wait for the active animation to settle.</p>
      </section>
    </div>
  );
}

function StatusScreen({
  actionLabel,
  busy = false,
  detail,
  onAction,
  title,
}: {
  actionLabel?: string;
  busy?: boolean;
  detail: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <div className={styles.statusScreen}>
      <div className={`${styles.statusMark} ${busy ? styles.statusMarkBusy : ""}`}>R</div>
      <span>RiftLite Replay</span>
      <h1>{title}</h1>
      <p>{detail}</p>
      {actionLabel && onAction ? <button onClick={onAction} type="button">{actionLabel}</button> : null}
    </div>
  );
}

function ControlButton({
  dataControl,
  label,
  name,
  onClick,
  small = false,
  text,
}: {
  dataControl?: string;
  label: string;
  name: IconName;
  onClick: () => void;
  small?: boolean;
  text?: string;
}) {
  return (
    <button
      aria-label={label}
      className={`${styles.controlButton} ${small ? styles.controlButtonSmall : ""}`}
      data-control={dataControl}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon name={name} />
      {text ? <span>{text}</span> : null}
    </button>
  );
}

function IconButton({ label, name, onClick }: { label: string; name: IconName; onClick: () => void }) {
  return (
    <button aria-label={label} className={styles.iconButton} onClick={onClick} title={label} type="button">
      <Icon name={name} />
    </button>
  );
}

function MiniPortrait({ card, fallback }: { card?: ReplayCardState; fallback: string }) {
  const image = cardImageUrl(card);
  return (
    <span className={styles.miniPortrait}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" src={image} />
      ) : fallback.slice(0, 1).toUpperCase()}
    </span>
  );
}

function usePlayerScale() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const bounds = host.getBoundingClientRect();
      setScale(Math.max(0.1, Math.min(bounds.width / DESIGN_WIDTH, bounds.height / DESIGN_HEIGHT)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  return { hostRef, scale };
}

function useCardMotion(
  rootRef: { current: HTMLDivElement | null },
  eventIndex: number,
  suppressMotion: boolean,
) {
  const previous = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const rootBounds = root.getBoundingClientRect();
    const scale = rootBounds.width / Math.max(1, root.offsetWidth);
    const next = new Map<string, { x: number; y: number }>();
    const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-card-id]"));

    for (const element of elements) {
      const id = element.dataset.cardId;
      if (!id || next.has(id)) continue;
      const bounds = element.getBoundingClientRect();
      const position = {
        x: (bounds.left + bounds.width / 2 - rootBounds.left) / scale,
        y: (bounds.top + bounds.height / 2 - rootBounds.top) / scale,
      };
      next.set(id, position);
      if (suppressMotion) continue;
      const old = previous.current.get(id);
      if (old && (Math.abs(old.x - position.x) > 1 || Math.abs(old.y - position.y) > 1)) {
        element.animate(
          [
            { transform: `translate(${old.x - position.x}px, ${old.y - position.y}px) scale(1.045)`, filter: "brightness(1.2)", zIndex: 40 },
            { transform: "translate(0, 0) scale(1)", filter: "brightness(1)", zIndex: 1 },
          ],
          { duration: ACTION_ANIMATION_MS, easing: "cubic-bezier(.16,1,.3,1)" },
        );
      } else if (!old) {
        element.animate(
          [
            { opacity: 0, transform: "translateY(-20px) scale(.9)" },
            { opacity: 1, transform: "translateY(0) scale(1)" },
          ],
          { duration: 340, easing: "cubic-bezier(.16,1,.3,1)" },
        );
      }
    }
    previous.current = next;
  }, [eventIndex, rootRef, suppressMotion]);
}

function useTargetArrows(
  rootRef: { current: HTMLDivElement | null },
  chain: ReplayChainEntry[],
  eventIndex: number,
) {
  const [arrows, setArrows] = useState<TargetArrow[]>([]);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      const rootBounds = root.getBoundingClientRect();
      const scale = rootBounds.width / Math.max(1, root.offsetWidth);
      const cardElements = Array.from(root.querySelectorAll<HTMLElement>("[data-card-id]"));
      const elementFor = (id: string) => cardElements.find((element) => element.dataset.cardId === id);
      const next: TargetArrow[] = [];
      for (const entry of chain) {
        const sourceId = fieldIdentifier(entry.fields, ["sourceCardId", "sourceId", "source", "actorCardId"]);
        const targetId = fieldIdentifier(entry.fields, ["targetCardId", "targetId", "target", "recipientCardId"]);
        if (!sourceId || !targetId) continue;
        const source = elementFor(sourceId);
        const target = elementFor(targetId);
        if (!source || !target) continue;
        const from = source.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        next.push({
          id: entry.id,
          fromX: (from.left + from.width / 2 - rootBounds.left) / scale,
          fromY: (from.top + from.height / 2 - rootBounds.top) / scale,
          toX: (to.left + to.width / 2 - rootBounds.left) / scale,
          toY: (to.top + to.height / 2 - rootBounds.top) / scale,
        });
      }
      setArrows(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [chain, eventIndex, rootRef]);
  return arrows;
}

function useEventEmphasis(
  rootRef: { current: HTMLDivElement | null },
  event: ReplayEvent | undefined,
) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !event) return;
    const ids = new Set<string>();
    if (event.kind === "interaction" && event.cardId) ids.add(event.cardId);
    if (event.kind === "action") {
      for (const key of ["cardId", "cardInstanceId", "sourceCardId", "targetCardId"] as const) {
        const value = event.action[key];
        if (typeof value === "string") ids.add(value);
      }
      for (const operation of event.patch.operations) {
        if ("cardId" in operation && typeof operation.cardId === "string") ids.add(operation.cardId);
        if (operation.op === "zone_insert") operation.cards.forEach((card) => ids.add(card.id));
        if (operation.op === "zone_remove") operation.cardIds.forEach((id) => ids.add(id));
      }
    }
    if (!ids.size) return;
    const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-card-id]"));
    for (const element of elements) {
      if (!element.dataset.cardId || !ids.has(element.dataset.cardId)) continue;
      element.animate(
        [
          { filter: "brightness(1)", transform: "scale(1)" },
          { filter: "brightness(1.35) drop-shadow(0 0 12px rgba(117,241,229,.85))", transform: "scale(1.08)", offset: 0.38 },
          { filter: "brightness(1)", transform: "scale(1)" },
        ],
        { duration: 520, easing: "cubic-bezier(.16,1,.3,1)" },
      );
    }
  }, [event, rootRef]);
}

function preludeStagesForGame(gameIndex: number): Array<Exclude<ReplaySceneKind, null>> {
  return gameIndex > 0 ? NEXT_GAME_PRELUDE : FIRST_GAME_PRELUDE;
}

export function replayGamePlaybackStartMs(
  game: CanonicalReplayV2["series"]["games"][number],
): number {
  return game.phases.find((phase) => phase.phase === "in_game")?.startedAtMs ?? game.startedAtMs;
}

function eventIndexForPresentation(
  replay: CanonicalReplayV2,
  cursor: PresentationCursor,
  stage: Exclude<ReplaySceneKind, null>,
): number {
  const game = replay.series.games[cursor.gameIndex];
  if (!game) return Math.max(0, Math.min(replay.events.length - 1, 0));
  if (stage === "game_transition") {
    const previousGame = replay.series.games[Math.max(0, cursor.gameIndex - 1)];
    return Math.max(0, previousGame?.eventEndIndex ?? game.eventStartIndex);
  }
  if (stage === "game_end") return Math.max(0, game.eventEndIndex);
  if (stage === "opening") return presentationOpeningEventIndex(replay, game);
  if (stage === "mulligan") {
    const mulligan = game.phases.find((phase) => phase.phase === "mulligan");
    return Math.max(
      0,
      Math.min(replay.events.length - 1, mulligan?.endEventIndex ?? presentationSetupEventIndex(replay, game)),
    );
  }
  if (["matchup", "battlefields", "initiative", "game_start"].includes(stage)) {
    return presentationSetupEventIndex(replay, game);
  }

  const phaseNames: Partial<Record<Exclude<ReplaySceneKind, null>, string[]>> = {
    sideboarding: ["sideboarding"],
  };
  const accepted = new Set(phaseNames[stage] ?? []);
  const matching = game.phases.filter((phase) => accepted.has(phase.phase));
  const phase = matching.at(-1);
  if (!phase) return Math.max(0, game.eventStartIndex);
  const index = stage === "game_start" ? phase.startEventIndex : phase.endEventIndex;
  return Math.max(0, Math.min(replay.events.length - 1, index));
}

function presentationSetupEventIndex(
  replay: CanonicalReplayV2,
  game: CanonicalReplayV2["series"]["games"][number],
): number {
  const inGame = game.phases.find((phase) => phase.phase === "in_game");
  if (inGame) {
    return Math.max(0, Math.min(replay.events.length - 1, inGame.startEventIndex));
  }
  const setupEndIndex = game.eventEndIndex;
  const snapshot = replay.events
    .filter((event) => (
      event.index >= game.eventStartIndex &&
      event.index <= setupEndIndex &&
      event.kind === "snapshot"
    ))
    .at(-1);
  return Math.max(0, Math.min(replay.events.length - 1, snapshot?.index ?? setupEndIndex));
}

function presentationOpeningEventIndex(
  replay: CanonicalReplayV2,
  game: CanonicalReplayV2["series"]["games"][number],
): number {
  const mulligan = game.phases.find((phase) => phase.phase === "mulligan");
  if (!mulligan) return presentationSetupEventIndex(replay, game);
  const start = Math.max(game.eventStartIndex, mulligan.startEventIndex);
  const end = Math.min(game.eventEndIndex, mulligan.endEventIndex);
  for (let index = start; index <= end; index += 1) {
    try {
      const state = seekReplayByEventIndex(replay, index).state;
      const players = resolveReplayPlayers(replay, state);
      if (handCards(players.bottom).length || handCards(players.top).length) return index;
    } catch {
      // Keep looking for the first projectable opening-hand state.
    }
  }
  return Math.max(0, Math.min(replay.events.length - 1, end));
}

function presentationStageLabel(stage: Exclude<ReplaySceneKind, null>): string {
  const labels: Record<Exclude<ReplaySceneKind, null>, string> = {
    matchup: "Matchup",
    battlefields: "Selected battlefields",
    initiative: "Initiative",
    opening: "Opening hands",
    mulligan: "Mulligan",
    game_start: "Game start",
    sideboarding: "Sideboarding",
    game_transition: "Game transition",
    game_end: "Game result",
  };
  return labels[stage];
}

async function replayAuthorizationHeaders(signal: AbortSignal): Promise<Record<string, string>> {
  try {
    const auth = getAuth(firebaseClientApp);
    await auth.authStateReady();
    if (signal.aborted || !auth.currentUser || auth.currentUser.isAnonymous) return {};
    const idToken = await auth.currentUser.getIdToken();
    if (signal.aborted) return {};
    return { Authorization: `Bearer ${idToken}` };
  } catch {
    // The HttpOnly desktop embed session remains available through credentials: include.
    return {};
  }
}

function unwrapCanonicalReplay(body: unknown): CanonicalReplayV2 {
  if (!isObject(body)) throw new Error("The replay service returned an invalid response.");
  let candidate: unknown = body;
  if (isObject(body.replay)) candidate = body.replay;
  else if (isObject(body.data)) candidate = body.data;
  if (isObject(candidate) && isObject(candidate.canonical)) candidate = candidate.canonical;
  if (
    !isObject(candidate) ||
    candidate.schema !== "riftlite-canonical-replay" ||
    candidate.version !== 2 ||
    !Array.isArray(candidate.events) ||
    !Array.isArray(candidate.checkpoints) ||
    !isObject(candidate.series)
  ) {
    throw new Error("This replay has not been normalized for the V2 player.");
  }
  return candidate as unknown as CanonicalReplayV2;
}

function pendingReplayDetails(body: unknown): { failed: boolean; message: string } {
  const summary = isObject(body) && isObject(body.replay) ? body.replay : {};
  if (summary.status === "failed") {
    const failure = isObject(summary.failure) ? summary.failure : {};
    const message = typeof failure.message === "string" ? failure.message.trim().slice(0, 240) : "";
    return {
      failed: true,
      message: message || "Replay processing failed. The replay owner can retry it from the replay library.",
    };
  }
  if (summary.status === "uploading") {
    return { failed: false, message: "The source capture is still uploading. This page will retry automatically." };
  }
  return { failed: false, message: "The deterministic timeline is still being built. This page will retry automatically." };
}

function responseMessage(body: unknown): string {
  if (!isObject(body)) return "";
  for (const value of [body.message, body.error, body.detail]) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 240);
  }
  return "";
}

function cardFromChain(entry: ReplayChainEntry, index: number): ReplayCardState | undefined {
  const fields = entry.fields;
  const candidate = [fields.card, fields.sourceCard, fields.actionCard, fields.payload].find(isJsonObject);
  const record = candidate ?? fields;
  const name = firstText(record.name, record.cardName, record.title, fields.label, fields.actionType);
  const code = firstText(record.cardCode, record.code, record.cardId);
  if (!name && !code) return undefined;
  return {
    id: firstText(record.instanceId, record.cardInstanceId, record.id) || entry.id || `chain-${index}`,
    name: name || code || "Chain action",
    cardCode: code,
    fields: record,
  };
}

function fieldIdentifier(fields: JsonObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value) return value;
    if (isJsonObject(value)) {
      const id = firstText(value.cardInstanceId, value.instanceId, value.cardId, value.id);
      if (id) return id;
    }
  }
  return undefined;
}

function relativeReplayTime(replay: CanonicalReplayV2, at: number | undefined): string {
  if (at === undefined) return "--:--";
  const relative = at > replay.series.startedAt ? at - replay.series.startedAt : at;
  return formatClock(relative);
}

function lastTurnIndexAtTime(turns: ReplayTurnMarker[], atMs: number): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].atMs <= atMs) return index;
  }
  return -1;
}

function looseNumber(value: JsonValue | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function laneLabel(label: string, index: number): string {
  const normalized = label.toLowerCase();
  if (normalized === "board") return index === 0 ? "Base lane" : `Battlefield lane ${index}`;
  return label;
}

function firstText(...values: Array<JsonValue | undefined>): string | undefined {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

function escapeCssUrl(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\r\n]/g, "");
}

function capitalize<T extends string>(value: T): Capitalize<T> {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}` as Capitalize<T>;
}

type IconName =
  | "battlefield"
  | "camera"
  | "card"
  | "chat"
  | "close"
  | "forward"
  | "fullscreen"
  | "help"
  | "keyboard"
  | "list"
  | "next"
  | "pause"
  | "play"
  | "previous"
  | "rewind"
  | "share"
  | "skipEnd"
  | "skipStart"
  | "sliders"
  | "spark"
  | "swap"
  | "trash";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    battlefield: <><path d="M4 7h16v10H4z" /><path d="m7 14 3-3 2 2 2-2 3 3" /></>,
    camera: <><path d="M4 7h3l2-2h6l2 2h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></>,
    card: <><rect height="18" rx="2" width="13" x="5.5" y="3" /><path d="m8 16 3-4 2 2 3-4" /></>,
    chat: <path d="M4 5h16v11H9l-5 4z" />,
    close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
    forward: <><path d="m13 7 5 5-5 5" /><path d="M6 7v10" /></>,
    fullscreen: <><path d="M8 4H4v4" /><path d="M16 4h4v4" /><path d="M20 16v4h-4" /><path d="M4 16v4h4" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.2 2.3c-.7.3-1 .8-1 1.7" /><path d="M12 17h.01" /></>,
    keyboard: <><rect height="14" rx="2" width="20" x="2" y="5" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M7 13h10" /></>,
    list: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
    next: <><path d="m9 6 6 6-6 6" /><path d="M18 6v12" /></>,
    pause: <><path d="M9 5v14" /><path d="M15 5v14" /></>,
    play: <path d="m8 5 11 7-11 7z" />,
    previous: <><path d="m15 6-6 6 6 6" /><path d="M6 6v12" /></>,
    rewind: <><path d="m11 7-5 5 5 5" /><path d="M18 7v10" /></>,
    share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.5-4.4M8.2 13.2l7.5 4.4" /></>,
    skipEnd: <><path d="m7 6 7 6-7 6z" /><path d="M18 5v14" /></>,
    skipStart: <><path d="M6 5v14" /><path d="m17 6-7 6 7 6z" /></>,
    sliders: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
    spark: <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" />,
    swap: <><path d="M5 8h13l-3-3" /><path d="M19 16H6l3 3" /></>,
    trash: <><path d="M4 7h16" /><path d="m9 7 1-3h4l1 3M7 7l1 13h8l1-13" /></>,
  };
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{paths[name]}</g>
    </svg>
  );
}
