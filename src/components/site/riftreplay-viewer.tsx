"use client";

import {
  Activity,
  AlertTriangle,
  Clock3,
  Download,
  FileJson,
  KeyRound,
  Layers3,
  Pause,
  Play,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Swords,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { parseRiftReplayInput, parseRiftReplayPayload } from "@/lib/riftreplay/parse";
import type { ReplayCard, ReplayFrame, ReplayPlayer, ReplayRoomState, ReplayTimelineEvent, ReplayZone, RiftReplayViewModel } from "@/lib/riftreplay/types";
import { cn } from "@/lib/utils";

type RiftReplayViewerProps = {
  fullScreen?: boolean;
  initialReplayId?: string;
};

const DEFAULT_ENDPOINT = "https://riftreplay.com";

type ReplayIntroKind = "matchup" | "battlefields" | "initiative" | "mulligan" | "openingHands";

type ReplayPlaybackItem =
  | {
      id: string;
      kind: ReplayIntroKind;
      label: string;
      packetType: "intro";
      frame?: ReplayFrame;
      event?: ReplayTimelineEvent;
    }
  | {
      id: string;
      kind: "board";
      label: string;
      packetType: string;
      frame: ReplayFrame;
      event: ReplayTimelineEvent | null;
    };

export function RiftReplayViewer({ fullScreen = false, initialReplayId = "" }: RiftReplayViewerProps) {
  const [rawText, setRawText] = useState("");
  const [replayId, setReplayId] = useState(initialReplayId);
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [model, setModel] = useState<RiftReplayViewModel | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const playbackItems = useMemo(() => (model ? buildPlaybackItems(model) : []), [model]);
  const selectedItem = playbackItems[Math.min(selectedIndex, Math.max(0, playbackItems.length - 1))] ?? null;
  const selectedEvent = selectedItem?.event ?? null;
  const selectedFrame = selectedItem?.frame ?? null;
  const sortedPacketCounts = useMemo(() => {
    if (!model) return [];
    return Object.entries(model.packetCounts).sort((a, b) => b[1] - a[1]);
  }, [model]);

  useEffect(() => {
    if (!playing || !playbackItems.length) return;
    const id = window.setInterval(() => {
      setSelectedIndex((current) => {
        if (current >= playbackItems.length - 1) {
          window.clearInterval(id);
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, selectedItem?.kind === "board" ? 760 : 1850);
    return () => window.clearInterval(id);
  }, [playbackItems.length, playing, selectedItem?.kind]);

  useEffect(() => {
    if (!initialReplayId.trim()) return;
    void fetchHostedReplay(initialReplayId.trim());
    // Only auto-load the route replay once. Manual reloads still use the buttons/inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReplayId]);

  function loadFromText(text = rawText) {
    setError("");
    try {
      const nextModel = parseRiftReplayInput(text);
      setModel(nextModel);
      setSelectedIndex(0);
      setPlaying(false);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  }

  async function loadFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setRawText(text);
    loadFromText(text);
  }

  async function fetchExternalReplay() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/riftreplay/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replayId, apiKey, endpoint }),
      });
      const data = (await response.json()) as { payload?: unknown; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Could not fetch replay.");
      }
      const nextModel = parseRiftReplayPayload(data.payload);
      setRawText(JSON.stringify(data.payload, null, 2));
      setModel(nextModel);
      setSelectedIndex(0);
      setPlaying(false);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }

  async function fetchHostedReplay(id = replayId) {
    const trimmedId = id.trim();
    if (!trimmedId) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/replay/${encodeURIComponent(trimmedId)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as { payload?: unknown; metadata?: { title?: string }; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Could not load RiftLite replay.");
      }
      const nextModel = parseRiftReplayPayload(data.payload);
      setReplayId(trimmedId);
      setRawText(JSON.stringify(data.payload, null, 2));
      setModel({
        ...nextModel,
        title: data.metadata?.title || nextModel.title,
      });
      setSelectedIndex(0);
      setPlaying(false);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn(fullScreen ? "h-full overflow-hidden" : "space-y-8")}>
      {!model ? (
        <Card className={cn("overflow-hidden border-cyan-300/15 bg-[linear-gradient(145deg,rgba(89,167,255,0.12),rgba(166,124,255,0.1)),rgba(8,13,30,0.9)]", fullScreen && "m-3 h-[calc(100%-1.5rem)] overflow-y-auto")}>
          <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div className="space-y-5">
              <Badge>RiftReplay Lab</Badge>
              <div className="space-y-3">
                <h1 className="max-w-4xl text-4xl font-bold tracking-tight text-white md:text-5xl">
                  Web replay review for raw Atlas captures.
                </h1>
                <p className="max-w-3xl text-base leading-7 text-slate-300">
                  Load a RiftLite raw capture or a private RiftReplay export, then inspect the room,
                  timeline, players, zones, cards, and diagnostics in a replay-first layout.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <HeroMetric icon={<ShieldCheck className="h-4 w-4" />} label="Private by default" value="Local parse" />
                <HeroMetric icon={<Activity className="h-4 w-4" />} label="Frame source" value="Atlas WS" />
                <HeroMetric icon={<Layers3 className="h-4 w-4" />} label="Replay style" value="Timeline + zones" />
              </div>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-slate-950/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="grid gap-3 text-sm text-slate-300">
                <ImportRow icon={<Upload className="h-4 w-4 text-cyan-200" />} title="Import file">
                  <input
                    accept=".json,.txt,.riftreplay,application/json"
                    className="w-full cursor-pointer rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300 file:mr-3 file:rounded-full file:border-0 file:bg-cyan-300/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-cyan-100"
                    onChange={(event) => void loadFile(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </ImportRow>
                <ImportRow icon={<FileJson className="h-4 w-4 text-cyan-200" />} title="Paste raw capture">
                  <textarea
                    className="min-h-28 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-xs text-slate-300 outline-none transition focus:border-cyan-300/50"
                    onChange={(event) => setRawText(event.target.value)}
                    placeholder='Paste a riftreplay-raw-capture JSON payload...'
                    value={rawText}
                  />
                  <Button className="mt-2 w-full" disabled={!rawText.trim()} onClick={() => loadFromText()} size="sm">
                    <Play className="h-4 w-4" />
                    Load pasted replay
                  </Button>
                </ImportRow>
                <ImportRow icon={<KeyRound className="h-4 w-4 text-cyan-200" />} title="Load private RiftReplay ID">
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                    <input
                      className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300/50"
                      onChange={(event) => setReplayId(event.target.value)}
                      placeholder="rp_..."
                      value={replayId}
                    />
                    <input
                      className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300/50"
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder="API key"
                      type="password"
                      value={apiKey}
                    />
                  </div>
                  <input
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300/50"
                    onChange={(event) => setEndpoint(event.target.value)}
                    placeholder="https://riftreplay.com"
                    value={endpoint}
                  />
                  <Button className="mt-2 w-full" disabled={!replayId.trim() || !apiKey.trim() || loading} onClick={() => void fetchExternalReplay()} size="sm">
                    <Download className="h-4 w-4" />
                    {loading ? "Fetching..." : "Fetch replay"}
                  </Button>
                  <Button className="mt-2 w-full" disabled={!replayId.trim() || loading} onClick={() => void fetchHostedReplay()} size="sm" variant="secondary">
                    <Download className="h-4 w-4" />
                    Load RiftLite hosted replay
                  </Button>
                </ImportRow>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {error ? (
        <div className="flex items-start gap-3 rounded-3xl border border-rose-300/25 bg-rose-500/10 p-4 text-sm text-rose-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{error}</div>
        </div>
      ) : null}

      {model ? (
        <div className={cn(fullScreen ? "h-full overflow-hidden p-2" : "space-y-6")}>
          <ReplayPlaybackShell
            event={selectedEvent}
            frame={selectedFrame}
            fullScreen={fullScreen}
            model={model}
            onSelect={setSelectedIndex}
            packetCounts={sortedPacketCounts}
            playbackItems={playbackItems}
            playing={playing}
            selectedItem={selectedItem}
            selectedIndex={selectedIndex}
            setPlaying={setPlaying}
          />
        </div>
      ) : (
        <EmptyReplayState />
      )}
    </div>
  );
}

function HeroMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-cyan-200">
        {icon}
        {label}
      </div>
      <div className="mt-2 font-display text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function ImportRow({ children, icon, title }: { children: React.ReactNode; icon: React.ReactNode; title: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function ReplaySummary({ model }: { model: RiftReplayViewModel }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      <SummaryCard label="Replay" value={model.title} sub={model.source === "raw-capture" ? "Raw capture" : "Translated replay"} />
      <SummaryCard label="Room" value={model.roomCode || "Unknown"} sub={model.captureSessionId || "No session id"} />
      <SummaryCard label="Messages" value={model.messageCount.toLocaleString()} sub={`${model.timeline.length.toLocaleString()} timeline rows`} />
      <SummaryCard label="Last state" value={model.lastPhase || "Unknown"} sub={model.lastGameNumber ? `Game ${model.lastGameNumber}` : model.matchFormat || "No format"} />
      <SummaryCard label="Duration" value={formatDuration(model.startedAt, model.endedAt)} sub={formatDateRange(model.startedAt, model.endedAt)} />
    </div>
  );
}

function SummaryCard({ label, sub, value }: { label: string; sub?: string; value: string }) {
  return (
    <Card className="rounded-3xl p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-2 truncate font-display text-lg font-semibold text-white" title={value}>
        {value}
      </div>
      {sub ? <div className="mt-1 truncate text-xs text-slate-400">{sub}</div> : null}
    </Card>
  );
}

function ReplayPlaybackShell({
  event,
  frame,
  fullScreen,
  model,
  onSelect,
  packetCounts,
  playbackItems,
  playing,
  selectedItem,
  selectedIndex,
  setPlaying,
}: {
  event: ReplayTimelineEvent | null;
  frame: ReplayFrame | null;
  fullScreen?: boolean;
  model: RiftReplayViewModel;
  onSelect: (index: number) => void;
  packetCounts: [string, number][];
  playbackItems: ReplayPlaybackItem[];
  playing: boolean;
  selectedItem: ReplayPlaybackItem | null;
  selectedIndex: number;
  setPlaying: (playing: boolean) => void;
}) {
  const [hoveredCard, setHoveredCard] = useState<ReplayCard | null>(null);
  const maxIndex = Math.max(0, playbackItems.length - 1);
  const introCount = playbackItems.findIndex((item) => item.kind === "board");
  const boardStartIndex = introCount < 0 ? 0 : introCount;
  const selectedCard = frame && event?.cardName ? findCardInFrame(frame, event.cardName) : null;
  const focusCard = hoveredCard ?? selectedCard ?? null;
  const inIntro = selectedIndex < boardStartIndex;

  function jump(delta: number) {
    onSelect(Math.min(maxIndex, Math.max(0, selectedIndex + delta)));
  }

  function rewind() {
    jump(inIntro ? -1 : -10);
  }

  function fastForward() {
    jump(inIntro ? 1 : 10);
  }

  return (
    <Card className={cn("overflow-hidden rounded-[20px] border-cyan-300/15 bg-[#090d14] p-0 shadow-2xl", fullScreen && "h-full")}>
      <div className={cn("grid overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]", fullScreen ? "h-full min-h-0" : "h-[calc(100vh-84px)] min-h-[720px] max-h-[1040px]")}>
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-white/[0.08]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-white/[0.025] px-4 py-2">
            <div className="min-w-0">
              <div className="truncate font-display text-xl font-bold text-white">{model.title}</div>
              <div className="truncate text-xs text-slate-400">
                {model.roomCode ? `Room ${model.roomCode}` : "Atlas capture"} · {model.matchFormat || "Replay"} · {model.frames.length.toLocaleString()} frames
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={rewind} size="sm" variant="secondary">
                <SkipBack className="h-4 w-4" />
                Rewind
              </Button>
              <Button onClick={() => setPlaying(!playing)} size="sm">
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {playing ? "Pause" : "Play"}
              </Button>
              <Button onClick={fastForward} size="sm" variant="secondary">
                <SkipForward className="h-4 w-4" />
                Fast forward
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 bg-[radial-gradient(circle_at_50%_15%,rgba(34,211,238,0.12),transparent_30%),linear-gradient(180deg,#0a1019,#05070b)] p-1.5">
            {selectedItem?.kind && selectedItem.kind !== "board" ? (
              <ReplayIntroStage item={selectedItem} model={model} onFocusCard={setHoveredCard} />
            ) : frame ? (
              <ReplayBoardCanvas frame={frame} onFocusCard={setHoveredCard} />
            ) : (
              <NoFrameState />
            )}
          </div>

          <div className="border-t border-white/[0.08] bg-slate-950/85 px-4 py-2">
            <div className="flex items-center gap-3">
              <div className="w-14 text-right font-mono text-xs text-cyan-200">{selectedIndex + 1}</div>
              <input
                aria-label="Replay frame"
                className="h-2 min-w-0 flex-1 cursor-pointer accent-cyan-300"
                max={maxIndex}
                min={0}
                onChange={(inputEvent) => onSelect(Number(inputEvent.target.value))}
                type="range"
                value={Math.min(selectedIndex, maxIndex)}
              />
              <div className="w-16 font-mono text-xs text-slate-400">{playbackItems.length}</div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
              <span className="truncate">{selectedItem?.label || frame?.label || "No frame selected"}</span>
              <span className="shrink-0">{formatEventTime(frame?.ts)}</span>
            </div>
          </div>
        </div>

        <aside className="grid min-h-0 grid-rows-[auto_minmax(0,44%)_minmax(0,1fr)] overflow-hidden bg-[#10131a]">
          <div className="min-h-0 overflow-hidden border-b border-white/[0.08] p-2.5">
            <div className="font-display text-lg font-bold text-white">RiftLite Replay</div>
            <div className="truncate text-xs text-slate-400">{model.title}</div>
          </div>
          <div className="min-h-0 overflow-hidden border-b border-white/[0.08] p-3">
            {focusCard ? (
              <FocusedCard card={focusCard} />
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">
                Select a card event to focus it here.
              </div>
            )}
          </div>
          <EventRail
            events={model.timeline}
            onSelect={(eventIndex) => onSelect(Math.min(maxIndex, boardStartIndex + eventIndex))}
            selectedIndex={Math.max(0, selectedIndex - boardStartIndex)}
          />
        </aside>
      </div>
    </Card>
  );
}

function buildPlaybackItems(model: RiftReplayViewModel): ReplayPlaybackItem[] {
  const handFrame = findFrameWithVisibleHand(model.frames, 4) ?? findFrameWithZone(model.frames, ["hand"]) ?? model.frames[0];
  const battlefieldFrame = findFrameWithBattlefields(model.frames) ?? model.frames[0];
  const initiativeFrame = findFrameWithRolls(model.frames) ?? battlefieldFrame;
  const mulliganFrame = findFrameWithMulligan(model.frames, handFrame) ?? handFrame;
  const introEvents = model.timeline.filter((event) => shouldShowReplayEvent(event));
  const eventById = new Map(model.timeline.map((event) => [event.id, event]));
  const boardFrames = model.frames.filter((frame, index) => {
    const event = eventById.get(frame.eventId) ?? null;
    return index === 0 || shouldIncludePlaybackFrame(frame, event);
  });
  const introItems: ReplayPlaybackItem[] = [
    {
      id: "intro-matchup",
      kind: "matchup",
      label: "The matchup",
      packetType: "intro",
      frame: battlefieldFrame,
      event: introEvents[0],
    },
    {
      id: "intro-battlefields",
      kind: "battlefields",
      label: "Battlefields",
      packetType: "intro",
      frame: battlefieldFrame,
      event: introEvents.find((event) => /battlefield|chose/i.test(`${event.label} ${event.detail ?? ""}`)),
    },
    {
      id: "intro-initiative",
      kind: "initiative",
      label: "Initiative",
      packetType: "intro",
      frame: initiativeFrame,
      event: introEvents.find((event) => /rolled|go first|goes first|chose to go/i.test(`${event.label} ${event.detail ?? ""}`)),
    },
    {
      id: "intro-mulligan",
      kind: "mulligan",
      label: "Mulligan",
      packetType: "intro",
      frame: mulliganFrame,
      event: introEvents.find((event) => /mulligan|redraw/i.test(`${event.label} ${event.detail ?? ""}`)),
    },
    {
      id: "intro-opening-hands",
      kind: "openingHands",
      label: "Opening hands",
      packetType: "intro",
      frame: handFrame,
      event: introEvents.find((event) => /game start|mulligans complete/i.test(`${event.label} ${event.detail ?? ""}`)),
    },
  ];

  return [
    ...introItems,
    ...boardFrames.map((frame) => ({
      id: `board-${frame.id}`,
      kind: "board" as const,
      label: frame.label,
      packetType: frame.packetType,
      frame,
      event: eventById.get(frame.eventId) ?? null,
    })),
  ];
}

function ReplayIntroStage({
  item,
  model,
  onFocusCard,
}: {
  item: Extract<ReplayPlaybackItem, { kind: ReplayIntroKind }>;
  model: RiftReplayViewModel;
  onFocusCard: (card: ReplayCard | null) => void;
}) {
  const framePlayers = item.frame?.players.length ? item.frame.players : model.players;
  const players = sortReplayPlayers(framePlayers);
  const bottomPlayer = players[0];
  const topPlayer = players[1] ?? players[0];
  const replayCards = allKnownReplayCards(model);

  if (item.kind === "matchup") {
    return (
      <IntroStageFrame eyebrow="The matchup" title="The Matchup" subtitle={model.title}>
        <div className="grid h-full place-items-center">
          <div className="grid w-full max-w-3xl gap-10">
            <IntroLoadout onFocusCard={onFocusCard} player={topPlayer} tone="opponent" />
            <div className="text-center font-display text-4xl font-black tracking-[0.25em] text-slate-300">VS</div>
            <IntroLoadout onFocusCard={onFocusCard} player={bottomPlayer} tone="local" />
          </div>
        </div>
      </IntroStageFrame>
    );
  }

  if (item.kind === "battlefields") {
    return (
      <IntroStageFrame eyebrow="Battlefields" title="Battlefields" subtitle="Chosen battlefield package">
        <div className="grid h-full items-center gap-8 lg:grid-cols-2">
          <BattlefieldIntroCard onFocusCard={onFocusCard} player={bottomPlayer} title="Your battlefield" tone="local" />
          <BattlefieldIntroCard onFocusCard={onFocusCard} player={topPlayer} title="Opponent battlefield" tone="opponent" />
        </div>
      </IntroStageFrame>
    );
  }

  if (item.kind === "initiative") {
    const displayRoomState = combineRoomState(item.frame?.roomState, model.roomState);
    const rolls = findRolls(model.timeline, [topPlayer, bottomPlayer], displayRoomState);
    const topRoll = rollValueForPlayer(rolls, topPlayer, 0);
    const bottomRoll = rollValueForPlayer(rolls, bottomPlayer, 1);
    const firstPlayer = findFirstPlayerText(model.timeline, [topPlayer, bottomPlayer], displayRoomState) || (topRoll && bottomRoll ? `${topRoll > bottomRoll ? topPlayer?.name : bottomPlayer?.name} goes first.` : "Waiting for first-player decision.");
    return (
      <IntroStageFrame eyebrow="Initiative" title="Initiative" subtitle="Opening rolls and first-player decision">
        <div className="grid h-full place-items-center">
          <div className="grid w-full max-w-4xl items-center gap-8 md:grid-cols-[1fr_auto_1fr]">
            <DiceRollCard player={topPlayer} value={topRoll} tone="opponent" />
            <div className="text-center font-display text-3xl font-black tracking-[0.3em] text-slate-200">ROLL</div>
            <DiceRollCard player={bottomPlayer} value={bottomRoll} tone="local" />
          </div>
          <div className="mt-10 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-5 py-2 text-center text-sm text-cyan-100">
            {firstPlayer}
          </div>
        </div>
      </IntroStageFrame>
    );
  }

  if (item.kind === "mulligan") {
    const displayRoomState = combineRoomState(item.frame?.roomState, model.roomState);
    return (
      <IntroStageFrame eyebrow="Mulligan" title="Mulligan" subtitle="Opening hand decisions">
        <div className="grid h-full items-center gap-8 lg:grid-cols-2">
          <OpeningHandPanel hidden lookupCards={replayCards} onFocusCard={onFocusCard} player={topPlayer} roomState={displayRoomState} title={topPlayer?.name || "Opponent"} />
          <OpeningHandPanel lookupCards={replayCards} onFocusCard={onFocusCard} player={bottomPlayer} roomState={displayRoomState} title={bottomPlayer?.name || "You"} />
        </div>
      </IntroStageFrame>
    );
  }

  const displayRoomState = combineRoomState(item.frame?.roomState, model.roomState);
  return (
    <IntroStageFrame eyebrow="Opening hands" title="Opening Hands" subtitle="Game start state">
      <div className="grid h-full items-center gap-8 lg:grid-cols-2">
        <OpeningHandPanel hidden lookupCards={replayCards} onFocusCard={onFocusCard} player={topPlayer} roomState={displayRoomState} title={topPlayer?.name || "Opponent"} />
        <OpeningHandPanel lookupCards={replayCards} onFocusCard={onFocusCard} player={bottomPlayer} roomState={displayRoomState} title={bottomPlayer?.name || "You"} />
      </div>
    </IntroStageFrame>
  );
}

function IntroStageFrame({
  children,
  eyebrow,
  subtitle,
  title,
}: {
  children: React.ReactNode;
  eyebrow: string;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_50%_50%,rgba(34,211,238,0.11),transparent_34%),#10151c] p-8">
      <div className="pointer-events-none absolute inset-x-10 top-4 h-px bg-gradient-to-r from-transparent via-cyan-200/25 to-transparent" />
      <div className="relative z-10 flex h-full flex-col">
        <div className="text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.42em] text-cyan-100/75">{eyebrow}</div>
          <div className="mt-3 font-display text-4xl font-black tracking-tight text-white">{title}</div>
          <div className="mt-2 text-sm text-slate-400">{subtitle}</div>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function IntroLoadout({
  onFocusCard,
  player,
  tone,
}: {
  onFocusCard: (card: ReplayCard | null) => void;
  player?: ReplayPlayer;
  tone: "local" | "opponent";
}) {
  const cards = [player?.legend, ...championCards(player)].filter(isReplayCard).slice(0, 3);
  return (
    <div className={cn("grid justify-center gap-3 text-center", tone === "opponent" ? "text-rose-100" : "text-cyan-100")}>
      <div className="flex justify-center gap-4">
        {cards.length ? cards.map((card) => <StageCard key={`${player?.id}-${card.id}`} card={card} glow={tone} onFocusCard={onFocusCard} />) : <CardBack label="Unknown" large />}
      </div>
      <div>
        <div className="font-display text-lg font-bold text-white">{player?.name || "Unknown player"}</div>
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">{tone === "opponent" ? "Opponent" : "You"}</div>
      </div>
    </div>
  );
}

function BattlefieldIntroCard({
  onFocusCard,
  player,
  title,
  tone,
}: {
  onFocusCard: (card: ReplayCard | null) => void;
  player?: ReplayPlayer;
  title: string;
  tone: "local" | "opponent";
}) {
  const battlefield = player?.battlefield;
  return (
    <div className={cn("riftreplay-stage-rise grid min-h-[360px] place-items-center rounded-3xl border p-5 text-center", tone === "local" ? "border-cyan-300/35 bg-cyan-300/9" : "border-rose-300/35 bg-rose-300/9")}>
      <div className="space-y-4">
        <div className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-400">{title}</div>
        <div className="font-display text-3xl font-black text-white">{battlefield?.name || "Battlefield unknown"}</div>
        <div className="text-sm font-semibold text-slate-300">{player?.name || "Unknown player"}</div>
        <div className="mx-auto max-w-[330px]">{battlefield ? <StageCard card={battlefield} landscape glow={tone} onFocusCard={onFocusCard} /> : <CardBack label="BF" landscape large />}</div>
      </div>
    </div>
  );
}

function DiceRollCard({ player, tone, value }: { player?: ReplayPlayer; tone: "local" | "opponent"; value?: number }) {
  return (
    <div className={cn("riftreplay-stage-rise grid min-h-40 place-items-center rounded-3xl border p-5 text-center shadow-2xl", tone === "local" ? "border-cyan-300/25 bg-cyan-300/8 shadow-cyan-500/10" : "border-rose-300/25 bg-rose-300/8 shadow-rose-500/10")}>
      <div className="grid gap-3">
        <div className={cn("riftreplay-die-pop mx-auto grid h-20 w-20 place-items-center rounded-2xl border border-white/10 bg-[linear-gradient(145deg,#0c2332,#05080f)] shadow-[0_0_35px_rgba(34,211,238,0.18)]", value !== undefined && "riftreplay-soft-pulse")}>
          <span className="font-display text-3xl font-black text-white">{value ?? "..."}</span>
        </div>
        <div className="font-display text-lg font-bold text-white">{player?.name || "Unknown"}</div>
      </div>
    </div>
  );
}

function OpeningHandPanel({
  hidden = false,
  lookupCards = [],
  onFocusCard,
  player,
  roomState,
  title,
}: {
  hidden?: boolean;
  lookupCards?: ReplayCard[];
  onFocusCard: (card: ReplayCard | null) => void;
  player?: ReplayPlayer;
  roomState?: ReplayRoomState;
  title: string;
}) {
  const hand = findZoneByKey(player, ["hand"]);
  const cards = hand?.cards ?? [];
  const cardBackCount = Math.max(hand?.hidden ?? 0, cards.length || 4);
  const details = mulliganDetails(player, roomState, cards, lookupCards);
  const summary = details.summary;
  return (
    <div className="grid min-h-[360px] place-items-center rounded-3xl border border-white/10 bg-slate-950/42 p-5">
      <div className="w-full space-y-5 text-center">
        <div className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-400">{title}</div>
        <div className="flex min-h-44 flex-wrap items-center justify-center gap-3 overflow-hidden">
          {hidden
            ? Array.from({ length: Math.min(6, cardBackCount) }).map((_, index) => <CardBack className="riftreplay-card-deal" key={`${player?.id}-back-${index}`} />)
            : cards.length
              ? cards.slice(0, 7).map((card, index) => <StageCard card={card} className="riftreplay-card-deal" key={`${player?.id}-hand-${card.id}`} onFocusCard={onFocusCard} style={{ animationDelay: `${index * 55}ms` }} />)
              : Array.from({ length: 4 }).map((_, index) => <CardBack className="riftreplay-card-deal" key={`${player?.id}-empty-${index}`} label="?" />)}
        </div>
        {!hidden && (details.recycled.length || details.redrawn.length) ? (
          <div className="mx-auto grid max-w-2xl gap-3 text-left md:grid-cols-2">
            <MulliganChangeRow cards={details.recycled} label="Recycled" onFocusCard={onFocusCard} tone="out" />
            <MulliganChangeRow cards={details.redrawn} label="Redrawn" onFocusCard={onFocusCard} tone="in" />
          </div>
        ) : null}
        <div className="mx-auto flex flex-wrap justify-center gap-2">
          <div className="inline-flex rounded-full border border-white/10 bg-white/[0.06] px-4 py-1.5 text-xs font-semibold text-slate-300">
            {hidden ? "Opponent hand hidden" : `${cards.length} visible card${cards.length === 1 ? "" : "s"}`}
          </div>
          {summary ? (
            <div className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-1.5 text-xs font-semibold text-cyan-100">
              {summary}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MulliganChangeRow({
  cards,
  label,
  onFocusCard,
  tone,
}: {
  cards: ReplayCard[];
  label: string;
  onFocusCard: (card: ReplayCard | null) => void;
  tone: "in" | "out";
}) {
  if (!cards.length) return null;
  return (
    <div className={cn("rounded-2xl border p-2", tone === "in" ? "border-emerald-300/20 bg-emerald-300/8" : "border-rose-300/20 bg-rose-300/8")}>
      <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {cards.slice(0, 6).map((card, index) => (
          <BoardCard card={card} key={`${label}-${card.id}-${index}`} onFocusCard={onFocusCard} small />
        ))}
      </div>
    </div>
  );
}

function StageCard({
  card,
  className,
  glow = "local",
  landscape = false,
  onFocusCard,
  style,
}: {
  card: ReplayCard;
  className?: string;
  glow?: "local" | "opponent";
  landscape?: boolean;
  onFocusCard?: (card: ReplayCard | null) => void;
  style?: React.CSSProperties;
}) {
  const glowClass = glow === "local" ? "shadow-[0_0_26px_rgba(34,211,238,0.32)]" : "shadow-[0_0_26px_rgba(244,63,94,0.3)]";
  if (landscape) {
    return <LandscapeCardImage card={card} className={cn("h-36 w-72", className)} glowClass={glowClass} onFocusCard={onFocusCard} style={style} />;
  }
  if (card.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={card.name}
        className={cn(
          "mx-auto rounded-xl border border-black/70 bg-black object-contain",
          glowClass,
          "h-36 w-[104px]",
          className,
        )}
        onMouseEnter={() => onFocusCard?.(card)}
        src={card.imageUrl}
        style={style}
        title={card.name}
      />
    );
  }
  return (
    <div className={cn("grid place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/8 p-3 text-center text-xs font-black text-cyan-100", glowClass, "h-36 w-[104px]", className)} onMouseEnter={() => onFocusCard?.(card)} style={style}>
      {card.name}
    </div>
  );
}

function LandscapeCardImage({
  card,
  className,
  compact = false,
  flipped = false,
  glowClass,
  onFocusCard,
  style,
}: {
  card: ReplayCard;
  className?: string;
  compact?: boolean;
  flipped?: boolean;
  glowClass?: string;
  onFocusCard?: (card: ReplayCard | null) => void;
  style?: React.CSSProperties;
}) {
  const imageKey = `${card.name}\u0000${card.imageUrl}`;
  const [imageFallback, setImageFallback] = useState<{ key: string; src: string } | null>(null);
  const imageSrc = imageFallback?.key === imageKey ? imageFallback.src : card.imageUrl;
  const frameClass = cn(
    "riftreplay-card-enter relative shrink-0 overflow-hidden rounded-xl border border-black/70 bg-black shadow-[0_8px_18px_rgba(0,0,0,0.45)]",
    glowClass,
    className,
  );
  if (imageSrc) {
    return (
      <div className={frameClass} onMouseEnter={() => onFocusCard?.(card)} style={{ ...style, transform: flipped ? "rotate(180deg)" : style?.transform }} title={card.name}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={card.name}
          className={cn(
            "absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 rotate-90 object-contain",
            compact ? "h-[138%] w-auto" : "h-[126%] w-auto",
          )}
          onError={() => {
            const fallback = fallbackCardImageUrl(card);
            if (fallback && fallback !== imageSrc) setImageFallback({ key: imageKey, src: fallback });
          }}
          src={imageSrc}
        />
      </div>
    );
  }
  return (
    <div className={cn(frameClass, "grid place-items-center p-2 text-center text-[10px] font-black text-cyan-100")} onMouseEnter={() => onFocusCard?.(card)} style={{ ...style, transform: flipped ? "rotate(180deg)" : style?.transform }} title={card.name}>
      {card.name}
    </div>
  );
}

function CardBack({ className, label = "", landscape = false, large = false }: { className?: string; label?: string; landscape?: boolean; large?: boolean }) {
  return (
    <div
      className={cn(
        "grid place-items-center rounded-xl border border-cyan-300/35 bg-[radial-gradient(circle_at_50%_45%,rgba(34,211,238,0.3),transparent_32%),linear-gradient(145deg,#05273a,#0a1522)] font-display font-black text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.16)]",
        landscape ? "h-32 w-64" : large ? "h-36 w-[104px]" : "h-32 w-24",
        className,
      )}
    >
      {label || "R"}
    </div>
  );
}

function ReplayBoardCanvas({ frame, onFocusCard }: { frame: ReplayFrame; onFocusCard: (card: ReplayCard | null) => void }) {
  const players = sortReplayPlayers(frame.players);
  const bottomPlayer = players[0];
  const topPlayer = players[1] ?? players[0];
  const [expandedTrash, setExpandedTrash] = useState<string | null>(null);
  const chainCards = uniqueCards([
    ...zoneCards(bottomPlayer, ["chain", "stack"]),
    ...zoneCards(topPlayer, ["chain", "stack"]),
  ]);
  const expandedPlayer = [bottomPlayer, topPlayer].find((player) => player?.id === expandedTrash);
  const expandedTrashZone = findZoneByKey(expandedPlayer, ["trash", "discard"]);
  const battlefieldA = topPlayer?.battlefield;
  const battlefieldB = bottomPlayer?.battlefield;
  const topBattlefieldA = zoneCardsExact(topPlayer, "battlefieldA");
  const topBattlefieldB = zoneCardsExact(topPlayer, "battlefieldB");
  const bottomBattlefieldA = zoneCardsExact(bottomPlayer, "battlefieldA");
  const bottomBattlefieldB = zoneCardsExact(bottomPlayer, "battlefieldB");
  const topBase = zoneCardsExact(topPlayer, "base");
  const bottomBase = zoneCardsExact(bottomPlayer, "base");

  return (
    <div className="relative grid h-full min-h-0 gap-1.5 overflow-hidden lg:grid-cols-[92px_minmax(0,1fr)_86px]">
      <PlayerSideRail expanded={expandedTrash === topPlayer?.id} onFocusCard={onFocusCard} onToggleTrash={setExpandedTrash} player={topPlayer} position="top" />
      <div className="grid min-h-0 min-w-0 grid-rows-[120px_88px_minmax(380px,1fr)_88px_178px] gap-1.5 overflow-hidden">
        <PlayerRow onFocusCard={onFocusCard} player={topPlayer} tone="opponent" />
        <BaseLane cards={topBase} flipped label="Opponent base" onFocusCard={onFocusCard} tone="opponent" />
        <div className="grid min-h-0 gap-2 md:grid-cols-2">
          <SharedBattlefieldLane
            battlefield={battlefieldB}
            bottomCards={bottomBattlefieldB}
            label={battlefieldB?.name || "Your battlefield"}
            onFocusCard={onFocusCard}
            tone="local"
            topCards={topBattlefieldB}
          />
          <SharedBattlefieldLane
            battlefield={battlefieldA}
            bottomCards={bottomBattlefieldA}
            label={battlefieldA?.name || "Opponent battlefield"}
            onFocusCard={onFocusCard}
            tone="opponent"
            topCards={topBattlefieldA}
          />
        </div>
        <BaseLane cards={bottomBase} label="Your base" onFocusCard={onFocusCard} tone="local" />
        <PlayerRow onFocusCard={onFocusCard} player={bottomPlayer} tone="local" />
      </div>
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_156px] gap-1.5">
        <ZoneColumn cards={chainCards} label="Chain" onFocusCard={onFocusCard} />
        <PlayerSideRail expanded={expandedTrash === bottomPlayer?.id} onFocusCard={onFocusCard} onToggleTrash={setExpandedTrash} player={bottomPlayer} position="bottom" />
      </div>
      {expandedPlayer && expandedTrashZone ? (
        <TrashPopover onClose={() => setExpandedTrash(null)} onFocusCard={onFocusCard} player={expandedPlayer} zone={expandedTrashZone} />
      ) : null}
    </div>
  );
}

function PlayerSideRail({
  expanded,
  onFocusCard,
  onToggleTrash,
  player,
  position,
}: {
  expanded: boolean;
  onFocusCard: (card: ReplayCard | null) => void;
  onToggleTrash: (playerId: string | null) => void;
  player?: ReplayPlayer;
  position: "top" | "bottom";
}) {
  const deck = findZoneByKey(player, ["deck"]);
  const trash = findZoneByKey(player, ["trash", "discard"]);
  const score = player?.score;
  const latestTrash = trash?.cards.at(-1);
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-2">
      <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/8 p-1.5 text-center shadow-[0_0_18px_rgba(34,211,238,0.14)]">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100">{position === "top" ? "Opp" : "You"}</div>
        <div className="font-display text-xl font-bold text-white">{score ?? "-"}</div>
      </div>
      <DeckBox count={(deck?.hidden ?? 0) + (deck?.cards.length ?? 0)} />
      <button
        className={cn(
          "group grid min-h-0 place-items-center overflow-hidden rounded-xl border border-dashed border-white/10 bg-white/[0.025] p-1.5 text-center transition hover:border-cyan-300/45 hover:bg-cyan-300/8",
          expanded && "border-cyan-300/50 bg-cyan-300/10",
        )}
        disabled={!player || !trash || (!trash.cards.length && !trash.hidden)}
        onClick={() => onToggleTrash(expanded ? null : (player?.id ?? null))}
        type="button"
      >
        <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">Trash</div>
        {latestTrash ? <BoardCard card={latestTrash} onFocusCard={onFocusCard} small /> : <div className="rounded-full border border-white/10 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-300">{trash?.hidden || 0}</div>}
        {trash?.cards.length ? <div className="mt-1 text-[10px] text-slate-500">{trash.cards.length} seen</div> : null}
      </button>
    </div>
  );
}

function DeckBox({ count }: { count: number }) {
  return (
    <div className="flex h-28 items-center justify-center rounded-xl border border-cyan-300/35 bg-[linear-gradient(145deg,#063047,#09293b)] shadow-[inset_0_0_0_2px_rgba(34,211,238,0.12)]">
      <div className="rounded-full border border-cyan-200/40 bg-slate-950/85 px-3 py-2 font-display text-xl font-bold text-white">
        {count || "-"}
      </div>
    </div>
  );
}

function PlayerRow({
  onFocusCard,
  player,
  tone,
}: {
  onFocusCard: (card: ReplayCard | null) => void;
  player?: ReplayPlayer;
  tone: "local" | "opponent";
}) {
  const hand = findZoneByKey(player, ["hand"]);
  const runeDeck = findZoneByKey(player, ["runedeck"]);
  const cards = hand?.cards ?? [];
  const runeInfo = activeRuneInfo(player);
  return (
    <div className={cn("grid min-h-0 grid-rows-[44px_minmax(0,1fr)] gap-2 overflow-hidden rounded-xl border p-2", tone === "local" ? "border-cyan-300/40 bg-cyan-300/8" : "border-white/10 bg-white/[0.025]")}>
      <RuneStrip activeHidden={runeInfo.hidden} deckHidden={runeDeck?.hidden ?? 0} onFocusCard={onFocusCard} runes={runeInfo.cards} tone={tone} />
      <div className={cn("flex min-h-0 items-center justify-center gap-2 overflow-hidden rounded-lg border border-white/10 bg-slate-950/45 p-1.5", tone === "opponent" && "items-center")}>
        {cards.length ? cards.slice(0, 16).map((card) => <BoardCard card={card} compact={cards.length > 8} flipped={tone === "opponent"} key={`${tone}-${card.id}`} onFocusCard={onFocusCard} small />) : <EmptyZone label={tone === "local" ? "Hand" : "Opponent hand"} />}
        {hand?.hidden ? <HiddenCount label="hidden" value={hand.hidden} /> : null}
      </div>
    </div>
  );
}

function BaseLane({
  cards,
  flipped = false,
  label,
  onFocusCard,
  tone,
}: {
  cards: ReplayCard[];
  flipped?: boolean;
  label: string;
  onFocusCard: (card: ReplayCard | null) => void;
  tone: "local" | "opponent";
}) {
  return (
    <div className={cn("grid min-h-0 grid-cols-[76px_minmax(0,1fr)] items-center gap-1.5 rounded-xl border px-2 py-1", tone === "opponent" ? "border-rose-300/14 bg-rose-300/[0.045]" : "border-cyan-300/14 bg-cyan-300/[0.045]")}>
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="flex min-h-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-dashed border-white/10 bg-slate-950/25 p-1">
        {cards.length ? cards.slice(0, 16).map((card) => <BoardCard card={card} compact={cards.length > 5} flipped={flipped} key={`${label}-${card.id}`} onFocusCard={onFocusCard} small />) : <EmptyZone label="Empty" />}
      </div>
    </div>
  );
}

function SharedBattlefieldLane({
  battlefield,
  bottomCards,
  label,
  onFocusCard,
  tone,
  topCards,
}: {
  battlefield?: ReplayCard;
  bottomCards: ReplayCard[];
  label: string;
  onFocusCard: (card: ReplayCard | null) => void;
  tone: "local" | "opponent";
  topCards: ReplayCard[];
}) {
  return (
    <div className={cn("grid min-h-0 grid-rows-[minmax(130px,1fr)_50px_minmax(130px,1fr)] overflow-hidden rounded-xl border p-1.5", tone === "opponent" ? "border-rose-300/15 bg-rose-300/7" : "border-cyan-300/15 bg-cyan-300/7")}>
      <BattlefieldSide cards={topCards} flipped label="Opponent side" onFocusCard={onFocusCard} />
      <div className="my-1 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-950/40 px-2 py-1">
        <div className="min-w-0">
          <div className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{tone === "opponent" ? "Opponent battlefield" : "Your battlefield"}</div>
          <div className="truncate text-xs font-semibold text-slate-300">{label}</div>
        </div>
        {battlefield ? <BoardCard card={battlefield} landscape onFocusCard={onFocusCard} /> : <CardBack label="BF" landscape />}
      </div>
      <BattlefieldSide cards={bottomCards} label="Your side" onFocusCard={onFocusCard} />
    </div>
  );
}

function BattlefieldSide({
  cards,
  flipped = false,
  label,
  onFocusCard,
}: {
  cards: ReplayCard[];
  flipped?: boolean;
  label: string;
  onFocusCard: (card: ReplayCard | null) => void;
}) {
  return (
    <div className="flex min-h-0 flex-wrap content-center items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-dashed border-white/10 bg-slate-950/25 p-1">
      {cards.length ? (
        cards.slice(0, 14).map((card) => <BoardCard card={card} compact={cards.length > 3} flipped={flipped} key={`${label}-${card.id}`} onFocusCard={onFocusCard} small />)
      ) : (
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-700">{label}</div>
      )}
    </div>
  );
}

function ZoneColumn({ cards, label, onFocusCard }: { cards: ReplayCard[]; label: string; onFocusCard: (card: ReplayCard | null) => void }) {
  return (
    <div className="min-h-0 overflow-hidden rounded-xl border border-dashed border-white/10 bg-white/[0.025] p-1.5">
      <div className="mb-1.5 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="flex max-h-full flex-col items-center gap-1.5 overflow-hidden">
        {cards.length ? cards.slice(0, 8).map((card) => <BoardCard card={card} key={`${label}-${card.id}`} onFocusCard={onFocusCard} small />) : <EmptyZone label="Empty" />}
      </div>
    </div>
  );
}

function RuneStrip({
  activeHidden,
  deckHidden,
  onFocusCard,
  runes,
  tone,
}: {
  activeHidden: number;
  deckHidden: number;
  onFocusCard: (card: ReplayCard | null) => void;
  runes: ReplayCard[];
  tone: "local" | "opponent";
}) {
  const placeholderCount = Math.max(0, Math.min(activeHidden, 12 - runes.length));
  const dense = runes.length + placeholderCount > 8;
  return (
    <div className="flex min-h-0 items-center justify-center gap-1 overflow-hidden rounded-lg border border-white/10 bg-slate-950/45 p-1">
      <div className="mr-1 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-600">Runes</div>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden">
        {runes.slice(0, 12).map((card, index) => <BoardCard card={card} compact={dense} flipped={tone === "opponent"} key={`rune-${card.id}-${index}`} onFocusCard={onFocusCard} rune />)}
        {Array.from({ length: placeholderCount }).map((_, index) => (
          <div
            className={cn("grid shrink-0 place-items-center rounded-lg border border-cyan-300/35 bg-[radial-gradient(circle_at_50%_45%,rgba(34,211,238,0.25),transparent_32%),linear-gradient(145deg,#05273a,#0a1522)] font-display text-[10px] font-black text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.12)]", dense ? "h-8 w-8" : "h-9 w-9")}
            key={`hidden-rune-${tone}-${index}`}
          >
            R
          </div>
        ))}
      </div>
      {deckHidden > 0 ? <HiddenCount label="deck" value={deckHidden} /> : null}
      {!runes.length && !placeholderCount && !deckHidden ? <EmptyZone label="No runes" /> : null}
    </div>
  );
}

function HiddenCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid h-10 min-w-10 place-items-center rounded-lg border border-white/10 bg-white/[0.035] px-2 text-center">
      <div className="font-mono text-xs font-bold text-cyan-100">{value}</div>
      <div className="text-[8px] uppercase tracking-[0.12em] text-slate-600">{label}</div>
    </div>
  );
}

function TrashPopover({
  onClose,
  onFocusCard,
  player,
  zone,
}: {
  onClose: () => void;
  onFocusCard: (card: ReplayCard | null) => void;
  player: ReplayPlayer;
  zone: ReplayZone;
}) {
  return (
    <div className="absolute bottom-3 left-24 right-24 z-20 rounded-2xl border border-cyan-300/30 bg-slate-950/95 p-3 shadow-2xl backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-white">{player.name} trash</div>
          <div className="text-xs text-slate-500">{zone.cards.length} visible card{zone.cards.length === 1 ? "" : "s"}</div>
        </div>
        <Button onClick={onClose} size="sm" variant="secondary">Close</Button>
      </div>
      <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
        {zone.cards.length ? zone.cards.slice().reverse().map((card) => <BoardCard card={card} key={`trash-full-${card.id}`} onFocusCard={onFocusCard} />) : <EmptyZone label="Trash is empty" />}
      </div>
    </div>
  );
}

function BoardCard({
  card,
  compact = false,
  flipped = false,
  landscape = false,
  onFocusCard,
  rune = false,
  small = false,
}: {
  card: ReplayCard;
  compact?: boolean;
  flipped?: boolean;
  landscape?: boolean;
  onFocusCard?: (card: ReplayCard | null) => void;
  rune?: boolean;
  small?: boolean;
}) {
  const imageKey = `${card.name}\u0000${card.imageUrl}`;
  const [imageFallback, setImageFallback] = useState<{ key: string; src: string } | null>(null);
  const imageSrc = imageFallback?.key === imageKey ? imageFallback.src : card.imageUrl;
  const dimensions = landscape ? "h-12 w-28" : rune ? (compact ? "h-8 w-6" : "h-9 w-7") : compact ? "h-[70px] w-[50px]" : small ? "h-[90px] w-16" : "h-28 w-20";
  const rotation = (flipped ? 180 : 0) + (!landscape && (card.exhausted || card.tapped) ? 90 : 0);
  const transformStyle = { transform: `rotate(${rotation}deg)` };
  if (landscape) {
    return <LandscapeCardImage card={card} className={dimensions} compact flipped={flipped} onFocusCard={onFocusCard} />;
  }
  if (imageSrc) {
    return (
      <div className="relative shrink-0" style={transformStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={card.name}
          className={cn(dimensions, "riftreplay-card-enter rounded-lg border border-black/70 bg-black object-contain shadow-[0_8px_18px_rgba(0,0,0,0.45)]", (card.exhausted || card.tapped) && "riftreplay-card-tapped")}
          onError={() => {
            const fallback = fallbackCardImageUrl(card);
            if (fallback && fallback !== imageSrc) setImageFallback({ key: imageKey, src: fallback });
          }}
          onMouseEnter={() => onFocusCard?.(card)}
          src={imageSrc}
          title={card.name}
        />
        {card.isCopy ? <span className="absolute -right-1 -top-1 rounded-full border border-cyan-200/50 bg-cyan-400 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-950">Copy</span> : null}
      </div>
    );
  }
  return (
    <div className={cn(dimensions, "riftreplay-card-enter flex shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/8 p-1 text-center text-[10px] font-bold text-cyan-100", (card.exhausted || card.tapped) && "riftreplay-card-tapped")} onMouseEnter={() => onFocusCard?.(card)} style={transformStyle}>
      {card.name}
    </div>
  );
}

function TinyCard({ card }: { card: ReplayCard }) {
  return <BoardCard card={card} small />;
}

function EmptyZone({ label }: { label: string }) {
  return <div className="px-3 py-2 text-center text-xs text-slate-600">{label}</div>;
}

function FocusedCard({ card }: { card: ReplayCard }) {
  const landscape = isBattlefieldCard(card);
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-1.5 overflow-hidden">
      <div className="mx-auto flex min-h-0 w-full items-center justify-center overflow-hidden rounded-2xl bg-black/30 p-2">
        {landscape ? (
          <LandscapeCardImage card={card} className="h-full max-h-full w-full max-w-[280px]" />
        ) : card.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={card.name} className="h-full max-h-full w-auto max-w-full rounded-xl border border-white/10 object-contain shadow-2xl" src={card.imageUrl} />
        ) : (
          <div className="flex h-full max-h-full w-full max-w-[180px] items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/8 p-4 text-center font-bold text-cyan-100">
            {card.name}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate font-display text-sm font-bold text-white">{card.name}</div>
        <div className="text-xs text-slate-400">{card.code || card.type || "Replay card"}</div>
      </div>
    </div>
  );
}

function EventRail({
  events,
  onSelect,
  selectedIndex,
}: {
  events: ReplayTimelineEvent[];
  onSelect: (index: number) => void;
  selectedIndex: number;
}) {
  const indexedEvents = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => shouldShowReplayEvent(event));
  const windowSize = 18;
  const selectedVisibleIndex = Math.max(0, indexedEvents.findIndex(({ index }) => index >= selectedIndex));
  const windowStart = Math.max(0, Math.min(selectedVisibleIndex - 6, Math.max(0, indexedEvents.length - windowSize)));
  const visibleEvents = indexedEvents.slice(windowStart, windowStart + windowSize);
  const firstTs = events.find((event) => event.ts)?.ts;
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <div className="border-b border-white/[0.08] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Chat / events</div>
          <div className="font-mono text-[10px] text-slate-600">
            {indexedEvents.length ? `${windowStart + 1}-${Math.min(indexedEvents.length, windowStart + windowSize)} / ${indexedEvents.length}` : "0 / 0"}
          </div>
        </div>
      </div>
      <div className="min-h-0 space-y-1 overflow-y-auto p-3">
        {visibleEvents.map(({ event: item, index }) => {
          return (
          <button
            className={cn(
              "grid w-full grid-cols-[58px_1fr] gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition",
              index === selectedIndex ? "bg-cyan-300/12 text-cyan-50" : "text-slate-400 hover:bg-white/[0.04] hover:text-white",
            )}
            key={`${item.id}-${index}`}
            onClick={() => onSelect(index)}
            type="button"
          >
            <span className="font-mono text-xs text-slate-500">{relativeEventTime(firstTs, item.ts)}</span>
            <span className="min-w-0">
              <span className="block truncate">{item.label}</span>
              {item.detail ? <span className="block truncate text-xs text-slate-500">{item.detail}</span> : null}
            </span>
          </button>
          );
        })}
      </div>
    </div>
  );
}

function NoFrameState() {
  return (
    <div className="grid h-full min-h-[560px] place-items-center rounded-3xl border border-dashed border-white/10 text-slate-500">
      This replay has timeline events but no board frames yet.
    </div>
  );
}

function TimelinePanel({
  events,
  onSelect,
  selectedIndex,
}: {
  events: ReplayTimelineEvent[];
  onSelect: (index: number) => void;
  selectedIndex: number;
}) {
  return (
    <Card className="max-h-[760px] overflow-hidden rounded-3xl p-0">
      <div className="border-b border-white/[0.07] p-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Clock3 className="h-5 w-5 text-cyan-200" />
          Timeline
        </CardTitle>
        <CardDescription>{events.length.toLocaleString()} captured events</CardDescription>
      </div>
      <div className="max-h-[668px] space-y-2 overflow-y-auto p-3">
        {events.map((event, index) => (
          <button
            className={cn(
              "w-full rounded-2xl border p-3 text-left transition",
              index === selectedIndex
                ? "border-cyan-300/55 bg-cyan-300/12 shadow-[0_0_22px_rgba(89,167,255,0.12)]"
                : "border-white/[0.06] bg-white/[0.025] hover:border-cyan-300/25 hover:bg-white/[0.045]",
            )}
            key={`${event.id}-${index}`}
            onClick={() => onSelect(index)}
            type="button"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-semibold text-white">{event.label}</span>
              <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-slate-400">
                {formatEventTime(event.ts)}
              </span>
            </div>
            <div className="mt-1 truncate text-xs text-slate-400">{event.detail || event.packetType}</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function BoardPanel({ model, selectedEvent }: { model: RiftReplayViewModel; selectedEvent: ReplayTimelineEvent | null }) {
  return (
    <Card className="space-y-5 rounded-3xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Swords className="h-6 w-6 text-cyan-200" />
            {model.title}
          </CardTitle>
          <CardDescription>
            Board state uses the latest authoritative snapshot available in the raw capture.
          </CardDescription>
        </div>
        {selectedEvent ? (
          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/8 px-4 py-2 text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200">Selected</div>
            <div className="max-w-80 truncate text-sm font-semibold text-white">{selectedEvent.label}</div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 2xl:grid-cols-2">
        {model.players.length ? (
          model.players.map((player) => <PlayerBoard key={player.id} player={player} />)
        ) : (
          <div className="rounded-3xl border border-dashed border-white/12 bg-white/[0.025] p-8 text-center text-slate-400">
            No player state was found in this capture yet.
          </div>
        )}
      </div>
    </Card>
  );
}

function PlayerBoard({ player }: { player: ReplayPlayer }) {
  return (
    <div className="rounded-3xl border border-white/[0.08] bg-slate-950/35 p-4">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <div className="font-display text-xl font-semibold text-white">{player.name}</div>
          <div className="text-xs text-slate-400">
            {player.role || "player"} {player.seat !== undefined ? `· seat ${player.seat}` : ""}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Score</div>
          <div className="font-display text-2xl font-bold text-cyan-100">{player.score ?? "—"}</div>
        </div>
      </div>
      <div className="grid gap-3">
        {player.legend || player.battlefield ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {player.legend ? <FeatureCard card={player.legend} label="Champion / legend" /> : null}
            {player.battlefield ? <FeatureCard card={player.battlefield} label="Battlefield" /> : null}
          </div>
        ) : null}
        {player.zones.map((zone) => (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3" key={zone.id}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-white">{zone.name}</div>
              <div className="text-xs text-slate-500">
                {zone.cards.length} visible {zone.hidden ? `· ${zone.hidden} hidden` : ""}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {zone.cards.slice(0, 16).map((card) => (
                <MiniCard card={card} key={`${zone.id}-${card.id}`} />
              ))}
              {!zone.cards.length ? (
                <div className="col-span-full rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-slate-500">
                  No visible cards in this zone.
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatureCard({ card, label }: { card: ReplayCard; label: string }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-cyan-300/14 bg-cyan-300/7 p-3">
      <CardThumb card={card} large />
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200">{label}</div>
        <div className="truncate text-sm font-semibold text-white">{card.name}</div>
        <div className="truncate text-xs text-slate-400">{card.code || card.type || "Visible card"}</div>
      </div>
    </div>
  );
}

function MiniCard({ card }: { card: ReplayCard }) {
  return (
    <div className="flex min-w-0 gap-2 rounded-xl border border-white/[0.06] bg-slate-950/45 p-2">
      <CardThumb card={card} />
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-white" title={card.name}>
          {card.name}
        </div>
        <div className="truncate text-[10px] text-slate-500">{card.code || card.type || "card"}</div>
      </div>
    </div>
  );
}

function CardThumb({ card, large = false }: { card: ReplayCard; large?: boolean }) {
  if (card.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt=""
        className={cn("shrink-0 rounded-lg border border-white/10 object-cover", large ? "h-16 w-12" : "h-12 w-9")}
        src={card.imageUrl}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/8 text-[10px] font-bold text-cyan-100",
        large ? "h-16 w-12" : "h-12 w-9",
      )}
    >
      {card.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function InspectorPanel({
  diagnostics,
  event,
  packetCounts,
}: {
  diagnostics: RiftReplayViewModel["diagnostics"];
  event: ReplayTimelineEvent | null;
  packetCounts: [string, number][];
}) {
  return (
    <div className="space-y-3">
      <Card className="rounded-2xl p-4">
        <CardTitle className="text-lg">Event inspector</CardTitle>
        {event ? (
          <div className="mt-4 space-y-3">
            <InfoLine label="Type" value={event.type} />
            <InfoLine label="Time" value={event.iso ? new Date(event.iso).toLocaleString() : "Unknown"} />
            <InfoLine label="Player" value={event.playerName || event.playerId || "—"} />
            <InfoLine label="Card" value={event.cardName || "—"} />
            <InfoLine label="Zone" value={event.zone || "—"} />
            {event.detail ? <p className="rounded-2xl bg-white/[0.04] p-3 text-sm leading-6 text-slate-300">{event.detail}</p> : null}
          </div>
        ) : (
          <CardDescription className="mt-3">Select a timeline event to inspect it.</CardDescription>
        )}
      </Card>

      <Card className="rounded-2xl p-4">
        <CardTitle className="text-lg">Packet mix</CardTitle>
        <div className="mt-4 space-y-2">
          {packetCounts.slice(0, 10).map(([packet, count]) => (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3 py-2" key={packet}>
              <span className="truncate text-xs text-slate-300">{packet}</span>
              <span className="font-mono text-xs text-cyan-200">{count}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="rounded-2xl p-4">
        <CardTitle className="text-lg">Diagnostics</CardTitle>
        <div className="mt-4 space-y-2">
          {diagnostics.length ? (
            diagnostics.map((diagnostic) => (
              <div className="rounded-2xl border border-amber-300/15 bg-amber-300/8 p-3 text-xs text-amber-100" key={diagnostic.id}>
                <div className="font-semibold">{diagnostic.message}</div>
                {diagnostic.context ? <div className="mt-1 text-amber-100/70">{diagnostic.context}</div> : null}
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/8 p-3 text-xs text-emerald-100">
              No parser warnings for this capture.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="truncate text-right text-slate-200">{value}</span>
    </div>
  );
}

function EmptyReplayState() {
  return (
    <Card className="rounded-3xl border-dashed border-white/12 p-10 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/8">
        <FileJson className="h-8 w-8 text-cyan-200" />
      </div>
      <CardTitle className="mt-5 text-2xl">Load a replay to begin.</CardTitle>
      <CardDescription className="mx-auto mt-2 max-w-2xl">
        This page accepts RiftLite raw Atlas sidecars, RiftReplay raw-capture JSON, and translated
        custom replay JSON. Private RiftReplay IDs need your own API key because the raw endpoint is protected.
      </CardDescription>
    </Card>
  );
}

function findCardInFrame(frame: ReplayFrame, cardName: string): ReplayCard | undefined {
  const normalized = normalizeLabel(cardName);
  for (const player of frame.players) {
    for (const card of [player.legend, player.battlefield, ...player.zones.flatMap((zone) => zone.cards)]) {
      if (card && normalizeLabel(card.name) === normalized) {
        return card;
      }
    }
  }
  return undefined;
}

function findZone(player: ReplayPlayer | undefined, hints: string[]): ReplayZone | undefined {
  if (!player) return undefined;
  const normalizedHints = hints.map(normalizeLabel);
  return player.zones.find((zone) => {
    const id = normalizeLabel(zone.id);
    const name = normalizeLabel(zone.name);
    return normalizedHints.some((hint) => id.includes(hint) || name.includes(hint));
  });
}

function findZoneByKey(player: ReplayPlayer | undefined, keys: string[]): ReplayZone | undefined {
  if (!player) return undefined;
  const normalizedKeys = keys.map(normalizeLabel);
  return (
    player.zones.find((zone) => {
      const zoneKey = normalizeLabel(zone.id.split(":").pop() || zone.name);
      return normalizedKeys.some((key) => zoneKey === key);
    }) ??
    player.zones.find((zone) => {
      const zoneKey = normalizeLabel(zone.id.split(":").pop() || zone.name);
      const zoneName = normalizeLabel(zone.name);
      return normalizedKeys.some((key) => zoneKey.includes(key) || zoneName.includes(key));
    })
  );
}

function zoneCardsExact(player: ReplayPlayer | undefined, key: string): ReplayCard[] {
  if (!player) return [];
  const normalizedKey = normalizeLabel(key);
  return (
    player.zones.find((zone) => {
      const zoneKey = normalizeLabel(zone.id.split(":").pop() || zone.name);
      return zoneKey === normalizedKey;
    })?.cards ?? []
  );
}

function zoneCards(player: ReplayPlayer | undefined, hints: string[]): ReplayCard[] {
  if (!player) return [];
  const normalizedHints = hints.map(normalizeLabel);
  return player.zones
    .filter((zone) => {
      const id = normalizeLabel(zone.id);
      const name = normalizeLabel(zone.name);
      return normalizedHints.some((hint) => id.includes(hint) || name.includes(hint));
    })
    .flatMap((zone) => zone.cards);
}

function activeRuneInfo(player: ReplayPlayer | undefined): { cards: ReplayCard[]; hidden: number } {
  if (!player) return { cards: [], hidden: 0 };
  const direct = findZoneByKey(player, ["runearea"]);
  if (direct) return { cards: direct.cards, hidden: direct.hidden };
  let hidden = 0;
  const cards: ReplayCard[] = [];
  for (const zone of player.zones) {
    const zoneKey = normalizeLabel(zone.id.split(":").pop() || zone.name);
    const zoneName = normalizeLabel(zone.name);
    const combined = `${zoneKey} ${zoneName}`;
    if (/runedeck|runesdeck|rune deck|deck|hand|trash|discard|sideboard|removed/.test(combined)) continue;
    if (!/(^|[^a-z])rune(area|s)?([^a-z]|$)/.test(combined)) continue;
    hidden += zone.hidden;
    cards.push(...zone.cards);
  }
  return { cards, hidden };
}

function uniqueCards(cards: ReplayCard[]): ReplayCard[] {
  const seen = new Set<string>();
  const result: ReplayCard[] = [];
  for (const card of cards) {
    const key = `${card.id}:${card.code}:${card.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(card);
  }
  return result;
}

function isReplayCard(value: ReplayCard | undefined | null): value is ReplayCard {
  return Boolean(value?.name);
}

function isBattlefieldCard(card: ReplayCard | undefined | null) {
  if (!card) return false;
  const text = normalizeLabel(`${card.type ?? ""} ${card.code ?? ""} ${card.name}`);
  return text.includes("battlefield") || /^ogn2(7[5-9]|8[0-9]|9[0-9])$/.test(text) || /^unl20[7-9]$/.test(text) || text.includes("starspring");
}

function sortReplayPlayers(players: ReplayPlayer[]) {
  return [...players].sort((a, b) => {
    const rank = (player: ReplayPlayer) => {
      if (player.role === "self") return 0;
      if (player.role === "viewer") return 0.5;
      return 1;
    };
    return rank(a) - rank(b) || Number(a.seat ?? 99) - Number(b.seat ?? 99) || a.name.localeCompare(b.name);
  });
}

function championCards(player: ReplayPlayer | undefined): ReplayCard[] {
  const legendKey = normalizeLabel(player?.legend?.name ?? "");
  return uniqueCards(
    [
      ...(player?.champions ?? []),
      ...zoneCardsExact(player, "champion"),
    ].filter((card) => normalizeLabel(card.name) !== legendKey),
  );
}

function findFrameWithZone(frames: ReplayFrame[], keys: string[]) {
  return frames.find((frame) => frame.players.some((player) => findZoneByKey(player, keys)?.cards.length || findZoneByKey(player, keys)?.hidden));
}

function findFrameWithBattlefields(frames: ReplayFrame[]) {
  return frames.find((frame) => frame.players.some((player) => player.battlefield));
}

function findFrameWithRolls(frames: ReplayFrame[]) {
  return (
    frames.find((frame) => Object.values(frame.roomState?.initiativeRolls ?? {}).filter((value) => Number.isFinite(value)).length >= 2) ??
    frames.find((frame) => Object.values(frame.roomState?.initiativeRolls ?? {}).some((value) => Number.isFinite(value)))
  );
}

function findFrameWithVisibleHand(frames: ReplayFrame[], minVisibleCards = 4) {
  return frames.find((frame) => visibleHandCount(frame) >= minVisibleCards);
}

function visibleHandCount(frame: ReplayFrame) {
  return Math.max(
    0,
    ...frame.players.map((player) => findZoneByKey(player, ["hand"])?.cards.length ?? 0),
  );
}

function findFrameWithMulligan(frames: ReplayFrame[], preferredHandFrame?: ReplayFrame) {
  const hasMulliganData = (frame: ReplayFrame) => Object.keys(frame.roomState?.mulliganPlaybackByPlayerId ?? {}).length > 0 || /mulligan/i.test(frame.label);
  if (preferredHandFrame && hasMulliganData(preferredHandFrame)) return preferredHandFrame;
  return (
    frames.find((frame) => hasMulliganData(frame) && visibleHandCount(frame) >= 4) ??
    frames.find(hasMulliganData)
  );
}

function findRolls(events: ReplayTimelineEvent[], players: Array<ReplayPlayer | undefined>, roomState?: ReplayRoomState) {
  const rolls = new Map<string, number>();
  const nameToId = new Map<string, string>();
  const realPlayers = players.filter((player): player is ReplayPlayer => Boolean(player));
  players.forEach((player) => {
    if (!player) return;
    nameToId.set(normalizeLabel(player.name), player.id);
  });
  for (const [playerId, value] of Object.entries(roomState?.initiativeRolls ?? {})) {
    const rollValue = Number(value);
    if (!Number.isFinite(rollValue)) continue;
    rolls.set(playerId, rollValue);
    const player = players.find((item) => item?.id === playerId);
    if (player) rolls.set(normalizeLabel(player.name), rollValue);
  }
  const rawRoomRolls = Object.entries(roomState?.initiativeRolls ?? {})
    .map(([playerId, value]) => [playerId, Number(value)] as const)
    .filter(([, value]) => Number.isFinite(value));
  if (rawRoomRolls.length === realPlayers.length && realPlayers.some((player) => !rolls.has(player.id))) {
    const seatOrdered = [...realPlayers].sort((a, b) => Number(a.seat ?? 99) - Number(b.seat ?? 99) || a.name.localeCompare(b.name));
    rawRoomRolls.forEach(([, value], index) => {
      const player = seatOrdered[index];
      if (!player || rolls.has(player.id)) return;
      rolls.set(player.id, value);
      rolls.set(normalizeLabel(player.name), value);
    });
  }
  const firstPlayer = realPlayers.find((player) => player.id === roomState?.firstPlayerId);
  for (const event of events) {
    const text = `${event.label} ${event.detail ?? ""}`.replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
    const explicitNames = new Set<string>();
    const sentences = text
      .split(/[.。]+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    for (const sentence of sentences) {
      const explicitRoll = sentence.match(/^(.+?)\s+(?:rolled|rolls)\s+(?:a\s+d20\s*)?(\d{1,2})$/i);
      if (explicitRoll) {
        const name = normalizeLabel(explicitRoll[1].replace(/^chat message\s*/i, "").trim());
        const value = Number(explicitRoll[2]);
        if (!Number.isFinite(value)) continue;
        rolls.set(name, value);
        const playerId = nameToId.get(name);
        if (playerId) rolls.set(playerId, value);
        explicitNames.add(name);
        continue;
      }

      const unnamedRoll = sentence.match(/^(?:chat message\s*)?Rolled\s+(?:a\s+d20\s*)?(\d{1,2})$/i);
      if (unnamedRoll && realPlayers.length === 2) {
        const value = Number(unnamedRoll[1]);
        const otherPlayer = realPlayers.find((player) => !explicitNames.has(normalizeLabel(player.name)));
        if (otherPlayer && Number.isFinite(value)) {
          rolls.set(otherPlayer.id, value);
          rolls.set(normalizeLabel(otherPlayer.name), value);
        }
      }
    }

    const vsRoll = text.match(/wins initiative\s*\((\d{1,2})\s+vs\s+(\d{1,2})\)/i);
    if (vsRoll && realPlayers.length === 2) {
      const winnerValue = Number(vsRoll[1]);
      const loserValue = Number(vsRoll[2]);
      const winner = realPlayers.find((player) => text.toLowerCase().includes(player.name.toLowerCase())) ?? firstPlayer;
      const loser = winner ? realPlayers.find((player) => player.id !== winner.id) : undefined;
      if (winner && loser && Number.isFinite(winnerValue) && Number.isFinite(loserValue)) {
        rolls.set(winner.id, winnerValue);
        rolls.set(normalizeLabel(winner.name), winnerValue);
        rolls.set(loser.id, loserValue);
        rolls.set(normalizeLabel(loser.name), loserValue);
      }
    }
  }
  return rolls;
}

function findFirstPlayerText(events: ReplayTimelineEvent[], players: Array<ReplayPlayer | undefined>, roomState?: ReplayRoomState) {
  const firstPlayer = players.find((player) => player?.id === roomState?.firstPlayerId);
  if (firstPlayer) return `${firstPlayer.name} goes first.`;
  const event = events.find((item) => /go first|goes first|chose to go|take the first turn/i.test(`${item.label} ${item.detail ?? ""}`));
  const text = event?.detail || event?.label;
  if (!text) return "";
  return text.replace(/^Chat message\s*/i, "").trim();
}

function shouldShowReplayEvent(event: ReplayTimelineEvent) {
  const text = `${event.label} ${event.detail ?? ""}`.trim();
  if (/^chat sync$/i.test(text)) return false;
  if (/room state updated|board snapshot|patch committed|state update|authoritative|presence event|presence update/i.test(text)) return false;
  if (/^(insert|remove|patch card fields):/i.test(event.label)) return false;
  if (["room_shell_sync", "authoritative_snapshot", "set_room_fields", "set_player_fields", "log_remove", "presence_event", "presence_update"].includes(event.type)) return false;
  return /rolled|mulligan|game start|score|chose|go first|played|moved|recycled|ended their turn|chat|attack|pass|resolve|chain|exhaust|rune|trash/i.test(text) || event.type === "log_insert" || event.packetType === "chat_append";
}

function shouldIncludePlaybackFrame(frame: ReplayFrame, event: ReplayTimelineEvent | null) {
  const packetType = frame.packetType.toLowerCase();
  if (/presence|spectator|heartbeat/.test(packetType)) return false;
  if (!event) return !/room_shell_sync/.test(packetType);
  const eventType = event.type.toLowerCase();
  const text = `${event.label} ${event.detail ?? ""}`.trim();
  if (/presence|spectator|heartbeat|log_remove/.test(eventType)) return false;
  if (/room state updated|presence event|presence update/i.test(text)) return false;
  if (shouldShowReplayEvent(event)) return true;
  return /zone_|chain_|patch_card_fields|set_board_fields|set_player_fields|set_room_fields|authoritative_snapshot/.test(eventType);
}

function rollValueForPlayer(rolls: Map<string, number>, player: ReplayPlayer | undefined, fallbackIndex: number) {
  if (player) {
    const byId = rolls.get(player.id);
    if (Number.isFinite(byId)) return byId;
    const byName = rolls.get(normalizeLabel(player.name));
    if (Number.isFinite(byName)) return byName;
  }
  const fallback = Array.from(rolls.values()).filter((value) => Number.isFinite(value))[fallbackIndex];
  return Number.isFinite(fallback) ? fallback : undefined;
}

function combineRoomState(primary?: ReplayRoomState, fallback?: ReplayRoomState): ReplayRoomState | undefined {
  if (!primary && !fallback) return undefined;
  return {
    ...fallback,
    ...primary,
    activeTurnPlayerId: primary?.activeTurnPlayerId || fallback?.activeTurnPlayerId,
    firstPlayerId: primary?.firstPlayerId || fallback?.firstPlayerId,
    initiativeRolls: {
      ...(fallback?.initiativeRolls ?? {}),
      ...(primary?.initiativeRolls ?? {}),
    },
    mulliganPlaybackByPlayerId: {
      ...(fallback?.mulliganPlaybackByPlayerId ?? {}),
      ...(primary?.mulliganPlaybackByPlayerId ?? {}),
    },
    playerTurnCounts: {
      ...(fallback?.playerTurnCounts ?? {}),
      ...(primary?.playerTurnCounts ?? {}),
    },
    phase: primary?.phase || fallback?.phase,
    turnNumber: primary?.turnNumber ?? fallback?.turnNumber,
  };
}

function mulliganDetails(player: ReplayPlayer | undefined, roomState: ReplayRoomState | undefined, currentCards: ReplayCard[], lookupCards: ReplayCard[] = []) {
  const empty = { original: [] as ReplayCard[], recycled: [] as ReplayCard[], redrawn: [] as ReplayCard[], summary: "" };
  if (!player) return empty;
  const raw = roomState?.mulliganPlaybackByPlayerId?.[player.id];
  if (!raw || typeof raw !== "object") return empty;
  const record = raw as Record<string, unknown>;
  const lookup = buildCardLookup(uniqueCards([...allKnownPlayerCards(player, currentCards), ...lookupCards]));
  const recycled = collectLooseCards(record, ["recycled", "recycledCards", "returned", "returnedCards", "discarded", "discardedCards", "mulliganed", "mulliganedCards", "bottomed"], lookup);
  const redrawn = collectLooseCards(record, ["redrawn", "redrawnCards", "draws", "drawn", "drawnCards", "newCards", "replacementCards"], lookup);
  const original = collectLooseCards(record, ["openingHand", "initialHand", "originalHand", "before"], lookup);
  const redrawCount =
    numberFromLoose(record.redrawCount) ??
    numberFromLoose(record.recycleCount) ??
    numberFromLoose(record.recycledCount) ??
    numberFromLoose(record.mulliganCount) ??
    Math.max(recycled.length, redrawn.length);
  const summary =
    redrawCount > 0
      ? `${redrawCount} recycled, ${redrawn.length || redrawCount} redrawn`
      : currentCards.length
        ? "Kept opening hand"
        : "";
  return { original, recycled, redrawn, summary };
}

function collectLooseCards(root: Record<string, unknown>, keys: string[], lookup: CardLookup) {
  const normalizedKeys = new Set(keys.map(normalizeLabel));
  const found: unknown[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 3 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (normalizedKeys.has(normalizeLabel(key))) {
        found.push(child);
      } else if (typeof child === "object") {
        visit(child, depth + 1);
      }
    }
  };
  visit(root, 0);
  return uniqueCards(flattenLooseValues(found).map((value) => looseToReplayCard(value, lookup)).filter(isReplayCard));
}

function flattenLooseValues(values: unknown[]): unknown[] {
  const result: unknown[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else {
      result.push(value);
    }
  };
  values.forEach(visit);
  return result;
}

type CardLookup = Map<string, ReplayCard>;

function looseToReplayCard(value: unknown, lookup: CardLookup): ReplayCard | null {
  if (typeof value === "string") {
    const name = value.trim();
    if (!name) return null;
    const matched = lookupReplayCard(lookup, name);
    if (matched) return matched;
    if (/^(card|hidden|unknown)[_-]/i.test(name)) return null;
    return { id: `mulligan-${normalizeLabel(name)}`, name };
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const looseId = stringFromLoose(record.id) || stringFromLoose(record.instanceId) || stringFromLoose(record.cardInstanceId);
  const name =
    stringFromLoose(record.name) ||
    stringFromLoose(record.cardName) ||
    stringFromLoose(record.title) ||
    stringFromLoose(record.label) ||
    stringFromLoose(record.card_name);
  const code =
    cardCodeFromLoose(record.code) ||
    cardCodeFromLoose(record.cardId) ||
    cardCodeFromLoose(record.card_id) ||
    cardCodeFromLoose(record.imageCode) ||
    cardCodeFromLoose(record.variantNumber);
  const imageUrl = stringFromLoose(record.imageUrl) || stringFromLoose(record.image_url) || stringFromLoose(record.src) || stringFromLoose(record.artUrl);
  const matched = lookupReplayCard(lookup, looseId) || lookupReplayCard(lookup, code) || lookupReplayCard(lookup, name);
  if (matched && (!name || /^card[_-]/i.test(name))) return matched;
  if (!matched && !name && looseId && /^(card|hidden|unknown)[_-]/i.test(looseId)) return null;
  if (!name && !code) return null;
  return {
    code,
    id: looseId || code || `mulligan-${normalizeLabel(name ?? "card")}`,
    imageUrl: imageUrl || imageUrlFromCardCode(code),
    name: name || code || "Unknown card",
    type: stringFromLoose(record.type),
  };
}

function cardCodeFromLoose(value: unknown) {
  const raw = stringFromLoose(value);
  if (!raw) return undefined;
  const match = raw.match(/\b([A-Z]{3}-\d{3}[a-z]?)\b/i);
  return match ? `${match[1].slice(0, 3).toUpperCase()}-${match[1].slice(4)}` : undefined;
}

function imageUrlFromCardCode(code?: string) {
  return code ? `https://cdn.piltoverarchive.com/cards/${encodeURIComponent(code)}.webp` : undefined;
}

function fallbackCardImageUrl(card: ReplayCard) {
  const code = card.code || cardCodeFromLoose(card.id) || cardCodeFromLoose(card.name);
  if (!code) return undefined;
  const set = code.split("-")[0]?.toLowerCase();
  return set ? `https://summonersbase.nyc3.cdn.digitaloceanspaces.com/production/img/${set}/${encodeURIComponent(code)}.webp` : undefined;
}

function allKnownPlayerCards(player: ReplayPlayer, extras: ReplayCard[] = []) {
  return uniqueCards(
    [
      player.legend,
      player.battlefield,
      ...(player.battlefieldOptions ?? []),
      ...player.zones.flatMap((zone) => zone.cards),
      ...extras,
    ].filter(isReplayCard),
  );
}

function allKnownReplayCards(model: RiftReplayViewModel) {
  return uniqueCards(
    [
      ...model.players.flatMap((player) => allKnownPlayerCards(player)),
      ...model.frames.flatMap((frame) =>
        frame.players.flatMap((player) => allKnownPlayerCards(player)),
      ),
    ],
  );
}

function buildCardLookup(cards: ReplayCard[]): CardLookup {
  const lookup: CardLookup = new Map();
  for (const card of cards) {
    for (const key of [card.id, card.code, card.name, normalizeLabel(card.id), normalizeLabel(card.code ?? ""), normalizeLabel(card.name)]) {
      if (!key) continue;
      lookup.set(key, card);
    }
  }
  return lookup;
}

function lookupReplayCard(lookup: CardLookup, value?: string) {
  if (!value) return null;
  return lookup.get(value) ?? lookup.get(normalizeLabel(value)) ?? null;
}

function stringFromLoose(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberFromLoose(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function normalizeLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function relativeEventTime(start?: number, value?: number) {
  if (!start || !value || value < start) return "[--:--]";
  const seconds = Math.floor((value - start) / 1000);
  const minutes = Math.floor(seconds / 60);
  return `[${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}]`;
}

function formatEventTime(value?: number) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatDuration(start?: number, end?: number) {
  if (!start || !end || end <= start) return "—";
  const seconds = Math.round((end - start) / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function formatDateRange(start?: number, end?: number) {
  if (!start && !end) return "No timestamps";
  const formatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  if (start && end) return `${formatter.format(new Date(start))} → ${formatter.format(new Date(end))}`;
  return formatter.format(new Date(start ?? end ?? Date.now()));
}
