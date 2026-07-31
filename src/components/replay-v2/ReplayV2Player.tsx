"use client";

import {
  createContext,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useContext,
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
  REPLAY_ANALYSIS_DESTINATIONS,
  applyReplayAnalysisOperation,
  createReplayAnalysisSession,
  redoReplayAnalysisOperation,
  replayAnalysisCanAddChainTarget,
  replayAnalysisCanAddToChain,
  replayAnalysisCanAttach,
  replayAnalysisCanMove,
  replayAnalysisCardLocation,
  replayAnalysisCardPlayer,
  replayAnalysisChainTargetIds,
  replayAnalysisChangedCardCount,
  replayAnalysisSelectedCard,
  resetReplayAnalysisSession,
  undoReplayAnalysisOperation,
  type ReplayAnalysisCounterField,
  type ReplayAnalysisOperation,
  type ReplayAnalysisSession,
} from "./analysis-mode";
import { buildDeckPeekPresentation, type DeckPeekPresentation } from "./deck-peek";
import {
  activeScene,
  attachedToCardId,
  banishedCards,
  banishedTransitions,
  battlefieldCards,
  battlefieldZoneForPlayer,
  boardZones,
  cardImageUrl,
  cardName,
  cardCounterValue,
  cardsShareCanonicalIdentity,
  championCard,
  championZoneCard,
  customCardLabels,
  deckCards,
  discardCards,
  eventLabel,
  formatClock,
  gameForState,
  groupCardsWithAttachments,
  handCards,
  initiativeRoll,
  isBattlefieldCard,
  isDuplicateCard,
  legendCard,
  replayDurationMs,
  resolveReplayPlayers,
  turnMarkers,
  visibleCardFields,
  zoneCards,
  type ReplayAttachedCardGroup,
  type ReplayPlayerPair,
  type ReplaySceneKind,
  type ReplayTurnMarker,
} from "./model";

const DESIGN_WIDTH = 1_920;
const DESIGN_HEIGHT = 1_080;
const ACTION_ANIMATION_MS = 430;
const PLAYBACK_SPEEDS = [1, 2, 4, 6, 10] as const;
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
const PLAYBACK_SPEED_SHORTCUTS: Readonly<Record<string, PlaybackSpeed>> = {
  "0": 10,
  "1": 1,
  "2": 2,
  "4": 4,
  "6": 6,
};

function nextPlaybackSpeed(current: number): PlaybackSpeed {
  const currentIndex = PLAYBACK_SPEEDS.findIndex((candidate) => candidate === current);
  return PLAYBACK_SPEEDS[(currentIndex + 1) % PLAYBACK_SPEEDS.length] ?? PLAYBACK_SPEEDS[0];
}
const FIRST_GAME_PRELUDE: Array<Exclude<ReplaySceneKind, null>> = [
  "matchup",
  "battlefields",
  "initiative",
  "opening",
  "mulligan",
  "game_start",
];
const PRESENTATION_STAGE_MS: Record<Exclude<ReplaySceneKind, null>, number> = {
  matchup: 2_800,
  battlefields: 2_400,
  initiative: 2_500,
  first_player: 1_900,
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

type BanishedOverlayState = {
  playerName: string;
  cards: ReplayCardState[];
} | null;

type MulliganCardSlot = {
  entering?: ReplayCardState;
  kept?: ReplayCardState;
  leaving?: ReplayCardState;
};

type MulliganHandTransition = {
  cards: ReplayCardState[];
  detailLevel: "count" | "count_unresolved" | "exact" | "unavailable";
  replacementCount: number;
  slots: MulliganCardSlot[];
};

type SideboardCardQuantity = {
  card: ReplayCardState;
  count: number;
};

type SideboardTransition = {
  actionIndex?: number;
  incoming: SideboardCardQuantity[];
  outgoing: SideboardCardQuantity[];
  playerName: string;
  status: "exact" | "unavailable";
};

type SideboardDeckList = {
  mainDeck: SideboardCardQuantity[];
  sideboard: SideboardCardQuantity[];
};

type CollaborativeReplayMetadata = {
  informationPolicy?: unknown;
  mode?: unknown;
  schema?: unknown;
};

function isConsentedDualPerspectiveReplay(replay: CanonicalReplayV2): boolean {
  const collaboration = (
    replay as unknown as { collaboration?: CollaborativeReplayMetadata }
  ).collaboration;
  return collaboration?.informationPolicy === "consented_full_information" && (
    collaboration.mode === "dual-perspective" || collaboration.schema === "riftlite-dual-perspective"
  );
}

type ReplaySeriesScore = {
  available: boolean;
  bottom: number;
  top: number;
};

type PresentationCursor = {
  gameIndex: number;
  stageIndex: number;
};

type ReplayAnalysisInteractionContextValue = {
  active: boolean;
  onContextMenu: (
    card: ReplayCardState,
    clientX: number,
    clientY: number,
    chainEntryId?: string,
  ) => void;
  onDragState: (cardId: string | null) => void;
};

const ReplayAnalysisInteractionContext =
  createContext<ReplayAnalysisInteractionContextValue | null>(null);

type ReplayAnalysisContextMenuState = {
  card: ReplayCardState;
  cardId: string;
  chainEntryId?: string;
  x: number;
  y: number;
} | null;

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
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [showMore, setShowMore] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [discardOverlay, setDiscardOverlay] = useState<DiscardOverlayState>(null);
  const [banishedOverlay, setBanishedOverlay] = useState<BanishedOverlayState>(null);
  const [hoveredCard, setHoveredCard] = useState<ReplayCardState | null>(null);
  const [selectedCard, setSelectedCard] = useState<ReplayCardState | null>(null);
  const [activityTab, setActivityTab] = useState<"chat" | "log">("chat");
  const [suppressMotion, setSuppressMotion] = useState(false);
  const [notice, setNotice] = useState("");
  const [analysisSession, setAnalysisSession] = useState<ReplayAnalysisSession | null>(null);
  const [analysisSelectedCardId, setAnalysisSelectedCardId] = useState<string | null>(null);
  const [analysisAttachmentCardId, setAnalysisAttachmentCardId] = useState<string | null>(null);
  const [analysisTargetChainEntryId, setAnalysisTargetChainEntryId] =
    useState<string | null>(null);
  const [analysisContextMenu, setAnalysisContextMenu] =
    useState<ReplayAnalysisContextMenuState>(null);
  const [analysisDraggingCardId, setAnalysisDraggingCardId] = useState<string | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pendingSeekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationLockedUntil = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analysisDraggingCardIdRef = useRef<string | null>(null);
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
        setAnalysisSession(null);
        setAnalysisSelectedCardId(null);
        setAnalysisAttachmentCardId(null);
        setAnalysisTargetChainEntryId(null);
        setAnalysisContextMenu(null);
        analysisDraggingCardIdRef.current = null;
        setAnalysisDraggingCardId(null);
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
  const presentationStages = presentation && replay
    ? preludeStagesForGame(replay, presentation.gameIndex)
    : null;
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
  const canonicalState = projection?.state ?? null;
  const state = analysisSession?.state ?? canonicalState;
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

  const clearAnalysis = useCallback((announce = false) => {
    setAnalysisSession(null);
    setAnalysisSelectedCardId(null);
    setAnalysisAttachmentCardId(null);
    setAnalysisTargetChainEntryId(null);
    setAnalysisContextMenu(null);
    analysisDraggingCardIdRef.current = null;
    setAnalysisDraggingCardId(null);
    if (announce) flashNotice("Returned to the original replay");
  }, [flashNotice]);

  const settleAnimations = useCallback((resume: boolean) => {
    const canvas = canvasRef.current;
    const animations = canvas && typeof canvas.getAnimations === "function"
      ? canvas.getAnimations({ subtree: true })
      : [];
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
        clearAnalysis();
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
    [clearAnalysis, currentMs, durationMs, replay, setMotionSuppressedBriefly],
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
      clearAnalysis();
      setMotionSuppressedBriefly();
    },
    [clearAnalysis, replay, setMotionSuppressedBriefly],
  );

  const advancePresentation = useCallback(
    (direction: -1 | 1) => {
      if (!presentation || !replay) return;
      const stages = preludeStagesForGame(replay, presentation.gameIndex);
      const nextStage = presentation.stageIndex + direction;
      if (nextStage < 0) return;
      if (direction < 0) setMotionSuppressedBriefly();
      clearAnalysis();
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
    [clearAnalysis, currentMs, presentation, replay, setMotionSuppressedBriefly],
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
    if (analysisSession) clearAnalysis(true);
    if (playing) {
      setPlaying(false);
      settleAnimations(false);
      return;
    }
    if (!presentation && currentMs >= durationMs) beginGamePresentation(0);
    setManualEventIndex(null);
    settleAnimations(true);
    setPlaying(true);
  }, [
    analysisSession,
    beginGamePresentation,
    clearAnalysis,
    currentMs,
    durationMs,
    playing,
    presentation,
    replay,
    settleAnimations,
  ]);

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
          const stages = preludeStagesForGame(replay, Math.max(0, gameIndex));
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
        if (analysisContextMenu) {
          setAnalysisContextMenu(null);
          return;
        }
        if (analysisTargetChainEntryId) {
          setAnalysisTargetChainEntryId(null);
          flashNotice("Target selection cancelled");
          return;
        }
        if (analysisAttachmentCardId) {
          setAnalysisAttachmentCardId(null);
          flashNotice("Attachment cancelled");
          return;
        }
        setShowHelp(false);
        setDiscardOverlay(null);
        setBanishedOverlay(null);
        setHoveredCard(null);
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
      const shortcutSpeed = PLAYBACK_SPEED_SHORTCUTS[keyboardEvent.key];
      if (shortcutSpeed) {
        keyboardEvent.preventDefault();
        changeSpeed(shortcutSpeed);
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
  }, [
    analysisAttachmentCardId,
    analysisContextMenu,
    analysisTargetChainEntryId,
    changeSpeed,
    flashNotice,
    stepAction,
    stepGame,
    stepTurn,
    togglePlayback,
  ]);

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

  const startAnalysis = useCallback(() => {
    if (!replay || !canonicalState || eventIndex < 0) return;
    const anchorMs = replay.events[eventIndex]?.atMs ?? currentMs;
    setPlaying(false);
    settleAnimations(false);
    setPresentation(null);
    setManualEventIndex(eventIndex);
    setCurrentMs(anchorMs);
    setShowMore(false);
    setDiscardOverlay(null);
    setBanishedOverlay(null);
    setHoveredCard(null);
    setSelectedCard(null);
    setAnalysisSelectedCardId(null);
    setAnalysisAttachmentCardId(null);
    setAnalysisTargetChainEntryId(null);
    const session = createReplayAnalysisSession(replay, eventIndex, canonicalState);
    setAnalysisSession(session);
    flashNotice(
      session.inferredCardIds.length
        ? `Analysis started · ${session.inferredCardIds.length} later-revealed ${session.inferredCardIds.length === 1 ? "card" : "cards"} identified`
        : "Analysis started · changes are temporary",
    );
  }, [canonicalState, currentMs, eventIndex, flashNotice, replay, settleAnimations]);

  const toggleAnalysis = useCallback(() => {
    if (analysisSession) clearAnalysis(true);
    else startAnalysis();
  }, [analysisSession, clearAnalysis, startAnalysis]);

  const resetAnalysis = useCallback(() => {
    if (!analysisSession) return;
    setAnalysisSession(resetReplayAnalysisSession(analysisSession));
    setAnalysisSelectedCardId(null);
    setAnalysisAttachmentCardId(null);
    setAnalysisTargetChainEntryId(null);
    setHoveredCard(null);
    setSelectedCard(null);
    flashNotice("Analysis position reset");
  }, [analysisSession, flashNotice]);

  const applyAnalysisOperation = useCallback((operation: ReplayAnalysisOperation) => {
    setAnalysisSession((current) => (
      current ? applyReplayAnalysisOperation(current, operation) : current
    ));
  }, []);

  const openAnalysisContextMenu = useCallback((
    card: ReplayCardState,
    clientX: number,
    clientY: number,
    chainEntryId?: string,
  ) => {
    if (!analysisSession) return;
    const bounds = canvasRef.current?.getBoundingClientRect();
    const canvasX = bounds?.width
      ? ((clientX - bounds.left) / bounds.width) * DESIGN_WIDTH
      : clientX;
    const canvasY = bounds?.height
      ? ((clientY - bounds.top) / bounds.height) * DESIGN_HEIGHT
      : clientY;
    setAnalysisSelectedCardId(card.id);
    setSelectedCard(card);
    setHoveredCard(null);
    setAnalysisContextMenu({
      card,
      cardId: card.id,
      ...(chainEntryId ? { chainEntryId } : {}),
      x: Math.min(DESIGN_WIDTH - 294, Math.max(8, canvasX)),
      y: Math.min(DESIGN_HEIGHT - 420, Math.max(8, canvasY)),
    });
  }, [analysisSession]);

  const handleAnalysisDragState = useCallback((cardId: string | null) => {
    analysisDraggingCardIdRef.current = cardId;
    setAnalysisDraggingCardId(cardId);
  }, []);

  const getAnalysisDraggingCardId = useCallback(
    () => analysisDraggingCardIdRef.current,
    [],
  );

  const handleAnalysisDrop = useCallback((
    cardId: string,
    playerId: string,
    zone: string,
  ) => {
    if (!analysisSession) return;
    const cardPlayer = replayAnalysisCardPlayer(analysisSession.state, cardId);
    if (!cardPlayer) {
      flashNotice("That card is no longer available in this branch");
      return;
    }
    if (cardPlayer.id !== playerId) {
      flashNotice(`Drop onto ${cardPlayer.name}'s zones`);
      return;
    }
    applyAnalysisOperation({ kind: "move_card", cardId, playerId, zone });
    setAnalysisSelectedCardId(cardId);
    setAnalysisContextMenu(null);
    analysisDraggingCardIdRef.current = null;
    setAnalysisDraggingCardId(null);
    flashNotice("What-if card moved");
  }, [analysisSession, applyAnalysisOperation, flashNotice]);

  useEffect(() => {
    if (!analysisContextMenu) return;
    const dismiss = () => setAnalysisContextMenu(null);
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [analysisContextMenu]);

  const undoAnalysis = useCallback(() => {
    setAnalysisSession((current) => (
      current ? undoReplayAnalysisOperation(current) : current
    ));
    setAnalysisAttachmentCardId(null);
    setAnalysisTargetChainEntryId(null);
  }, []);

  const redoAnalysis = useCallback(() => {
    setAnalysisSession((current) => (
      current ? redoReplayAnalysisOperation(current) : current
    ));
    setAnalysisAttachmentCardId(null);
    setAnalysisTargetChainEntryId(null);
  }, []);

  useEffect(() => {
    if (!analysisSession) return;
    const handleAnalysisHistoryShortcut = (keyboardEvent: KeyboardEvent) => {
      if (
        keyboardEvent.defaultPrevented ||
        isTypingTarget(keyboardEvent.target) ||
        (!keyboardEvent.ctrlKey && !keyboardEvent.metaKey) ||
        keyboardEvent.altKey
      ) {
        return;
      }
      const key = keyboardEvent.key.toLowerCase();
      if (key === "z") {
        keyboardEvent.preventDefault();
        if (keyboardEvent.shiftKey) redoAnalysis();
        else undoAnalysis();
      } else if (key === "y" && !keyboardEvent.shiftKey) {
        keyboardEvent.preventDefault();
        redoAnalysis();
      }
    };
    window.addEventListener("keydown", handleAnalysisHistoryShortcut);
    return () => window.removeEventListener("keydown", handleAnalysisHistoryShortcut);
  }, [analysisSession, redoAnalysis, undoAnalysis]);

  const handleCardSelect = useCallback((card: ReplayCardState) => {
    if (analysisSession && analysisTargetChainEntryId) {
      if (
        !replayAnalysisCanAddChainTarget(
          analysisSession.state,
          analysisTargetChainEntryId,
          card.id,
        )
      ) {
        const existingTargets = replayAnalysisChainTargetIds(
          analysisSession.state,
          analysisTargetChainEntryId,
        );
        flashNotice(
          existingTargets.includes(card.id)
            ? "That target is already linked"
            : "Choose a different face-up card or battlefield",
        );
        return;
      }
      setAnalysisSession((current) => (
        current
          ? applyReplayAnalysisOperation(current, {
              kind: "add_chain_target",
              entryId: analysisTargetChainEntryId,
              targetCardId: card.id,
            })
          : current
      ));
      setAnalysisTargetChainEntryId(null);
      setAnalysisSelectedCardId(card.id);
      setSelectedCard(card);
      flashNotice("What-if target linked");
      return;
    }
    if (analysisSession && analysisAttachmentCardId) {
      if (!replayAnalysisCanAttach(analysisSession.state, analysisAttachmentCardId, card.id)) {
        flashNotice("Choose a different face-up card on the base or a battlefield");
        return;
      }
      setAnalysisSession((current) => (
        current
          ? applyReplayAnalysisOperation(current, {
              kind: "attach_card",
              cardId: analysisAttachmentCardId,
              targetCardId: card.id,
            })
          : current
      ));
      setAnalysisAttachmentCardId(null);
      setAnalysisSelectedCardId(card.id);
      setSelectedCard(card);
      flashNotice("What-if attachment added");
      return;
    }
    if (analysisSession) setAnalysisSelectedCardId(card.id);
    setSelectedCard(card);
  }, [
    analysisAttachmentCardId,
    analysisSession,
    analysisTargetChainEntryId,
    flashNotice,
  ]);

  const analysisSelectedCard = useMemo(
    () => (
      analysisContextMenu?.chainEntryId
        ? analysisContextMenu.card
        : analysisSession
        ? replayAnalysisSelectedCard(analysisSession.state, analysisSelectedCardId)
        : null
    ),
    [analysisContextMenu, analysisSelectedCardId, analysisSession],
  );

  const inspectedCard = useMemo(() => {
    if (hoveredCard) return hoveredCard;
    if (analysisSelectedCard) return analysisSelectedCard;
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
  }, [analysisSelectedCard, hoveredCard, replay, selectedCard, state]);

  const analysisInteractions = useMemo<ReplayAnalysisInteractionContextValue>(
    () => ({
      active: Boolean(analysisSession),
      onContextMenu: openAnalysisContextMenu,
      onDragState: handleAnalysisDragState,
    }),
    [analysisSession, handleAnalysisDragState, openAnalysisContextMenu],
  );

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
            <ReplayAnalysisInteractionContext.Provider value={analysisInteractions}>
              <ReplayBoard
                analysisActive={Boolean(analysisSession)}
                analysisDraggingCardId={analysisDraggingCardId}
                currentMs={currentMs}
                eventIndex={eventIndex}
                getAnalysisDraggingCardId={getAnalysisDraggingCardId}
                inspectedCard={inspectedCard}
                onCardHover={setHoveredCard}
                onCardSelect={handleCardSelect}
                onOpenBanished={(player) => {
                  setHoveredCard(null);
                  setBanishedOverlay({ playerName: player.name, cards: banishedCards(player) });
                }}
                onOpenDiscard={(player) => {
                  setHoveredCard(null);
                  setDiscardOverlay({ playerName: player.name, cards: discardCards(player) });
                }}
                onAnalysisDrop={handleAnalysisDrop}
                playing={playing}
                replay={replay}
                sceneOverride={presentationStage}
                speed={speed}
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
              {analysisSession ? (
                <ReplayAnalysisPanel
                  attachmentCardId={analysisAttachmentCardId}
                  onAdjustCounter={(cardId, field, delta) => {
                    applyAnalysisOperation({ kind: "adjust_counter", cardId, field, delta });
                  }}
                  onAdjustScore={(playerId, delta) => {
                    applyAnalysisOperation({ kind: "adjust_score", playerId, delta });
                  }}
                  onAddToChain={(cardId) => {
                    applyAnalysisOperation({ kind: "add_to_chain", cardId });
                    setAnalysisSelectedCardId(null);
                    setHoveredCard(null);
                    setSelectedCard(null);
                    flashNotice("What-if card added to the chain");
                  }}
                  onAttach={(cardId) => {
                    setAnalysisAttachmentCardId(cardId);
                    flashNotice("Select a face-up card to attach it to");
                  }}
                  onCancelAttach={() => setAnalysisAttachmentCardId(null)}
                  onCancelTarget={() => setAnalysisTargetChainEntryId(null)}
                  onDetach={(cardId) => {
                    applyAnalysisOperation({ kind: "detach_card", cardId });
                  }}
                  onExit={() => clearAnalysis(true)}
                  onMove={(cardId, zone) => {
                    applyAnalysisOperation({ kind: "move_card", cardId, zone });
                  }}
                  onRedo={redoAnalysis}
                  onReset={resetAnalysis}
                  onRestore={(cardId) => {
                    applyAnalysisOperation({ kind: "restore_card", cardId });
                  }}
                  onToggleExhausted={(cardId) => {
                    applyAnalysisOperation({ kind: "toggle_exhausted", cardId });
                  }}
                  onUndo={undoAnalysis}
                  replay={replay}
                  selectedCardId={analysisSelectedCardId}
                  session={analysisSession}
                  targetChainEntryId={analysisTargetChainEntryId}
                />
              ) : null}
              {analysisSession && analysisContextMenu && analysisSelectedCard ? (
                <ReplayAnalysisContextMenu
                  canAddToChain={
                    !analysisContextMenu.chainEntryId &&
                    replayAnalysisCanAddToChain(
                      analysisSession.state,
                      analysisSelectedCard.id,
                    )
                  }
                  canMove={(zone) => {
                    const player = replayAnalysisCardPlayer(
                      analysisSession.state,
                      analysisSelectedCard.id,
                    );
                    return Boolean(
                      player &&
                      replayAnalysisCanMove(
                        analysisSession.state,
                        analysisSelectedCard.id,
                        player.id,
                        zone,
                      )
                    );
                  }}
                  card={analysisSelectedCard}
                  chainEntryId={analysisContextMenu.chainEntryId}
                  chainTargetCount={
                    analysisContextMenu.chainEntryId
                      ? replayAnalysisChainTargetIds(
                          analysisSession.state,
                          analysisContextMenu.chainEntryId,
                        ).length
                      : 0
                  }
                  onAddToChain={() => {
                    applyAnalysisOperation({
                      kind: "add_to_chain",
                      cardId: analysisSelectedCard.id,
                    });
                    setAnalysisContextMenu(null);
                    setAnalysisSelectedCardId(null);
                    setHoveredCard(null);
                    setSelectedCard(null);
                    flashNotice("What-if card added to the chain");
                  }}
                  onAdjustCounter={(field, delta) => {
                    applyAnalysisOperation({
                      kind: "adjust_counter",
                      cardId: analysisSelectedCard.id,
                      field,
                      delta,
                    });
                  }}
                  onAttach={() => {
                    setAnalysisAttachmentCardId(analysisSelectedCard.id);
                    setAnalysisContextMenu(null);
                    flashNotice("Select a face-up card to attach it to");
                  }}
                  onClose={() => setAnalysisContextMenu(null)}
                  onClearChainTargets={() => {
                    if (!analysisContextMenu.chainEntryId) return;
                    applyAnalysisOperation({
                      kind: "clear_chain_targets",
                      entryId: analysisContextMenu.chainEntryId,
                    });
                    setAnalysisContextMenu(null);
                    setAnalysisTargetChainEntryId(null);
                    flashNotice("What-if target arrows cleared");
                  }}
                  onDetach={() => {
                    applyAnalysisOperation({
                      kind: "detach_card",
                      cardId: analysisSelectedCard.id,
                    });
                    setAnalysisContextMenu(null);
                    flashNotice("What-if attachment removed");
                  }}
                  onMove={(zone) => {
                    applyAnalysisOperation({
                      kind: "move_card",
                      cardId: analysisSelectedCard.id,
                      zone,
                    });
                    setAnalysisContextMenu(null);
                    flashNotice("What-if card moved");
                  }}
                  onRestore={() => {
                    applyAnalysisOperation({
                      kind: "restore_card",
                      cardId: analysisSelectedCard.id,
                    });
                    setAnalysisContextMenu(null);
                    flashNotice("Card returned to the analysis start");
                  }}
                  onRemoveFromChain={() => {
                    if (!analysisContextMenu.chainEntryId) return;
                    applyAnalysisOperation({
                      kind: "remove_from_chain",
                      entryId: analysisContextMenu.chainEntryId,
                    });
                    setAnalysisContextMenu(null);
                    setAnalysisTargetChainEntryId(null);
                    setAnalysisSelectedCardId(null);
                    setHoveredCard(null);
                    setSelectedCard(null);
                    flashNotice("What-if card returned from the chain");
                  }}
                  onSetChainTarget={() => {
                    if (!analysisContextMenu.chainEntryId) return;
                    setAnalysisTargetChainEntryId(analysisContextMenu.chainEntryId);
                    setAnalysisAttachmentCardId(null);
                    setAnalysisContextMenu(null);
                    flashNotice("Select a face-up card or battlefield as the target");
                  }}
                  onToggleExhausted={() => {
                    applyAnalysisOperation({
                      kind: "toggle_exhausted",
                      cardId: analysisSelectedCard.id,
                    });
                    setAnalysisContextMenu(null);
                  }}
                  position={analysisContextMenu}
                />
              ) : null}
              <TransportControls
                analysisActive={Boolean(analysisSession)}
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
                onToggleAnalysis={toggleAnalysis}
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
                  onClose={() => {
                    setHoveredCard(null);
                    setDiscardOverlay(null);
                  }}
                  playerName={discardOverlay.playerName}
                />
              ) : null}
              {banishedOverlay ? (
                <BanishedOverlay
                  cards={banishedOverlay.cards}
                  onCardHover={setHoveredCard}
                  onCardSelect={setSelectedCard}
                  onClose={() => {
                    setHoveredCard(null);
                    setBanishedOverlay(null);
                  }}
                  playerName={banishedOverlay.playerName}
                />
              ) : null}
              {hoveredCard && !showHelp ? (
                <HoverCardPreview
                  card={hoveredCard}
                  key={`${hoveredCard.id}|${cardImageUrl(hoveredCard) ?? "no-image"}`}
                  besideDiscard={Boolean(discardOverlay || banishedOverlay)}
                />
              ) : null}
              {showHelp ? <ShortcutHelp onClose={() => setShowHelp(false)} /> : null}
              {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
            </ReplayAnalysisInteractionContext.Provider>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplayBoard({
  analysisActive,
  analysisDraggingCardId,
  currentMs,
  eventIndex,
  getAnalysisDraggingCardId,
  inspectedCard,
  onAnalysisDrop,
  onCardHover,
  onCardSelect,
  onOpenBanished,
  onOpenDiscard,
  playing,
  replay,
  sceneOverride,
  speed,
  state,
  suppressCanonicalOpening,
  suppressMotion,
}: {
  analysisActive: boolean;
  analysisDraggingCardId: string | null;
  currentMs: number;
  eventIndex: number;
  getAnalysisDraggingCardId: () => string | null;
  inspectedCard: ReplayCardState | null;
  onAnalysisDrop: (cardId: string, playerId: string, zone: string) => void;
  onCardHover: (card: ReplayCardState | null) => void;
  onCardSelect: (card: ReplayCardState) => void;
  onOpenBanished: (player: ReplayPlayerState) => void;
  onOpenDiscard: (player: ReplayPlayerState) => void;
  playing: boolean;
  replay: CanonicalReplayV2;
  sceneOverride: Exclude<ReplaySceneKind, null> | null;
  speed: PlaybackSpeed;
  state: ReplayState;
  suppressCanonicalOpening: boolean;
  suppressMotion: boolean;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const activeDropTargetRef = useRef<HTMLElement | null>(null);
  const players = useMemo(() => resolveReplayPlayers(replay, state), [replay, state]);
  const battlefields = useMemo(() => battlefieldCards(state, players), [players, state]);
  const canonicalScene = activeScene(replay, state, currentMs);
  const scene = analysisActive
    ? null
    : sceneOverride ?? (
        suppressCanonicalOpening && canonicalScene === "opening" ? null : canonicalScene
      );
  const action = replay.events[eventIndex];
  const openHands = isConsentedDualPerspectiveReplay(replay);
  const deckPeek = useMemo(
    () => buildDeckPeekPresentation(replay, state, eventIndex),
    [eventIndex, replay, state],
  );
  const banishChanges = useMemo(() => {
    if (eventIndex <= 0 || !hasPriorZoneAuthority(replay, eventIndex, state.gameId)) return [];
    const previous = seekReplayByEventIndex(replay, eventIndex - 1).state;
    return banishedTransitions(previous, state);
  }, [eventIndex, replay, state]);
  const banishLabel = banishedEventLabel(banishChanges);
  useCardMotion(boardRef, eventIndex, suppressMotion);
  useEventEmphasis(boardRef, action);
  const arrows = useTargetArrows(boardRef, state.chain, eventIndex);

  const clearDropTarget = useCallback(() => {
    activeDropTargetRef.current?.removeAttribute("data-analysis-drop-hover");
    activeDropTargetRef.current = null;
  }, []);

  useEffect(() => {
    if (!analysisDraggingCardId) clearDropTarget();
  }, [analysisDraggingCardId, clearDropTarget]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const targets = board.querySelectorAll<HTMLElement>(
      "[data-analysis-drop-zone][data-analysis-drop-player-id]",
    );
    for (const target of targets) {
      const playerId = target.dataset.analysisDropPlayerId;
      const zone = target.dataset.analysisDropZone;
      const valid = Boolean(
        analysisActive &&
        analysisDraggingCardId &&
        playerId &&
        zone &&
        replayAnalysisCanMove(state, analysisDraggingCardId, playerId, zone)
      );
      if (valid) target.setAttribute("data-analysis-drop-valid", "true");
      else target.removeAttribute("data-analysis-drop-valid");
    }
    return () => {
      for (const target of targets) target.removeAttribute("data-analysis-drop-valid");
    };
  }, [analysisActive, analysisDraggingCardId, state]);

  const analysisDropTarget = useCallback((target: EventTarget | null, cardId?: string | null) => {
    const draggingCardId = cardId ?? getAnalysisDraggingCardId() ?? analysisDraggingCardId;
    if (!analysisActive || !draggingCardId || !(target instanceof Element)) return null;
    const dropTarget = target.closest<HTMLElement>(
      "[data-analysis-drop-zone][data-analysis-drop-player-id]",
    );
    const playerId = dropTarget?.dataset.analysisDropPlayerId;
    const zone = dropTarget?.dataset.analysisDropZone;
    return dropTarget &&
      playerId &&
      zone &&
      replayAnalysisCanMove(state, draggingCardId, playerId, zone)
      ? dropTarget
      : null;
  }, [analysisActive, analysisDraggingCardId, getAnalysisDraggingCardId, state]);

  const handleDragOver = useCallback((dragEvent: ReactDragEvent<HTMLElement>) => {
    const target = analysisDropTarget(dragEvent.target);
    if (!target) {
      clearDropTarget();
      return;
    }
    dragEvent.preventDefault();
    dragEvent.dataTransfer.dropEffect = "move";
    if (activeDropTargetRef.current !== target) {
      clearDropTarget();
      target.setAttribute("data-analysis-drop-hover", "true");
      activeDropTargetRef.current = target;
    }
  }, [analysisDropTarget, clearDropTarget]);

  const handleDrop = useCallback((dragEvent: ReactDragEvent<HTMLElement>) => {
    const cardId =
      dragEvent.dataTransfer.getData("application/x-riftlite-card") ||
      dragEvent.dataTransfer.getData("text/plain");
    const target = analysisDropTarget(dragEvent.target, cardId);
    const playerId = target?.dataset.analysisDropPlayerId;
    const zone = target?.dataset.analysisDropZone;
    clearDropTarget();
    if (!target || !cardId || !playerId || !zone) return;
    dragEvent.preventDefault();
    onAnalysisDrop(cardId, playerId, zone);
  }, [analysisDropTarget, clearDropTarget, onAnalysisDrop]);

  return (
    <section
      aria-label="Replay board"
      className={`${styles.board} ${suppressMotion ? styles.motionSuppressed : ""} ${
        analysisActive ? styles.analysisBoard : ""
      }`}
      data-analysis-board={analysisActive ? "true" : undefined}
      data-analysis-dragging={analysisDraggingCardId ? "true" : undefined}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      ref={boardRef}
    >
      <PlayerRail
        active={state.room.activeTurnPlayerId === players.top.id}
        orientation="top"
        player={players.top}
      />
      <PlayerPileStack
        onOpenBanished={() => onOpenBanished(players.top)}
        onOpenDiscard={() => onOpenDiscard(players.top)}
        orientation="top"
        player={players.top}
      />
      <PlayerHeroStack
        onCardHover={onCardHover}
        onCardSelect={onCardSelect}
        orientation="top"
        player={players.top}
      />
      <PlayerHalf
        inspectedCard={inspectedCard}
        onCardHover={onCardHover}
        onCardSelect={onCardSelect}
        openHands={openHands}
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
        openHands={openHands}
        orientation="bottom"
        player={players.bottom}
      />
      <PlayerHeroStack
        onCardHover={onCardHover}
        onCardSelect={onCardSelect}
        orientation="bottom"
        player={players.bottom}
      />
      <PlayerPileStack
        onOpenBanished={() => onOpenBanished(players.bottom)}
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
      <div
        className={`${styles.actionCaption} ${banishLabel ? styles.banishActionCaption : ""} ${
          analysisActive ? styles.analysisActionCaption : ""
        }`}
        data-banished-event={banishLabel ? "true" : undefined}
        key={action?.id ?? "replay-ready"}
      >
        <span className={styles.actionDot} />
        {analysisActive ? "Analysis mode · Changes are temporary" : banishLabel || eventLabel(action)}
      </div>
      {analysisActive ? (
        <div className={styles.analysisBoardBadge} data-analysis-status="active">
          <Icon name="spark" />
          <span>What-if branch</span>
        </div>
      ) : null}
      {openHands ? (
        <div className={styles.combinedReplayBadge} data-combined-replay="open-hands">
          <Icon name="combine" />
          <span>Combined replay <i>·</i> Open hands</span>
        </div>
      ) : null}
      {deckPeek && !scene && !analysisActive ? (
        <DeckPeekOverlay
          onCardHover={onCardHover}
          onCardSelect={onCardSelect}
          presentation={deckPeek}
          speed={speed}
        />
      ) : null}
      {scene ? (
        <SceneOverlay
          battlefields={battlefields}
          currentMs={currentMs}
          playing={playing}
          players={players}
          replay={replay}
          scene={scene}
          speed={speed}
          state={state}
        />
      ) : null}
    </section>
  );
}

function hasPriorZoneAuthority(
  replay: CanonicalReplayV2,
  eventIndex: number,
  gameId: string | null,
): boolean {
  return replay.events.slice(0, eventIndex).some((event) => {
    if (event.gameId !== gameId) return false;
    if (event.kind === "snapshot") return true;
    return event.kind === "action" && event.patch.operations.some((operation) => (
      operation.op === "zone_insert" ||
      operation.op === "zone_remove" ||
      operation.op === "zone_move"
    ));
  });
}

function banishedEventLabel(changes: ReturnType<typeof banishedTransitions>): string {
  const total = changes.reduce((count, change) => count + change.cards.length, 0);
  if (!total) return "";
  if (changes.length === 1 && total === 1) {
    const change = changes[0];
    const card = change.cards[0];
    return card.isPlaceholder
      ? `${change.playerName} banished a hidden card`
      : `${change.playerName} banished ${cardName(card)}`;
  }
  if (changes.length === 1) return `${changes[0].playerName} banished ${total} cards`;
  return `${total} cards were banished`;
}

function DeckPeekOverlay({
  onCardHover,
  onCardSelect,
  presentation,
  speed,
}: {
  onCardHover: (card: ReplayCardState | null) => void;
  onCardSelect: (card: ReplayCardState) => void;
  presentation: DeckPeekPresentation;
  speed: PlaybackSpeed;
}) {
  const current = presentation.cards.find(({ card }) => card.id === presentation.currentCardId);
  const count = presentation.cards.length;
  const subtitle = presentation.phase === "return"
    ? "The remaining cards return to the bottom of the deck in random order."
    : presentation.phase === "choose"
      ? `${current && !current.card.isPlaceholder ? cardName(current.card) : "A card"} was chosen${presentation.currentDestination ? ` for ${presentation.currentDestination}` : ""}.`
      : presentation.phase === "reveal"
        ? `${current && !current.card.isPlaceholder ? cardName(current.card) : "A card"} was revealed to both players.`
        : "The inspected cards are shown one at a time before the choice is made.";

  return (
    <div
      aria-label={`${presentation.playerName} deck inspection`}
      className={styles.deckPeekOverlay}
      data-deck-peek-phase={presentation.phase}
      data-deck-peek-player={presentation.playerId}
      data-deck-peek-revision={presentation.revision}
      key={presentation.key}
    >
      <div className={styles.deckPeekShade} />
      <section className={styles.deckPeekPanel}>
        <header>
          <span>Deck inspection</span>
          <h2>{presentation.playerName} looks at the top {count} {count === 1 ? "card" : "cards"}</h2>
          <p>{subtitle}</p>
        </header>
        <div className={styles.deckPeekCards}>
          {presentation.cards.map((candidate, index) => {
            const movedNow = candidate.movedAtEventIndex === presentation.eventIndex;
            const moved = candidate.movedAtEventIndex !== undefined;
            const returning = presentation.phase === "return" && candidate.returnedAtEventIndex === presentation.eventIndex;
            const revealedNow = presentation.phase === "reveal" && presentation.currentCardId === candidate.card.id;
            const enteredNow = candidate.appearedAtEventIndex === presentation.eventIndex;
            const status = returning ? "returning" : movedNow ? "chosen" : moved ? "moved" : revealedNow ? "revealed" : enteredNow ? "entering" : "available";
            return (
              <div
                className={`${styles.deckPeekCard} ${styles[`deckPeekCard${capitalize(status)}`]}`}
                data-deck-peek-card={candidate.card.id}
                data-deck-peek-card-status={status}
                key={candidate.card.id}
                style={{
                  "--deck-peek-delay": `${(index * 70) / speed}ms`,
                  "--deck-peek-duration": `${850 / speed}ms`,
                } as CSSProperties}
              >
                <CardTile
                  card={candidate.card}
                  onHover={candidate.card.isPlaceholder ? undefined : onCardHover}
                  onSelect={candidate.card.isPlaceholder ? undefined : onCardSelect}
                  size="scene"
                />
                <div className={styles.deckPeekCardBadges}>
                  {candidate.revealed ? <b data-deck-peek-revealed>Revealed</b> : null}
                  {moved ? <b data-deck-peek-destination={candidate.destination}>To {candidate.destination ?? "play"}</b> : null}
                  {returning ? <b data-deck-peek-returning>Bottom of deck</b> : null}
                </div>
              </div>
            );
          })}
        </div>
        <footer>
          <span>{presentation.phase === "return" ? "Inspection complete" : `${count} ${count === 1 ? "option" : "options"} observed`}</span>
          <i />
          <span>{presentation.phase === "choose" ? "Choice recorded" : "Authoritative replay data"}</span>
        </footer>
      </section>
    </div>
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
        <span
          aria-label={`${score} points${player.boardFields.analysisScoreChanged === true ? ", changed in analysis" : ""}`}
          className={`${styles.pointsBadge} ${
            player.boardFields.analysisScoreChanged === true ? styles.analysisPointsBadge : ""
          }`}
          data-analysis-score={player.boardFields.analysisScoreChanged === true ? "true" : undefined}
          data-player-score={score}
        >
          <small>Points</small>
          <b>{score}</b>
        </span>
      </div>
    </header>
  );
}

function PlayerHeroStack({
  onCardHover,
  onCardSelect,
  orientation,
  player,
}: {
  onCardHover: (card: ReplayCardState | null) => void;
  onCardSelect: (card: ReplayCardState) => void;
  orientation: "top" | "bottom";
  player: ReplayPlayerState;
}) {
  const legend = legendCard(player);
  const champion = championZoneCard(player);
  return (
    <aside
      aria-label={`${player.name} legend and champion`}
      className={`${styles.playerHeroStack} ${
        orientation === "top" ? styles.playerHeroStackTop : styles.playerHeroStackBottom
      }`}
      data-hero-stack={orientation}
    >
      <span>{player.name}</span>
      {legend ? (
        <CardTile
          card={legend}
          onHover={onCardHover}
          onSelect={onCardSelect}
          orientation={orientation}
          size="hero"
        />
      ) : (
        <HeroPlaceholder label="Legend" />
      )}
      {champion ? (
        <CardTile
          card={champion}
          onHover={onCardHover}
          onSelect={onCardSelect}
          orientation={orientation}
          size="hero"
        />
      ) : (
        <HeroPlaceholder label="Champion" />
      )}
    </aside>
  );
}

function PlayerPileStack({
  onOpenBanished,
  onOpenDiscard,
  orientation,
  player,
}: {
  onOpenBanished: () => void;
  onOpenDiscard: () => void;
  orientation: "top" | "bottom";
  player: ReplayPlayerState;
}) {
  const deck = deckCards(player);
  const discard = discardCards(player);
  const banished = banishedCards(player);
  const deckPile = (
    <div className={styles.deckPileGroup}>
      <CardPile count={deck.length} kind="deck" label="Deck" orientation={orientation} />
      <button
        aria-label={`Open banished cards, ${banished.length} ${banished.length === 1 ? "card" : "cards"}`}
        className={styles.banishedZoneButton}
        data-analysis-drop-player-id={player.id}
        data-analysis-drop-zone="banished"
        data-has-banished={banished.length ? "true" : "false"}
        data-open-banished
        onClick={onOpenBanished}
        type="button"
      >
        <span>Banished</span>
        <b>{banished.length}</b>
      </button>
    </div>
  );
  const discardPile = (
    <CardPile
      card={discard.at(-1)}
      count={discard.length}
      kind="discard"
      label="Trash"
      analysisDropPlayerId={player.id}
      analysisDropZone="discard"
      onClick={onOpenDiscard}
      orientation={orientation}
    />
  );
  return (
    <aside
      aria-label={`${player.name} deck, banished cards, and trash`}
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
  openHands,
  orientation,
  player,
}: {
  inspectedCard: ReplayCardState | null;
  onCardHover: (card: ReplayCardState | null) => void;
  onCardSelect: (card: ReplayCardState) => void;
  openHands: boolean;
  orientation: "top" | "bottom";
  player: ReplayPlayerState;
}) {
  const hand = handCards(player);
  const zones = boardZones(player);
  const handRow = (
    <div
      className={`${styles.handRow} ${orientation === "top" ? styles.handRowTop : styles.handRowBottom}`}
      data-analysis-drop-player-id={player.id}
      data-analysis-drop-zone="hand"
      data-hand-row
    >
      <span className={styles.zoneLabel}>Hand · {hand.length}</span>
      <div className={styles.handCards} data-hand-cards>
        {hand.slice(0, 12).map((card, index) => (
          <CardTile
            card={card}
            forceFaceDown={
              orientation === "top" &&
              !openHands &&
              card.fields.analysisKnowledge !== "future_reveal" &&
              card.fields.analysisStatus !== "what_if"
            }
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
            <div
              className={styles.boardLane}
              data-analysis-drop-player-id={player.id}
              data-analysis-drop-zone={zone.key === "board" ? "base" : zone.key}
              key={zone.key}
            >
              <span className={styles.zoneLabel}>{laneLabel(zone.label, zoneIndex)}</span>
              <div className={styles.laneCards}>
                {groupCardsWithAttachments(zone.cards).slice(0, 9).map((group) => (
                  <AttachedCardGroup
                    group={group}
                    inspectedCard={inspectedCard}
                    key={group.host.id}
                    onHover={onCardHover}
                    onSelect={onCardSelect}
                    orientation={orientation}
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
      data-analysis-drop-player-id={player.id}
      data-analysis-drop-zone="runeArea"
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
  analysisDropPlayerId,
  analysisDropZone,
  card,
  count,
  kind,
  label,
  onClick,
  orientation,
}: {
  analysisDropPlayerId?: string;
  analysisDropZone?: string;
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
      data-analysis-drop-player-id={analysisDropPlayerId}
      data-analysis-drop-zone={analysisDropZone}
      data-open-discard
      onClick={onClick}
      type="button"
    >
      {content}
    </button>
  ) : (
    <div
      aria-label={`${label}, ${count} cards`}
      className={styles.cardPile}
      data-analysis-drop-player-id={analysisDropPlayerId}
      data-analysis-drop-zone={analysisDropZone}
      role="img"
    >
      {content}
    </div>
  );
}

function CardTile({
  atBattlefield = false,
  analysisChainEntryId,
  analysisChainTargetIds,
  card,
  forceFaceDown = false,
  inspected = false,
  onHover,
  onSelect,
  orientation = "bottom",
  size = "board",
  style,
}: {
  atBattlefield?: boolean;
  analysisChainEntryId?: string;
  analysisChainTargetIds?: string[];
  card: ReplayCardState;
  forceFaceDown?: boolean;
  inspected?: boolean;
  onHover?: (card: ReplayCardState | null) => void;
  onSelect?: (card: ReplayCardState) => void;
  orientation?: "top" | "bottom";
  size?: "board" | "hand" | "scene" | "discard" | "hero" | "rune";
  style?: CSSProperties;
}) {
  const analysisInteractions = useContext(ReplayAnalysisInteractionContext);
  const [failedImageKey, setFailedImageKey] = useState("");
  const image = cardImageUrl(card);
  const imageKey = `${card.id}|${image ?? ""}`;
  const imageFailed = failedImageKey === imageKey;
  const hidden = forceFaceDown || card.isPlaceholder;
  const gameplayHidden = !hidden
    && atBattlefield
    && card.fields.hidden === true
    && card.fields.revealedToOpponent !== true;
  const duplicate = !hidden && isDuplicateCard(card);
  const labels = hidden ? [] : customCardLabels(card);
  const whiteCounter = hidden ? undefined : cardCounterValue(card, "whiteCounter");
  const redCounter = hidden ? undefined : cardCounterValue(card, "redCounter");
  const attachmentTargetId = hidden ? undefined : attachedToCardId(card);
  const futureKnown = !hidden && card.fields.analysisKnowledge === "future_reveal";
  const whatIf = !hidden && card.fields.analysisStatus === "what_if";
  const analysisInteractive = Boolean(analysisInteractions?.active && !hidden);
  const analysisDraggable = Boolean(analysisInteractive && !analysisChainEntryId);
  const handleDragStart = (dragEvent: ReactDragEvent<HTMLButtonElement>) => {
    if (!analysisDraggable) {
      dragEvent.preventDefault();
      return;
    }
    dragEvent.dataTransfer.effectAllowed = "move";
    dragEvent.dataTransfer.setData("application/x-riftlite-card", card.id);
    dragEvent.dataTransfer.setData("text/plain", card.id);
    analysisInteractions?.onDragState(card.id);
  };
  const handleContextMenu = (mouseEvent: ReactMouseEvent<HTMLButtonElement>) => {
    if (!analysisInteractive) return;
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();
    analysisInteractions?.onContextMenu(
      card,
      mouseEvent.clientX,
      mouseEvent.clientY,
      analysisChainEntryId,
    );
  };
  return (
    <button
      aria-label={
        hidden
          ? "Hidden card"
          : `${cardName(card)}${gameplayHidden ? ", hidden at battlefield" : ""}${
              futureKnown ? ", known from a later reveal" : ""
            }${whatIf ? ", changed in analysis" : ""}${analysisChainTargetIds?.length
              ? `, ${analysisChainTargetIds.length} ${analysisChainTargetIds.length === 1 ? "target" : "targets"} linked`
              : ""
            }`
      }
      className={`${styles.cardMotion} ${styles[`cardSize${capitalize(size)}`]} ${
        inspected ? styles.inspectedCard : ""
      } ${futureKnown ? styles.futureKnownCard : ""} ${whatIf ? styles.whatIfCard : ""}`}
      data-analysis-card={whatIf ? "what-if" : futureKnown ? "future-known" : undefined}
      data-analysis-chain-entry-id={analysisChainEntryId}
      data-analysis-chain-target-count={analysisChainTargetIds?.length || undefined}
      data-analysis-chain-target-ids={analysisChainTargetIds?.join(" ") || undefined}
      data-analysis-draggable={analysisDraggable ? "true" : undefined}
      data-card-code={hidden ? undefined : card.cardCode}
      data-card-attached-to={attachmentTargetId}
      data-card-duplicate={duplicate ? "true" : undefined}
      data-card-exhausted={card.exhausted ? "true" : "false"}
      data-card-hidden-at-battlefield={gameplayHidden ? "true" : undefined}
      data-card-id={card.id}
      data-card-label-count={labels.length || undefined}
      data-card-red-counter={redCounter !== undefined ? formatCounterValue(redCounter) : undefined}
      data-card-size={size}
      data-card-white-counter={whiteCounter !== undefined ? formatCounterValue(whiteCounter) : undefined}
      data-rune-card={size === "rune" ? "true" : undefined}
      draggable={analysisDraggable}
      onBlur={() => onHover?.(null)}
      onClick={() => { if (!hidden) onSelect?.(card); }}
      onContextMenu={handleContextMenu}
      onDragEnd={() => analysisInteractions?.onDragState(null)}
      onDragStart={handleDragStart}
      onFocus={() => onHover?.(hidden ? null : card)}
      onMouseEnter={() => onHover?.(hidden ? null : card)}
      onMouseLeave={() => onHover?.(null)}
      style={style}
      tabIndex={onHover || onSelect ? undefined : -1}
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
      {gameplayHidden || duplicate || labels.length || futureKnown || whatIf ? (
        <span className={styles.cardTagStack}>
          {whatIf ? <span className={`${styles.duplicateTag} ${styles.whatIfTag}`}>What if</span> : null}
          {futureKnown ? (
            <span className={`${styles.duplicateTag} ${styles.futureKnownTag}`}>Known later</span>
          ) : null}
          {gameplayHidden ? <span className={`${styles.duplicateTag} ${styles.hiddenCardTag}`}>Hidden</span> : null}
          {duplicate ? <span className={styles.duplicateTag}>Duplicate</span> : null}
          {labels.map((label, index) => (
            <span
              className={`${styles.duplicateTag} ${styles.customLabelTag}`}
              data-card-custom-label={label}
              key={`${label}-${index}`}
            >
              {label}
            </span>
          ))}
        </span>
      ) : null}
      {whiteCounter !== undefined || redCounter !== undefined ? (
        <span className={styles.cardCounterStack}>
          {whiteCounter !== undefined ? (
            <span
              aria-label={`White counter ${formatCounterValue(whiteCounter)}`}
              className={`${styles.cardCounterBadge} ${styles.cardCounterWhite}`}
              data-card-counter="white"
            >
              {formatCounterValue(whiteCounter)}
            </span>
          ) : null}
          {redCounter !== undefined ? (
            <span
              aria-label={`Red counter ${formatCounterValue(redCounter)}`}
              className={`${styles.cardCounterBadge} ${styles.cardCounterRed}`}
              data-card-counter="red"
            >
              {formatCounterValue(redCounter)}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

function AttachedCardGroup({
  atBattlefield = false,
  group,
  inspectedCard,
  onHover,
  onSelect,
  orientation,
}: {
  atBattlefield?: boolean;
  group: ReplayAttachedCardGroup;
  inspectedCard: ReplayCardState | null;
  onHover: (card: ReplayCardState | null) => void;
  onSelect: (card: ReplayCardState) => void;
  orientation: "top" | "bottom";
}) {
  if (!group.attachments.length) {
    return (
      <CardTile
        atBattlefield={atBattlefield}
        card={group.host}
        inspected={inspectedCard?.id === group.host.id}
        onHover={onHover}
        onSelect={onSelect}
        orientation={orientation}
        size="board"
      />
    );
  }

  return (
    <span
      className={styles.attachedCardGroup}
      data-card-attachment-group={group.host.id}
      data-attachment-count={group.attachments.length}
      style={{ "--attachment-count": group.attachments.length } as CSSProperties}
    >
      {group.attachments.map((card, index) => (
        <span
          className={styles.attachedCardLayer}
          data-card-attachment-layer="attachment"
          data-attachment-index={index}
          key={card.id}
          style={{ "--attachment-index": index } as CSSProperties}
        >
          <CardTile
            atBattlefield={atBattlefield}
            card={card}
            inspected={inspectedCard?.id === card.id}
            onHover={onHover}
            onSelect={onSelect}
            orientation={orientation}
            size="board"
          />
        </span>
      ))}
      <span className={styles.attachedCardLayer} data-card-attachment-layer="host">
        <CardTile
          atBattlefield={atBattlefield}
          card={group.host}
          inspected={inspectedCard?.id === group.host.id}
          onHover={onHover}
          onSelect={onSelect}
          orientation={orientation}
          size="board"
        />
      </span>
    </span>
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
  // TCGA's B1/B2 zones are relative to each card owner: B1 is that
  // player's selected battlefield and B2 is their opponent's. Canonical
  // Atlas lanes are already physical, so only TCGA needs per-player keys.
  const tcgaOwnerRelativeLanes = [players.bottom, players.top].some((player) => {
    const provider = player.fields.provider ?? player.boardFields.provider;
    return typeof provider === "string" && provider.trim().toLowerCase() === "tcga";
  });
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
      bottomCardZone: tcgaOwnerRelativeLanes ? "battlefieldA" : bottomZone,
      topCardZone: tcgaOwnerRelativeLanes ? "battlefieldB" : bottomZone,
    },
    {
      battlefield: battlefields[1],
      flipped: true,
      key: topZone,
      label: "Opponent's battlefield",
      owner: players.top,
      bottomCardZone: tcgaOwnerRelativeLanes ? "battlefieldB" : topZone,
      topCardZone: tcgaOwnerRelativeLanes ? "battlefieldA" : topZone,
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
              cards={zoneCards(players.top, [lane.topCardZone])}
              onCardHover={onCardHover}
              onCardSelect={onCardSelect}
              orientation="top"
              playerId={players.top.id}
              zone={lane.topCardZone}
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
              cards={zoneCards(players.bottom, [lane.bottomCardZone])}
              onCardHover={onCardHover}
              onCardSelect={onCardSelect}
              orientation="bottom"
              playerId={players.bottom.id}
              zone={lane.bottomCardZone}
            />
        </section>
      ))}
      {chain.length ? (
        <div className={styles.chainLane}>
          <span className={styles.centralLabel}>Chain</span>
          <div className={styles.chainEntries}>
            {chain.slice(-5).map((entry, index) => {
              const card = cardFromChain(entry, index);
              const analysisChainTargetIds = jsonStringList(
                entry.fields.analysisTargetCardIds,
              );
              return card ? (
                <CardTile
                  analysisChainEntryId={entry.id}
                  analysisChainTargetIds={analysisChainTargetIds}
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
  playerId,
  zone,
}: {
  cards: ReplayCardState[];
  onCardHover: (card: ReplayCardState | null) => void;
  onCardSelect: (card: ReplayCardState) => void;
  orientation: "top" | "bottom";
  playerId: string;
  zone: string;
}) {
  return (
    <div
      className={`${styles.battlefieldUnitRow} ${
        orientation === "top" ? styles.battlefieldUnitRowTop : styles.battlefieldUnitRowBottom
      }`}
      data-analysis-drop-player-id={playerId}
      data-analysis-drop-zone={zone}
      data-battlefield-unit-row={orientation}
    >
      {groupCardsWithAttachments(cards).slice(0, 7).map((group) => (
        <AttachedCardGroup
          atBattlefield
          group={group}
          inspectedCard={null}
          key={group.host.id}
          onHover={onCardHover}
          onSelect={onCardSelect}
          orientation={orientation}
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

type TargetArrow = {
  analysis: boolean;
  fromX: number;
  fromY: number;
  id: string;
  toX: number;
  toY: number;
};

function TargetArrowLayer({ arrows }: { arrows: TargetArrow[] }) {
  if (!arrows.length) return null;
  return (
    <svg aria-hidden="true" className={styles.targetArrows} viewBox="0 0 1590 962">
      <defs>
        <marker id="replay-arrow-head" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
          <path d="M0 0 L8 4 L0 8 Z" fill="currentColor" />
        </marker>
        <marker
          id="replay-analysis-arrow-head"
          markerHeight="8"
          markerWidth="8"
          orient="auto"
          refX="7"
          refY="4"
        >
          <path d="M0 0 L8 4 L0 8 Z" fill="#cf8cff" />
        </marker>
      </defs>
      {arrows.map((arrow) => {
        const curve = Math.max(24, Math.abs(arrow.toX - arrow.fromX) * 0.18);
        return (
          <path
            className={arrow.analysis ? styles.analysisTargetArrow : undefined}
            data-analysis-target-arrow={arrow.analysis ? "true" : undefined}
            d={`M ${arrow.fromX} ${arrow.fromY} C ${arrow.fromX} ${arrow.fromY - curve}, ${arrow.toX} ${arrow.toY - curve}, ${arrow.toX} ${arrow.toY}`}
            key={arrow.id}
            markerEnd={`url(#${
              arrow.analysis ? "replay-analysis-arrow-head" : "replay-arrow-head"
            })`}
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
  speed,
  state,
}: {
  battlefields: Array<ReplayCardState | undefined>;
  currentMs: number;
  playing: boolean;
  players: ReplayPlayerPair;
  replay: CanonicalReplayV2;
  scene: Exclude<ReplaySceneKind, null>;
  speed: PlaybackSpeed;
  state: ReplayState;
}) {
  const game = gameForState(replay, state);
  const openHands = isConsentedDualPerspectiveReplay(replay);
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
    case "first_player":
      content = (
        <div className={styles.sceneColumn}>
          <SceneHeading eyebrow={`Game ${game?.gameNumber ?? 1}`} title="First player" />
          <div className={styles.firstPlayerScene} data-first-player-scene>
            <MiniPortrait
              card={firstPlayer ? legendCard(firstPlayer) : undefined}
              fallback={firstPlayer?.name ?? "?"}
            />
            <Icon name="spark" />
            <strong>{firstPlayer?.name ?? "First player resolving"}</strong>
            <span>{firstPlayer ? "will take the first action" : "The choice was recorded without a public die roll."}</span>
          </div>
        </div>
      );
      break;
    case "mulligan": {
      const transitions = game
        ? mulliganHandTransitions(replay, game, players)
        : {
            bottom: unavailableMulliganTransition(handCards(players.bottom)),
            top: unavailableMulliganTransition(handCards(players.top)),
          };
      content = (
        <div className={styles.sceneColumn}>
          <SceneHeading
            eyebrow={`Game ${game?.gameNumber ?? 1}`}
            title="Mulligan"
          />
          <div className={styles.openingHands}>
            <MulliganSceneHand
              faceDown={!openHands}
              label={players.top.name}
              playerId={players.top.id}
              speed={speed}
              transition={transitions.top}
            />
            <div className={styles.handDivider}>Replace · Redraw · Keep</div>
            <MulliganSceneHand
              label={players.bottom.name}
              playerId={players.bottom.id}
              speed={speed}
              transition={transitions.bottom}
            />
          </div>
        </div>
      );
      break;
    }
    case "opening":
      content = (
        <div className={styles.sceneColumn}>
          <SceneHeading eyebrow={`Game ${game?.gameNumber ?? 1}`} title="Opening hands" />
          <div className={styles.openingHands}>
            <SceneHand faceDown={!openHands} label={players.top.name} player={players.top} />
            <div className={styles.handDivider}>Ready</div>
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
    case "sideboarding": {
      const transition = game
        ? sideboardTransitionForGame(replay, game, players.bottom)
        : unavailableSideboardTransition(players.bottom.name);
      const opponentTransition = openHands && game
        ? sideboardTransitionForGame(replay, game, players.top, players.top.id)
        : undefined;
      content = (
        <div className={styles.sceneColumn}>
          <SceneHeading
            eyebrow={`${replay.series.bestOf === 3 || replay.series.format === "bo3" ? "Best of 3 · " : ""}Game ${game?.gameNumber ?? 1}`}
            title="Sideboarding"
          />
          <SideboardingScene
            opponentName={players.top.name}
            opponentTransition={opponentTransition}
            speed={speed}
            transition={transition}
          />
        </div>
      );
      break;
    }
    case "game_transition": {
      const targetGameNumber = nextGame?.gameNumber ?? (game?.gameNumber ?? 1) + 1;
      const seriesScore = seriesScoreBeforeGame(replay, nextGame?.ordinal ?? targetGameNumber, players);
      content = (
        <div
          className={styles.gameTransition}
          data-series-score={seriesScore.available ? `${seriesScore.bottom}-${seriesScore.top}` : "unknown"}
          data-series-transition
        >
          <div className={styles.seriesIdentity}>
            <span>{replay.series.bestOf === 3 || replay.series.format === "bo3" ? "Best of 3" : "Match"}</span>
            <b>Game {targetGameNumber}</b>
          </div>
          <small>{winner ? `${winner.name} wins Game ${game?.gameNumber ?? ""}` : "Game complete"}</small>
          <strong>GAME {targetGameNumber}</strong>
          <SeriesScore players={players} score={seriesScore} />
        </div>
      );
      break;
    }
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

function SideboardingScene({
  opponentName,
  opponentTransition,
  speed,
  transition,
}: {
  opponentName: string;
  opponentTransition?: SideboardTransition;
  speed: PlaybackSpeed;
  transition: SideboardTransition;
}) {
  const combined = Boolean(opponentTransition);
  return (
    <div
      className={`${styles.sideboardingScene} ${combined ? styles.combinedSideboardingScene : ""}`}
      data-sideboard-action-index={transition.actionIndex}
      data-sideboard-mode={combined ? "open-hands" : "perspective"}
      data-sideboard-status={transition.status}
      style={{
        "--sideboard-duration": `${2_100 / speed}ms`,
      } as CSSProperties}
    >
      <SideboardTransitionRow compact={combined} speed={speed} transition={transition} />
      {opponentTransition ? (
        <SideboardTransitionRow compact speed={speed} transition={opponentTransition} />
      ) : (
        <div className={styles.opponentSideboardLocked} data-opponent-sideboard="locked">
          <Icon name="lock" />
          <div><b>{opponentName}</b><span>Opponent sideboard choices stay hidden</span></div>
        </div>
      )}
    </div>
  );
}

function SideboardTransitionRow({
  compact,
  speed,
  transition,
}: {
  compact: boolean;
  speed: PlaybackSpeed;
  transition: SideboardTransition;
}) {
  const outgoingCount = transition.outgoing.reduce((total, entry) => total + entry.count, 0);
  const incomingCount = transition.incoming.reduce((total, entry) => total + entry.count, 0);
  const noChanges = transition.status === "exact" && !outgoingCount && !incomingCount;
  return (
    <div
      className={styles.sideboardPlayerTransition}
      data-sideboard-player-action-index={transition.actionIndex}
      data-sideboard-player={transition.playerName}
      data-sideboard-player-status={transition.status}
    >
      <section className={`${styles.sideboardChangePanel} ${styles.sideboardOutPanel}`}>
        <header><span>Out</span><b>{outgoingCount}</b></header>
        <div className={styles.sideboardCardRow}>
          {transition.outgoing.map((entry, index) => (
            <SideboardDeltaCard
              compact={compact}
              direction="out"
              entry={entry}
              index={index}
              key={`out-${entry.card.id}`}
              speed={speed}
            />
          ))}
          {transition.status === "unavailable" ? <em>Previous deck list unavailable</em> : null}
          {noChanges ? <em>No cards moved out</em> : null}
        </div>
      </section>
      <div className={styles.sideboardSwapSummary}>
        <Icon name="swap" />
        <strong>{noChanges ? "No changes" : `${Math.max(outgoingCount, incomingCount)} swapped`}</strong>
        <span>{transition.playerName}</span>
      </div>
      <section className={`${styles.sideboardChangePanel} ${styles.sideboardInPanel}`}>
        <header><span>In</span><b>{incomingCount}</b></header>
        <div className={styles.sideboardCardRow}>
          {transition.incoming.map((entry, index) => (
            <SideboardDeltaCard
              compact={compact}
              direction="in"
              entry={entry}
              index={index}
              key={`in-${entry.card.id}`}
              speed={speed}
            />
          ))}
          {transition.status === "unavailable" ? <em>Submitted cards could not be compared</em> : null}
          {noChanges ? <em>No cards moved in</em> : null}
        </div>
      </section>
    </div>
  );
}

function SideboardDeltaCard({
  compact,
  direction,
  entry,
  index,
  speed,
}: {
  compact: boolean;
  direction: "in" | "out";
  entry: SideboardCardQuantity;
  index: number;
  speed: PlaybackSpeed;
}) {
  return (
    <span
      className={`${direction === "out" ? styles.sideboardCardOut : styles.sideboardCardIn} ${
        compact ? styles.sideboardCardCompact : ""
      }`}
      data-sideboard-card={direction}
      style={{ "--sideboard-delay": `${(index * 85) / speed}ms` } as CSSProperties}
    >
      <CardTile card={entry.card} size={compact ? "board" : "scene"} />
      {entry.count > 1 ? <i data-sideboard-quantity={entry.count}>×{entry.count}</i> : null}
    </span>
  );
}

function SeriesScore({
  players,
  score,
}: {
  players: ReplayPlayerPair;
  score: ReplaySeriesScore;
}) {
  return (
    <div className={styles.seriesScore} data-series-scoreboard>
      <span>{players.bottom.name}</span>
      <b data-series-score-bottom>{score.available ? score.bottom : "—"}</b>
      <i>–</i>
      <b data-series-score-top>{score.available ? score.top : "—"}</b>
      <span>{players.top.name}</span>
      <small>{score.available ? "Series score" : "Series score unavailable"}</small>
    </div>
  );
}

function MulliganSceneHand({
  faceDown = false,
  label,
  playerId,
  speed,
  transition,
}: {
  faceDown?: boolean;
  label: string;
  playerId: string;
  speed: PlaybackSpeed;
  transition: MulliganHandTransition;
}) {
  const detailsAvailable = transition.detailLevel !== "unavailable";
  const cardIdentitiesAvailable = transition.detailLevel !== "count_unresolved" && detailsAvailable;
  const status = detailsAvailable
    ? transition.replacementCount
      ? `${transition.replacementCount} ${transition.replacementCount === 1 ? "card" : "cards"} replaced`
      : "Opening hand kept"
    : "Replacement details unavailable";
  const slots: MulliganCardSlot[] = detailsAvailable
    ? transition.slots
    : transition.cards.map((card) => ({ kept: card }));

  return (
    <section
      className={styles.mulliganHand}
      data-mulligan-details={transition.detailLevel}
      data-mulligan-player={playerId}
      style={{
        "--mulligan-duration": `${2_050 / speed}ms`,
        "--mulligan-short-duration": `${1_550 / speed}ms`,
      } as CSSProperties}
    >
      <header>
        <span>{label} · {transition.cards.length} cards</span>
        <b>{status}</b>
      </header>
      <div className={styles.mulliganCards}>
        {slots.map((slot, index) => (
          <span
            className={`${styles.mulliganCardSlot} ${
              cardIdentitiesAvailable ? "" : styles.mulliganCardUnresolved
            }`}
            data-mulligan-slot={slot.leaving || slot.entering ? "replacement" : "kept"}
            key={`${slot.kept?.id ?? slot.leaving?.id ?? "empty"}|${slot.entering?.id ?? index}`}
            style={{ "--mulligan-delay": `${(index * 75) / speed}ms` } as CSSProperties}
          >
            {slot.kept ? (
              <span className={styles.mulliganCardKept} data-mulligan-card="kept">
                <CardTile card={slot.kept} forceFaceDown={faceDown} size="scene" />
                {cardIdentitiesAvailable ? <i>Kept</i> : null}
              </span>
            ) : null}
            {slot.leaving ? (
              <span aria-hidden="true" className={styles.mulliganCardLeaving} data-mulligan-card="leaving">
                <CardTile card={slot.leaving} forceFaceDown={faceDown} size="scene" />
                <i>Out</i>
              </span>
            ) : null}
            {slot.entering ? (
              <span className={styles.mulliganCardEntering} data-mulligan-card="entering">
                <CardTile card={slot.entering} forceFaceDown={faceDown} size="scene" />
                <i>New</i>
              </span>
            ) : null}
          </span>
        ))}
        {!slots.length ? <em>Hand data is not available at this frame.</em> : null}
        {!cardIdentitiesAvailable && slots.length ? (
          <span className={styles.mulliganUnknownBadge}>
            <Icon name="swap" />
            {detailsAvailable ? "Replacement identities unavailable" : "Hand shuffled"}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function mulliganHandTransitions(
  replay: CanonicalReplayV2,
  game: CanonicalReplayV2["series"]["games"][number],
  players: ReplayPlayerPair,
): { bottom: MulliganHandTransition; top: MulliganHandTransition } {
  const fallback = {
    bottom: unavailableMulliganTransition(handCards(players.bottom)),
    top: unavailableMulliganTransition(handCards(players.top)),
  };
  const phase = game.phases.find((segment) => segment.phase === "mulligan");
  if (!phase) return fallback;

  const openingIndex = presentationOpeningEventIndex(replay, game);
  try {
    const openingState = seekReplayByEventIndex(replay, openingIndex).state;
    return {
      bottom: transitionFromMulliganAction(
        replay,
        game,
        players.bottom.id,
        handCards(openingState.players[players.bottom.id] ?? players.bottom),
      ),
      top: transitionFromMulliganAction(
        replay,
        game,
        players.top.id,
        handCards(openingState.players[players.top.id] ?? players.top),
      ),
    };
  } catch {
    return fallback;
  }
}

function transitionFromMulliganAction(
  replay: CanonicalReplayV2,
  game: CanonicalReplayV2["series"]["games"][number],
  playerId: string,
  openingCards: ReplayCardState[],
): MulliganHandTransition {
  const actionEvent = replay.events
    .filter((event) => (
      event.index >= game.eventStartIndex &&
      event.index <= game.eventEndIndex &&
      event.gameId === game.id &&
      event.kind === "action" &&
      event.actorPlayerId === playerId &&
      isSubmitMulliganAction(event)
    ))
    .at(-1);
  if (!actionEvent || actionEvent.kind !== "action") {
    const redrawCount = loggedMulliganRedrawCount(replay, game, playerId);
    if (redrawCount !== undefined) {
      return unresolvedCountMulliganTransition(openingCards, redrawCount);
    }
    return unavailableMulliganTransition(openingCards);
  }

  const beforeState = seekReplayByEventIndex(replay, Math.max(game.eventStartIndex, actionEvent.index - 1)).state;
  const afterState = seekReplayByEventIndex(replay, actionEvent.index).state;
  const beforePlayer = beforeState.players[playerId];
  const afterPlayer = afterState.players[playerId];
  const before = (beforePlayer ? handCards(beforePlayer) : openingCards).slice(0, 8);
  const after = (afterPlayer ? handCards(afterPlayer) : before).slice(0, 8);
  const playback = mulliganPlaybackForPlayer(actionEvent, playerId);
  const actionCardIds = stringArray(actionEvent.action.cardIds);
  const removedIds = actionEvent.patch.operations.flatMap((operation) => {
    if (operation.op === "zone_remove" && operation.playerId === playerId && isHandZone(operation.zone)) {
      return operation.cardIds;
    }
    if (operation.op === "zone_move" && operation.from.playerId === playerId && isHandZone(operation.from.zone)) {
      return [operation.cardId];
    }
    return [];
  });
  const selectedIds = actionCardIds.length ? actionCardIds : removedIds;
  const replacementCount = playback.redrawCount ?? selectedIds.length;
  if (!replacementCount) {
    return {
      cards: before,
      detailLevel: playback.redrawCount !== undefined || Array.isArray(actionEvent.action.cardIds)
        ? "exact"
        : "count",
      replacementCount: 0,
      slots: before.map((card) => ({ kept: card })),
    };
  }

  const insertedCards = actionEvent.patch.operations.flatMap((operation) => {
    if (operation.op === "zone_insert" && operation.playerId === playerId && isHandZone(operation.zone)) {
      return operation.cards;
    }
    if (
      operation.op === "zone_move" &&
      operation.to.playerId === playerId &&
      isHandZone(operation.to.zone) &&
      operation.card
    ) {
      return [operation.card];
    }
    return [];
  });
  const refillCards = playback.refillCardIds.length
    ? playback.refillCardIds
        .map((id) => insertedCards.find((card) => card.id === id))
        .filter((card): card is ReplayCardState => Boolean(card))
    : insertedCards.length === replacementCount
      ? insertedCards
      : [];
  const outgoingCards = selectedIds
    .map((id) => before.find((card) => card.id === id))
    .filter((card): card is ReplayCardState => Boolean(card));
  const exact = (
    selectedIds.length === replacementCount &&
    outgoingCards.length === replacementCount &&
    refillCards.length === replacementCount
  );
  if (exact) {
    const selectedIdSet = new Set(selectedIds);
    const incoming = [...refillCards];
    const slots = before.map((card): MulliganCardSlot => {
      if (!selectedIdSet.has(card.id)) return { kept: card };
      return { leaving: card, entering: incoming.shift() };
    });
    incoming.forEach((card) => slots.push({ entering: card }));
    const shownIds = new Set(slots.flatMap((slot) => [slot.kept?.id, slot.entering?.id].filter(Boolean)));
    const shownCards = after.filter((card) => shownIds.has(card.id));
    return {
      cards: shownCards.length ? shownCards : slots.flatMap((slot) => slot.entering ?? slot.kept ?? []),
      detailLevel: "exact",
      replacementCount,
      slots,
    };
  }

  return countOnlyMulliganTransition(before.length ? before : openingCards, after, replacementCount, playerId);
}

function unavailableMulliganTransition(cards: ReplayCardState[]): MulliganHandTransition {
  return {
    cards: cards.slice(0, 8),
    detailLevel: "unavailable",
    replacementCount: 0,
    slots: [],
  };
}

function unresolvedCountMulliganTransition(
  cards: ReplayCardState[],
  replacementCount: number,
): MulliganHandTransition {
  const finalHand = cards.slice(0, 8);
  return {
    cards: finalHand,
    detailLevel: "count_unresolved",
    replacementCount: Math.max(0, Math.min(8, replacementCount)),
    slots: finalHand.map((card) => ({ kept: card })),
  };
}

function loggedMulliganRedrawCount(
  replay: CanonicalReplayV2,
  game: CanonicalReplayV2["series"]["games"][number],
  playerId: string,
): number | undefined {
  let completed = false;
  let redrawCount: number | undefined;
  for (const event of replay.events) {
    if (
      event.index < game.eventStartIndex ||
      event.index > game.eventEndIndex ||
      event.gameId !== game.id ||
      event.kind !== "log"
    ) continue;
    for (const entry of event.entries) {
      if (entry.authorPlayerId !== playerId) continue;
      if (entry.fields.mulliganCompleted === true) completed = true;
      const count = entry.fields.mulliganRedrawCount;
      if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
        redrawCount = Math.trunc(count);
      }
    }
  }
  return redrawCount ?? (completed ? 0 : undefined);
}

function countOnlyMulliganTransition(
  beforeCards: ReplayCardState[],
  afterCards: ReplayCardState[],
  replacementCount: number,
  playerId: string,
): MulliganHandTransition {
  const before = beforeCards.slice(0, 8);
  const after = afterCards.slice(0, 8);
  const count = Math.max(0, Math.min(8, replacementCount));
  const leaving = before.slice(0, count);
  while (leaving.length < count) leaving.push(mulliganCardBack(`${playerId}-out-${leaving.length}`));
  const entering = after.slice(0, count);
  while (entering.length < count) entering.push(mulliganCardBack(`${playerId}-in-${entering.length}`));
  const slots: MulliganCardSlot[] = before.slice(count).map((card) => ({ kept: card }));
  leaving.forEach((card, index) => slots.push({ leaving: card, entering: entering[index] }));
  return {
    cards: before.length ? before : after.slice(0, Math.max(count, after.length)),
    detailLevel: "count",
    replacementCount: count,
    slots,
  };
}

function mulliganPlaybackForPlayer(
  event: Extract<ReplayEvent, { kind: "action" }>,
  playerId: string,
): { redrawCount?: number; refillCardIds: string[] } {
  for (const operation of event.patch.operations) {
    if (operation.op !== "set_room_fields") continue;
    const byPlayer = operation.fields.mulliganPlaybackByPlayerId;
    if (!byPlayer || typeof byPlayer !== "object" || Array.isArray(byPlayer)) continue;
    const player = byPlayer[playerId];
    if (!player || typeof player !== "object" || Array.isArray(player)) continue;
    const redrawCount = typeof player.redrawCount === "number" && Number.isFinite(player.redrawCount)
      ? Math.max(0, Math.trunc(player.redrawCount))
      : undefined;
    const refillCardIds = Array.isArray(player.draws)
      ? player.draws.flatMap((draw) => {
          if (!draw || typeof draw !== "object" || Array.isArray(draw)) return [];
          return draw.kind === "refill" && typeof draw.cardId === "string" ? [draw.cardId] : [];
        })
      : [];
    return { redrawCount, refillCardIds };
  }
  return { refillCardIds: [] };
}

function isSubmitMulliganAction(event: Extract<ReplayEvent, { kind: "action" }>): boolean {
  const nestedType = typeof event.action.type === "string" ? event.action.type : "";
  return `${event.actionType} ${nestedType}`.toLowerCase().replace(/[^a-z]/g, "").includes("submitmulligan");
}

function isHandZone(zone: string): boolean {
  return zone.toLowerCase().replace(/[^a-z0-9]/g, "").includes("hand");
}

function stringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function mulliganCardBack(id: string): ReplayCardState {
  return {
    id: `mulligan-${id}`,
    name: "Hidden card",
    isPlaceholder: true,
    source: "hand",
    fields: { isPlaceholder: true, source: "hand" },
  };
}

function sideboardTransitionForGame(
  replay: CanonicalReplayV2,
  game: CanonicalReplayV2["series"]["games"][number],
  fallbackPlayer: ReplayPlayerState,
  explicitPlayerId?: string,
): SideboardTransition {
  const playerId = explicitPlayerId ?? replay.series.perspectivePlayerId;
  if (!playerId) return unavailableSideboardTransition(fallbackPlayer.name);
  const action = sideboardSubmitActionForPlayer(replay, game, playerId);
  if (!action) return unavailableSideboardTransition(fallbackPlayer.name);

  try {
    const previousState = seekReplayByEventIndex(
      replay,
      Math.max(game.eventStartIndex, action.index - 1),
    ).state;
    const player = previousState.players[playerId] ?? fallbackPlayer;
    const previousDeck = sideboardDeckListFromPlayer(player);
    const submittedDeck = sideboardDeckListFromAction(action);
    if (!previousDeck || !submittedDeck) {
      return unavailableSideboardTransition(player.name, action.index);
    }

    const mainChanges = compareDeckQuantities(previousDeck.mainDeck, submittedDeck.mainDeck);
    const sideChanges = compareDeckQuantities(previousDeck.sideboard, submittedDeck.sideboard);
    return {
      actionIndex: action.index,
      incoming: enrichSideboardDeltas(mainChanges.increased, sideChanges.decreased),
      outgoing: enrichSideboardDeltas(mainChanges.decreased, sideChanges.increased),
      playerName: player.name,
      status: "exact",
    };
  } catch {
    return unavailableSideboardTransition(fallbackPlayer.name, action.index);
  }
}

function unavailableSideboardTransition(playerName: string, actionIndex?: number): SideboardTransition {
  return {
    ...(actionIndex !== undefined ? { actionIndex } : {}),
    incoming: [],
    outgoing: [],
    playerName,
    status: "unavailable",
  };
}

function sideboardDeckListFromPlayer(player: ReplayPlayerState): SideboardDeckList | undefined {
  for (const key of ["submittedDeck", "deck", "registeredDeck"]) {
    const deck = player.fields[key];
    if (!isJsonObject(deck) || !isJsonObject(deck.sections)) continue;
    const mainDeck = jsonObjectValueByNormalizedKey(deck.sections, ["maindeck", "main"]);
    const sideboard = jsonObjectValueByNormalizedKey(deck.sections, ["sideboard"]);
    if (mainDeck === undefined || sideboard === undefined) continue;
    const mainCards = sideboardCardQuantities(mainDeck, `${player.id}-${key}-main`);
    if (!mainCards.length) continue;
    return {
      mainDeck: mainCards,
      sideboard: sideboardCardQuantities(sideboard, `${player.id}-${key}-side`),
    };
  }
  return undefined;
}

function sideboardDeckListFromAction(
  action: Extract<ReplayEvent, { kind: "action" }>,
): SideboardDeckList | undefined {
  if (action.action.mainDeck === undefined || action.action.sideboard === undefined) return undefined;
  const mainDeck = sideboardCardQuantities(action.action.mainDeck, `${action.id}-main`);
  if (!mainDeck.length) return undefined;
  return {
    mainDeck,
    sideboard: sideboardCardQuantities(action.action.sideboard, `${action.id}-side`),
  };
}

function sideboardCardQuantities(value: JsonValue, idPrefix: string): SideboardCardQuantity[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => sideboardCardQuantities(entry, `${idPrefix}-${index}`));
  }
  if (!isJsonObject(value)) return [];
  const name = firstText(value.name, value.cardName, value.title, value.label);
  const code = firstText(value.cardCode, value.code, value.card_id);
  if (name || code) {
    const rawCount = looseNumber(value.count ?? value.quantity ?? value.copies) ?? 1;
    const count = Math.max(0, Math.trunc(rawCount));
    if (!count) return [];
    return [{
      card: {
        id: `${idPrefix}-${normalizeSideboardKey(code || name || "card")}`,
        name: name || code || "Unknown card",
        ...(code ? { cardCode: code } : {}),
        source: "mainDeck",
        fields: { ...value, source: "mainDeck" },
      },
      count,
    }];
  }
  return Object.entries(value).flatMap(([key, entry]) => {
    if (typeof entry === "number" && entry > 0) {
      const code = /[a-z]{3}-\d{3}/i.test(key) ? key : undefined;
      return [{
        card: {
          id: `${idPrefix}-${normalizeSideboardKey(key)}`,
          name: key,
          ...(code ? { cardCode: code } : {}),
          source: "mainDeck",
          fields: { count: entry, source: "mainDeck" },
        },
        count: Math.trunc(entry),
      }];
    }
    return sideboardCardQuantities(entry, `${idPrefix}-${normalizeSideboardKey(key)}`);
  });
}

function compareDeckQuantities(
  before: SideboardCardQuantity[],
  after: SideboardCardQuantity[],
): { decreased: SideboardCardQuantity[]; increased: SideboardCardQuantity[] } {
  const previous = aggregateSideboardQuantities(before);
  const submitted = aggregateSideboardQuantities(after);
  const matchedSubmitted = new Set<number>();
  const decreased: SideboardCardQuantity[] = [];
  const increased: SideboardCardQuantity[] = [];

  for (const previousEntry of previous) {
    const matchIndex = submitted.findIndex((entry, index) => (
      !matchedSubmitted.has(index) && sideboardCardsMatch(previousEntry.card, entry.card)
    ));
    const submittedEntry = matchIndex >= 0 ? submitted[matchIndex] : undefined;
    if (matchIndex >= 0) matchedSubmitted.add(matchIndex);
    const delta = (submittedEntry?.count ?? 0) - previousEntry.count;
    if (delta < 0) decreased.push({ card: previousEntry.card, count: -delta });
    if (delta > 0 && submittedEntry) increased.push({ card: submittedEntry.card, count: delta });
  }
  submitted.forEach((entry, index) => {
    if (!matchedSubmitted.has(index)) increased.push(entry);
  });
  return { decreased, increased };
}

function aggregateSideboardQuantities(entries: SideboardCardQuantity[]): SideboardCardQuantity[] {
  const aggregated: SideboardCardQuantity[] = [];
  for (const entry of entries) {
    const existing = aggregated.find((candidate) => sideboardCardsMatch(candidate.card, entry.card));
    if (existing) existing.count += entry.count;
    else aggregated.push({ card: entry.card, count: entry.count });
  }
  return aggregated;
}

function enrichSideboardDeltas(
  mainChanges: SideboardCardQuantity[],
  matchingSideChanges: SideboardCardQuantity[],
): SideboardCardQuantity[] {
  return mainChanges.map((entry) => {
    const sideEntry = matchingSideChanges.find((candidate) => sideboardCardsMatch(entry.card, candidate.card));
    const card = sideEntry && !entry.card.cardCode && sideEntry.card.cardCode
      ? { ...entry.card, cardCode: sideEntry.card.cardCode }
      : entry.card;
    return { card, count: entry.count };
  });
}

function sideboardCardsMatch(left: ReplayCardState, right: ReplayCardState): boolean {
  return cardsShareCanonicalIdentity(left, right);
}

function jsonObjectValueByNormalizedKey(
  object: JsonObject,
  candidates: string[],
): JsonValue | undefined {
  const accepted = new Set(candidates.map(normalizeSideboardKey));
  return Object.entries(object).find(([key]) => accepted.has(normalizeSideboardKey(key)))?.[1];
}

function normalizeSideboardKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSubmitSideboardAction(event: Extract<ReplayEvent, { kind: "action" }>): boolean {
  const nestedType = typeof event.action.type === "string" ? event.action.type : "";
  return `${event.actionType} ${nestedType}`.toLowerCase().replace(/[^a-z]/g, "").includes("submitsideboard");
}

function seriesScoreBeforeGame(
  replay: CanonicalReplayV2,
  targetOrdinal: number,
  players: ReplayPlayerPair,
): ReplaySeriesScore {
  const completedGames = replay.series.games.filter((game) => game.ordinal < targetOrdinal);
  if (!completedGames.length) return { available: true, bottom: 0, top: 0 };
  const bottomId = replay.series.perspectivePlayerId ?? players.bottom.id;
  let bottom = 0;
  let top = 0;
  for (const game of completedGames) {
    const winnerId = game.result?.winnerPlayerId ?? (
      game.result?.loserPlayerId === bottomId
        ? players.top.id
        : game.result?.loserPlayerId === players.top.id
          ? bottomId
          : undefined
    );
    if (!winnerId) return { available: false, bottom: 0, top: 0 };
    if (winnerId === bottomId) bottom += 1;
    else if (winnerId === players.top.id) top += 1;
    else return { available: false, bottom: 0, top: 0 };
  }
  return { available: true, bottom, top };
}

function HoverCardPreview({
  besideDiscard,
  card,
}: {
  besideDiscard: boolean;
  card: ReplayCardState;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const image = cardImageUrl(card);
  if (!image || imageFailed || card.isPlaceholder) return null;

  const battlefield = isBattlefieldCard(card);
  const labels = customCardLabels(card);
  const whiteCounter = cardCounterValue(card, "whiteCounter");
  const redCounter = cardCounterValue(card, "redCounter");
  return (
    <figure
      aria-hidden="true"
      className={`${styles.hoverCardPreview} ${
        battlefield ? styles.hoverCardPreviewBattlefield : ""
      } ${besideDiscard ? styles.hoverCardPreviewBesideDiscard : ""}`}
      data-hover-battlefield={battlefield ? "true" : undefined}
      data-hover-card-code={card.cardCode}
      data-hover-card-name={cardName(card)}
      data-hover-card-preview
    >
      <span className={styles.hoverCardPreviewFrame}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" draggable={false} onError={() => setImageFailed(true)} src={image} />
      </span>
      {isDuplicateCard(card) || labels.length ? (
        <span className={styles.hoverCardTagStack}>
          {isDuplicateCard(card) ? <span className={styles.hoverDuplicateTag}>Duplicate</span> : null}
          {labels.map((label, index) => (
            <span
              className={`${styles.hoverDuplicateTag} ${styles.hoverCustomLabelTag}`}
              data-hover-card-custom-label={label}
              key={`${label}-${index}`}
            >
              {label}
            </span>
          ))}
        </span>
      ) : null}
      {whiteCounter !== undefined || redCounter !== undefined ? (
        <span className={styles.hoverCardCounterStack}>
          {whiteCounter !== undefined ? (
            <span
              className={`${styles.hoverCardCounterBadge} ${styles.cardCounterWhite}`}
              data-hover-card-counter="white"
            >
              {formatCounterValue(whiteCounter)}
            </span>
          ) : null}
          {redCounter !== undefined ? (
            <span
              className={`${styles.hoverCardCounterBadge} ${styles.cardCounterRed}`}
              data-hover-card-counter="red"
            >
              {formatCounterValue(redCounter)}
            </span>
          ) : null}
        </span>
      ) : null}
    </figure>
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

function ReplayAnalysisPanel({
  attachmentCardId,
  onAdjustCounter,
  onAdjustScore,
  onAddToChain,
  onAttach,
  onCancelAttach,
  onCancelTarget,
  onDetach,
  onExit,
  onMove,
  onRedo,
  onReset,
  onRestore,
  onToggleExhausted,
  onUndo,
  replay,
  selectedCardId,
  session,
  targetChainEntryId,
}: {
  attachmentCardId: string | null;
  onAdjustCounter: (cardId: string, field: ReplayAnalysisCounterField, delta: number) => void;
  onAdjustScore: (playerId: string, delta: number) => void;
  onAddToChain: (cardId: string) => void;
  onAttach: (cardId: string) => void;
  onCancelAttach: () => void;
  onCancelTarget: () => void;
  onDetach: (cardId: string) => void;
  onExit: () => void;
  onMove: (cardId: string, zone: string) => void;
  onRedo: () => void;
  onReset: () => void;
  onRestore: (cardId: string) => void;
  onToggleExhausted: (cardId: string) => void;
  onUndo: () => void;
  replay: CanonicalReplayV2;
  selectedCardId: string | null;
  session: ReplayAnalysisSession;
  targetChainEntryId: string | null;
}) {
  const selectedCard = replayAnalysisSelectedCard(session.state, selectedCardId);
  const selectedPlayer = selectedCard
    ? replayAnalysisCardPlayer(session.state, selectedCard.id)
    : null;
  const selectedLocation = selectedCard
    ? replayAnalysisCardLocation(session.state, selectedCard.id)
    : null;
  const players = resolveReplayPlayers(replay, session.state);
  const changedCards = replayAnalysisChangedCardCount(session.state);
  const anchorTurn = session.state.room.turnNumber;
  const selectedWhite = selectedCard
    ? cardCounterValue(selectedCard, "whiteCounter")
    : undefined;
  const selectedRed = selectedCard
    ? cardCounterValue(selectedCard, "redCounter")
    : undefined;

  return (
    <aside
      aria-label="Replay analysis controls"
      className={styles.analysisPanel}
      data-analysis-panel
    >
      <header className={styles.analysisPanelHeader}>
        <div className={styles.analysisPanelTitle}>
          <span className={styles.analysisPanelMark}><Icon name="spark" /></span>
          <div>
            <span>Replay analysis</span>
            <h2>What-if branch</h2>
          </div>
        </div>
        <button aria-label="Return to original replay" onClick={onExit} type="button">
          <Icon name="close" />
        </button>
      </header>

      <div className={styles.analysisSummary}>
        <div><span>Anchor</span><b>Turn {anchorTurn ?? "—"}</b></div>
        <div><span>Known later</span><b>{session.inferredCardIds.length}</b></div>
        <div><span>Changed cards</span><b>{changedCards}</b></div>
      </div>

      {attachmentCardId ? (
        <div className={styles.analysisAttachNotice} role="status">
          <Icon name="combine" />
          <div>
            <b>Select an attachment target</b>
            <span>Choose another face-up card on the board.</span>
          </div>
          <button onClick={onCancelAttach} type="button">Cancel</button>
        </div>
      ) : null}

      {targetChainEntryId ? (
        <div
          className={`${styles.analysisAttachNotice} ${styles.analysisTargetNotice}`}
          role="status"
        >
          <Icon name="target" />
          <div>
            <b>Select a chain target</b>
            <span>Choose a face-up card or a battlefield to draw an arrow.</span>
          </div>
          <button onClick={onCancelTarget} type="button">Cancel</button>
        </div>
      ) : null}

      <div className={styles.analysisPanelBody}>
        {selectedCard && selectedPlayer ? (
          <>
            <section className={styles.analysisSelectedCard}>
              <MiniPortrait card={selectedCard} fallback={cardName(selectedCard)} />
              <div>
                <span>Selected · {selectedPlayer.name} · {analysisZoneLabel(selectedLocation?.zone)}</span>
                <b>{cardName(selectedCard)}</b>
                <small>{selectedCard.cardCode ?? "No card code"}</small>
              </div>
              {selectedCard.fields.analysisKnowledge === "future_reveal" ? (
                <em>Known later</em>
              ) : null}
            </section>

            <section className={styles.analysisControlSection}>
              <header><span>Move card</span><small>Changes are temporary</small></header>
              <div className={styles.analysisDestinationGrid}>
                {REPLAY_ANALYSIS_DESTINATIONS.map((destination) => (
                  <button
                    disabled={
                      !selectedPlayer ||
                      !replayAnalysisCanMove(
                        session.state,
                        selectedCard.id,
                        selectedPlayer.id,
                        destination.zone,
                      )
                    }
                    key={destination.zone}
                    onClick={() => onMove(selectedCard.id, destination.zone)}
                    type="button"
                  >
                    {destination.label}
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.analysisControlSection}>
              <header><span>Card state</span><small>Branch only</small></header>
              <button
                className={styles.analysisWideAction}
                onClick={() => onToggleExhausted(selectedCard.id)}
                type="button"
              >
                <Icon name="swap" /> {selectedCard.exhausted ? "Ready card" : "Exhaust card"}
              </button>
              <button
                className={styles.analysisWideAction}
                disabled={!replayAnalysisCanAddToChain(session.state, selectedCard.id)}
                onClick={() => onAddToChain(selectedCard.id)}
                type="button"
              >
                <Icon name="chain" /> Add to chain
              </button>
              <AnalysisCounterControl
                label="White"
                onChange={(delta) => onAdjustCounter(selectedCard.id, "whiteCounter", delta)}
                value={selectedWhite}
              />
              <AnalysisCounterControl
                label="Red"
                onChange={(delta) => onAdjustCounter(selectedCard.id, "redCounter", delta)}
                value={selectedRed}
              />
              <button
                className={styles.analysisWideAction}
                onClick={() => onAttach(selectedCard.id)}
                type="button"
              >
                <Icon name="combine" /> Attach to another card
              </button>
              {attachedToCardId(selectedCard) ? (
                <button
                  className={styles.analysisWideAction}
                  onClick={() => onDetach(selectedCard.id)}
                  type="button"
                >
                  <Icon name="unlink" /> Detach card
                </button>
              ) : null}
              {selectedCard.fields.analysisStatus === "what_if" ? (
                <button
                  className={styles.analysisWideAction}
                  onClick={() => onRestore(selectedCard.id)}
                  type="button"
                >
                  <Icon name="rewind" /> Restore card to branch start
                </button>
              ) : null}
            </section>
          </>
        ) : (
          <section className={styles.analysisEmptySelection}>
            <Icon name="card" />
            <b>Select a face-up card</b>
            <p>Drag cards between glowing zones, or right-click any known card for quick actions.</p>
          </section>
        )}

        <section className={styles.analysisControlSection}>
          <header><span>Points</span><small>Explore scoring lines</small></header>
          {[players.top, players.bottom].map((player) => {
            const score = player.score ??
              looseNumber(player.boardFields.score) ??
              looseNumber(player.fields.score) ??
              0;
            return (
              <div className={styles.analysisScoreControl} key={player.id}>
                <span>{player.name}</span>
                <button
                  aria-label={`Remove one point from ${player.name}`}
                  onClick={() => onAdjustScore(player.id, -1)}
                  type="button"
                >−</button>
                <b>{score}</b>
                <button
                  aria-label={`Add one point to ${player.name}`}
                  onClick={() => onAdjustScore(player.id, 1)}
                  type="button"
                >+</button>
              </div>
            );
          })}
        </section>
      </div>

      <footer className={styles.analysisPanelFooter}>
        <button disabled={!session.history.length} onClick={onUndo} type="button">
          <Icon name="rewind" /> Undo
        </button>
        <button disabled={!session.future.length} onClick={onRedo} type="button">
          <Icon name="forward" /> Redo
        </button>
        <button onClick={onReset} type="button"><Icon name="skipStart" /> Reset branch</button>
        <button className={styles.analysisReturnButton} onClick={onExit} type="button">
          Return to replay
        </button>
      </footer>
    </aside>
  );
}

function AnalysisCounterControl({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (delta: number) => void;
  value: number | null | undefined;
}) {
  return (
    <div className={styles.analysisCounterControl}>
      <span>{label} counters</span>
      <button aria-label={`Remove ${label.toLowerCase()} counter`} onClick={() => onChange(-1)} type="button">−</button>
      <b>{value ?? 0}</b>
      <button aria-label={`Add ${label.toLowerCase()} counter`} onClick={() => onChange(1)} type="button">+</button>
    </div>
  );
}

function analysisZoneLabel(zone: string | undefined): string {
  if (!zone) return "Unknown zone";
  const normalized = zone.toLowerCase().replace(/[^a-z0-9]/g, "");
  const destination = REPLAY_ANALYSIS_DESTINATIONS.find((candidate) => (
    candidate.zone.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized
  ));
  if (destination) return destination.label;
  if (["board"].includes(normalized)) return "Base";
  if (["trash", "graveyard", "recycle", "recyclepile"].includes(normalized)) return "Trash";
  if (["banish", "exile", "exiled", "removed", "removedfromgame"].includes(normalized)) {
    return "Banished";
  }
  return zone;
}

function ReplayAnalysisContextMenu({
  canAddToChain,
  canMove,
  card,
  chainEntryId,
  chainTargetCount,
  onAddToChain,
  onAdjustCounter,
  onAttach,
  onClearChainTargets,
  onClose,
  onDetach,
  onMove,
  onRemoveFromChain,
  onRestore,
  onSetChainTarget,
  onToggleExhausted,
  position,
}: {
  canAddToChain: boolean;
  canMove: (zone: string) => boolean;
  card: ReplayCardState;
  chainEntryId?: string;
  chainTargetCount: number;
  onAddToChain: () => void;
  onAdjustCounter: (field: ReplayAnalysisCounterField, delta: number) => void;
  onAttach: () => void;
  onClearChainTargets: () => void;
  onClose: () => void;
  onDetach: () => void;
  onMove: (zone: string) => void;
  onRemoveFromChain: () => void;
  onRestore: () => void;
  onSetChainTarget: () => void;
  onToggleExhausted: () => void;
  position: NonNullable<ReplayAnalysisContextMenuState>;
}) {
  const whiteCounter = cardCounterValue(card, "whiteCounter") ?? 0;
  const redCounter = cardCounterValue(card, "redCounter") ?? 0;
  if (chainEntryId) {
    return (
      <div
        aria-label={`${cardName(card)} actions`}
        className={styles.analysisContextMenu}
        data-analysis-context-menu
        onContextMenu={(mouseEvent) => mouseEvent.preventDefault()}
        onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
        role="menu"
        style={{ left: position.x, top: position.y }}
      >
        <header>
          <div>
            <span>What-if chain card</span>
            <b>{cardName(card)}</b>
            {chainTargetCount ? (
              <small>{chainTargetCount} {chainTargetCount === 1 ? "target" : "targets"} linked</small>
            ) : null}
          </div>
          <button aria-label="Close card actions" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <button
          className={styles.analysisContextWideAction}
          onClick={onSetChainTarget}
          role="menuitem"
          type="button"
        >
          <Icon name="target" /> {chainTargetCount ? "Add another target" : "Add target arrow"}
        </button>
        {chainTargetCount ? (
          <button
            className={styles.analysisContextWideAction}
            onClick={onClearChainTargets}
            role="menuitem"
            type="button"
          >
            <Icon name="unlink" /> Clear target {chainTargetCount === 1 ? "arrow" : "arrows"}
          </button>
        ) : null}
        <button
          className={styles.analysisContextWideAction}
          onClick={onRemoveFromChain}
          role="menuitem"
          type="button"
        >
          <Icon name="chain" /> Return card from chain
        </button>
      </div>
    );
  }
  return (
    <div
      aria-label={`${cardName(card)} actions`}
      className={styles.analysisContextMenu}
      data-analysis-context-menu
      onContextMenu={(mouseEvent) => mouseEvent.preventDefault()}
      onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
      role="menu"
      style={{ left: position.x, top: position.y }}
    >
      <header>
        <div>
          <span>What-if card</span>
          <b>{cardName(card)}</b>
        </div>
        <button aria-label="Close card actions" onClick={onClose} type="button">
          <Icon name="close" />
        </button>
      </header>
      <button
        className={styles.analysisContextWideAction}
        disabled={!canAddToChain}
        onClick={onAddToChain}
        role="menuitem"
        type="button"
      >
        <Icon name="chain" /> Add to chain
      </button>
      <button
        className={styles.analysisContextWideAction}
        onClick={onToggleExhausted}
        role="menuitem"
        type="button"
      >
        <Icon name="swap" /> {card.exhausted ? "Ready card" : "Exhaust card"}
      </button>
      <div className={styles.analysisContextCounters}>
        <span>White</span>
        <button
          aria-label="Remove white counter"
          onClick={() => onAdjustCounter("whiteCounter", -1)}
          type="button"
        >âˆ’</button>
        <b>{whiteCounter}</b>
        <button
          aria-label="Add white counter"
          onClick={() => onAdjustCounter("whiteCounter", 1)}
          type="button"
        >+</button>
        <span>Red</span>
        <button
          aria-label="Remove red counter"
          onClick={() => onAdjustCounter("redCounter", -1)}
          type="button"
        >âˆ’</button>
        <b>{redCounter}</b>
        <button
          aria-label="Add red counter"
          onClick={() => onAdjustCounter("redCounter", 1)}
          type="button"
        >+</button>
      </div>
      <button
        className={styles.analysisContextWideAction}
        onClick={onAttach}
        role="menuitem"
        type="button"
      >
        <Icon name="combine" /> Attach to another card
      </button>
      {attachedToCardId(card) ? (
        <button
          className={styles.analysisContextWideAction}
          onClick={onDetach}
          role="menuitem"
          type="button"
        >
          <Icon name="unlink" /> Detach card
        </button>
      ) : null}
      {card.fields.analysisStatus === "what_if" ? (
        <button
          className={styles.analysisContextWideAction}
          onClick={onRestore}
          role="menuitem"
          type="button"
        >
          <Icon name="rewind" /> Restore to branch start
        </button>
      ) : null}
      <section>
        <span>Play or move to</span>
        <div>
          {REPLAY_ANALYSIS_DESTINATIONS.map((destination) => (
            <button
              disabled={!canMove(destination.zone)}
              key={destination.zone}
              onClick={() => onMove(destination.zone)}
              role="menuitem"
              type="button"
            >
              {destination.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function TransportControls({
  analysisActive,
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
  onToggleAnalysis,
  onTogglePlayback,
  playing,
  presentationFrame,
  replay,
  showMore,
  speed,
  state,
  turns,
}: {
  analysisActive: boolean;
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
  onToggleAnalysis: () => void;
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
        <button className={styles.speedControl} data-control="speed" onClick={() => onChangeSpeed(nextPlaybackSpeed(speed))} type="button">
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
        <button
          aria-pressed={analysisActive}
          className={`${styles.analysisToggleButton} ${
            analysisActive ? styles.analysisToggleButtonActive : ""
          }`}
          data-control="analysis"
          onClick={onToggleAnalysis}
          type="button"
        >
          <Icon name="spark" /> {analysisActive ? "Return to replay" : "Take control"}
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

function BanishedOverlay({
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
        aria-label={`${playerName} banished cards`}
        aria-modal="true"
        className={`${styles.discardModal} ${styles.banishedModal}`}
        data-banished-overlay
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <span>Banished zone</span>
            <h2>{playerName} &middot; Banished</h2>
            <p>{cards.length} {cards.length === 1 ? "card" : "cards"} at this frame</p>
          </div>
          <IconButton label="Close banished cards" name="close" onClick={onClose} />
        </header>
        <div className={styles.discardGrid}>
          {cards.map((card) => (
            <CardTile card={card} key={card.id} onHover={onCardHover} onSelect={onCardSelect} size="discard" />
          ))}
          {!cards.length ? (
            <div className={`${styles.emptyDiscard} ${styles.emptyBanished}`}>
              <Icon name="spark" />
              <span>No cards are banished</span>
            </div>
          ) : null}
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
    ["1 / 2 / 4 / 6 / 0", "Set playback speed (0 selects 10×)"],
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
        if (!sourceId) continue;
        const source = elementFor(sourceId);
        if (!source) continue;
        const canonicalTargetId = fieldIdentifier(
          entry.fields,
          ["targetCardId", "targetId", "target", "recipientCardId"],
        );
        const analysisTargetIds = entry.fields.analysisStatus === "what_if"
          ? jsonStringList(entry.fields.analysisTargetCardIds)
          : [];
        const targetIds = [...new Set([
          ...(canonicalTargetId ? [canonicalTargetId] : []),
          ...analysisTargetIds,
        ])];
        const from = source.getBoundingClientRect();
        for (const targetId of targetIds) {
          const target = elementFor(targetId);
          if (!target) continue;
          const to = target.getBoundingClientRect();
          next.push({
            analysis: analysisTargetIds.includes(targetId),
            id: `${entry.id}:${targetId}`,
            fromX: (from.left + from.width / 2 - rootBounds.left) / scale,
            fromY: (from.top + from.height / 2 - rootBounds.top) / scale,
            toX: (to.left + to.width / 2 - rootBounds.left) / scale,
            toY: (to.top + to.height / 2 - rootBounds.top) / scale,
          });
        }
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

function preludeStagesForGame(
  replay: CanonicalReplayV2,
  gameIndex: number,
): Array<Exclude<ReplaySceneKind, null>> {
  if (gameIndex <= 0) return FIRST_GAME_PRELUDE;
  const game = replay.series.games[gameIndex];
  if (!game) return ["game_transition", "game_start"];
  const phases = new Set(game.phases.map((phase) => phase.phase));
  const stages: Array<Exclude<ReplaySceneKind, null>> = ["game_transition"];
  if (phases.has("sideboarding") || perspectiveSideboardSubmitAction(replay, game)) {
    stages.push("sideboarding");
  }
  stages.push("matchup");
  if (phases.has("battlefield_pick")) stages.push("battlefields");
  if (phases.has("initiative_roll")) stages.push("initiative");
  else if (phases.has("first_player_choice")) stages.push("first_player");
  if (phases.has("mulligan")) stages.push("opening", "mulligan");
  stages.push("game_start");
  return stages;
}

function perspectiveSideboardSubmitAction(
  replay: CanonicalReplayV2,
  game: CanonicalReplayV2["series"]["games"][number],
): Extract<ReplayEvent, { kind: "action" }> | undefined {
  const perspectivePlayerId = replay.series.perspectivePlayerId;
  if (!perspectivePlayerId) return undefined;
  return sideboardSubmitActionForPlayer(replay, game, perspectivePlayerId);
}

function sideboardSubmitActionForPlayer(
  replay: CanonicalReplayV2,
  game: CanonicalReplayV2["series"]["games"][number],
  playerId: string,
): Extract<ReplayEvent, { kind: "action" }> | undefined {
  return replay.events
    .filter((event): event is Extract<ReplayEvent, { kind: "action" }> => (
      event.kind === "action" &&
      event.index >= game.eventStartIndex &&
      event.index <= game.eventEndIndex &&
      (event.gameId === game.id || event.gameId === null) &&
      event.actorPlayerId === playerId &&
      isSubmitSideboardAction(event)
    ))
    .at(-1);
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
  if (stage === "sideboarding") {
    const action = perspectiveSideboardSubmitAction(replay, game);
    if (action) return action.index;
    const phase = game.phases.find((candidate) => candidate.phase === "sideboarding");
    return Math.max(0, Math.min(replay.events.length - 1, phase?.endEventIndex ?? game.eventStartIndex));
  }
  if (stage === "first_player") {
    const phase = game.phases.find((candidate) => candidate.phase === "first_player_choice");
    return Math.max(0, Math.min(replay.events.length - 1, phase?.endEventIndex ?? game.eventStartIndex));
  }
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

  return Math.max(0, Math.min(replay.events.length - 1, game.eventStartIndex));
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
  const inGame = game.phases.find((phase) => phase.phase === "in_game");
  const firstInGameSnapshot = inGame
    ? replay.events.find((event) => event.index >= inGame.startEventIndex && event.kind === "snapshot")
    : undefined;
  const end = Math.min(
    game.eventEndIndex,
    Math.max(mulligan.endEventIndex, firstInGameSnapshot?.index ?? mulligan.endEventIndex),
  );
  const requireBothHands = isConsentedDualPerspectiveReplay(replay);
  let anyHandIndex: number | undefined;
  for (let index = start; index <= end; index += 1) {
    try {
      const state = seekReplayByEventIndex(replay, index).state;
      const players = resolveReplayPlayers(replay, state);
      const perspectiveHandAvailable = handCards(players.bottom).length > 0;
      const opponentHandAvailable = handCards(players.top).length > 0;
      if (perspectiveHandAvailable && (!requireBothHands || opponentHandAvailable)) return index;
      if (anyHandIndex === undefined && (perspectiveHandAvailable || opponentHandAvailable)) {
        anyHandIndex = index;
      }
    } catch {
      // Keep looking for the first projectable opening-hand state.
    }
  }
  return Math.max(0, Math.min(replay.events.length - 1, anyHandIndex ?? end));
}

function presentationStageLabel(stage: Exclude<ReplaySceneKind, null>): string {
  const labels: Record<Exclude<ReplaySceneKind, null>, string> = {
    matchup: "Matchup",
    battlefields: "Selected battlefields",
    initiative: "Initiative",
    first_player: "First player",
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
  const cardFields = isJsonObject(record.fields) ? record.fields : {};
  const name = firstText(record.name, record.cardName, record.title, fields.label, fields.actionType);
  const code = firstText(record.cardCode, record.code, record.cardId);
  if (!name && !code) return undefined;
  return {
    id: firstText(record.instanceId, record.cardInstanceId, record.id) || entry.id || `chain-${index}`,
    name: name || code || "Chain action",
    cardCode: code,
    exhausted: record.exhausted === true,
    isPlaceholder: record.isPlaceholder === true,
    ownerPlayerId: firstText(record.ownerPlayerId),
    source: firstText(record.source) || "chain",
    fields: { ...record, ...cardFields },
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

function jsonStringList(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(
    (candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()),
  ))];
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

function formatCounterValue(value: number | null): string {
  return value === null ? "?" : String(value);
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
  | "chain"
  | "chat"
  | "close"
  | "combine"
  | "forward"
  | "fullscreen"
  | "help"
  | "keyboard"
  | "list"
  | "lock"
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
  | "target"
  | "trash"
  | "unlink";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    battlefield: <><path d="M4 7h16v10H4z" /><path d="m7 14 3-3 2 2 2-2 3 3" /></>,
    camera: <><path d="M4 7h3l2-2h6l2 2h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></>,
    card: <><rect height="18" rx="2" width="13" x="5.5" y="3" /><path d="m8 16 3-4 2 2 3-4" /></>,
    chain: <><path d="M10 13a5 5 0 0 0 7.1.1l1.4-1.4a5 5 0 0 0-7.1-7.1L10.6 5.4" /><path d="M14 11a5 5 0 0 0-7.1-.1l-1.4 1.4a5 5 0 0 0 7.1 7.1l.8-.8" /></>,
    chat: <path d="M4 5h16v11H9l-5 4z" />,
    close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
    combine: <><circle cx="8" cy="12" r="5" /><circle cx="16" cy="12" r="5" /><path d="M10.5 8.2a5 5 0 0 1 0 7.6M13.5 8.2a5 5 0 0 0 0 7.6" /></>,
    forward: <><path d="m13 7 5 5-5 5" /><path d="M6 7v10" /></>,
    fullscreen: <><path d="M8 4H4v4" /><path d="M16 4h4v4" /><path d="M20 16v4h-4" /><path d="M4 16v4h4" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.2 2.3c-.7.3-1 .8-1 1.7" /><path d="M12 17h.01" /></>,
    keyboard: <><rect height="14" rx="2" width="20" x="2" y="5" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M7 13h10" /></>,
    list: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
    lock: <><rect height="10" rx="2" width="14" x="5" y="10" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
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
    target: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
    trash: <><path d="M4 7h16" /><path d="m9 7 1-3h4l1 3M7 7l1 13h8l1-13" /></>,
    unlink: <><path d="m9.5 14.5-1 1a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0" /><path d="m14.5 9.5 1-1a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" /><path d="m8 4 8 16" /></>,
  };
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{paths[name]}</g>
    </svg>
  );
}
