"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getLegendImageUrl, getLegendInitials } from "@/lib/legends";
import type {
  CommunityMatch,
  MatchGame,
  MatchupCell,
  MatrixView,
} from "@/lib/types";
import { formatDate, formatPercent } from "@/lib/utils";

function legendHref(legend: string) {
  return `/community/legends/${encodeURIComponent(legend)}`;
}

function playerHref(username: string) {
  return `/community/players/${encodeURIComponent(username)}`;
}

type MatrixBrowserProps = {
  matrix: MatrixView;
  matches: CommunityMatch[];
};

function matchupMatches(matches: CommunityMatch[], cell: MatchupCell) {
  return matches
    .filter((m) => m.myChampion === cell.myLegend && m.oppChampion === cell.oppLegend)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

function cellStyle(winRate: number, hasGames: boolean, active: boolean): CSSProperties {
  if (active) return { background: "rgba(89,167,255,0.18)", borderColor: "rgba(89,167,255,0.6)" };
  if (!hasGames) return { background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.05)" };
  if (winRate >= 65) return { background: "rgba(73,193,135,0.32)", borderColor: "rgba(73,193,135,0.45)" };
  if (winRate >= 55) return { background: "rgba(73,193,135,0.16)", borderColor: "rgba(73,193,135,0.28)" };
  if (winRate >= 45) return { background: "rgba(89,167,255,0.08)", borderColor: "rgba(255,255,255,0.07)" };
  if (winRate >= 35) return { background: "rgba(255,107,122,0.16)", borderColor: "rgba(255,107,122,0.28)" };
  return { background: "rgba(255,107,122,0.32)", borderColor: "rgba(255,107,122,0.45)" };
}

function winRateTextClass(winRate: number, hasGames: boolean): string {
  if (!hasGames) return "text-slate-700";
  if (winRate >= 55) return "text-emerald-300 font-semibold";
  if (winRate < 45) return "text-rose-300 font-semibold";
  return "text-slate-300";
}

function resultColorClass(result: string): string {
  if (result === "Win") return "text-emerald-400";
  if (result === "Loss") return "text-rose-400";
  if (result === "Draw") return "text-amber-300";
  return "text-slate-400";
}

function defaultScore(result: string): string {
  if (result === "Win") return "1-0";
  if (result === "Draw") return "½-½";
  if (result === "Loss") return "0-1";
  return "";
}

function LegendPortrait({ legend, size = 30 }: { legend: string; size?: number }) {
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <Image
        alt={legend}
        className="rounded-full object-cover ring-1 ring-white/15"
        height={size}
        src={getLegendImageUrl(legend)}
        title={legend}
        width={size}
        onError={(e) => {
          const target = e.currentTarget as HTMLImageElement;
          target.style.display = "none";
          const fallback = target.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = "flex";
        }}
      />
      <div
        className="absolute inset-0 hidden items-center justify-center rounded-full bg-gradient-to-br from-blue-500/30 to-violet-500/30 ring-1 ring-white/15"
        style={{ fontSize: size * 0.34 }}
      >
        <span className="font-display text-xs font-bold text-white">
          {getLegendInitials(legend)}
        </span>
      </div>
    </div>
  );
}

function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const origin = useRef({ x: 0, y: 0, sl: 0, st: 0 });

  function onMouseDown(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    dragging.current = true;
    moved.current = false;
    origin.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    el.style.cursor = "grabbing";
    el.style.userSelect = "none";
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragging.current || !ref.current) return;
    const dx = e.clientX - origin.current.x;
    const dy = e.clientY - origin.current.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved.current = true;
    ref.current.scrollLeft = origin.current.sl - dx;
    ref.current.scrollTop = origin.current.st - dy;
  }

  function onMouseUp() {
    dragging.current = false;
    if (ref.current) {
      ref.current.style.cursor = "grab";
      ref.current.style.userSelect = "";
    }
  }

  function onClickCapture(e: React.MouseEvent) {
    if (moved.current) {
      e.stopPropagation();
      moved.current = false;
    }
  }

  return { ref, onMouseDown, onMouseMove, onMouseUp, onMouseLeave: onMouseUp, onClickCapture };
}

type SplitStats = { wins: number; total: number };

function emptySplit(): SplitStats {
  return { wins: 0, total: 0 };
}

function splitPercent(split: SplitStats): number {
  return split.total === 0 ? 0 : (split.wins / split.total) * 100;
}

function splitColor(split: SplitStats): string {
  if (split.total === 0) return "text-slate-400";
  const pct = splitPercent(split);
  if (pct >= 50) return "text-emerald-300";
  return "text-rose-300";
}

function computeSplits(matches: CommunityMatch[]) {
  const fmt: Record<string, SplitStats> = {
    Bo1: emptySplit(),
    Bo3: emptySplit(),
  };
  const seat: Record<string, SplitStats> = {
    "1st": emptySplit(),
    "2nd": emptySplit(),
  };
  let myPts = 0;
  let oppPts = 0;

  for (const match of matches) {
    const isWin = match.result === "Win";
    const fmtKey = match.fmt === "Bo3" ? "Bo3" : "Bo1";
    fmt[fmtKey].total += 1;
    if (isWin) fmt[fmtKey].wins += 1;

    // Desktop uses game 1's went_first as the most reliable signal,
    // falling back to the match-level value.
    const seatValue =
      match.games?.[0]?.wentFirst?.trim() || match.wentFirst?.trim() || "";
    if (seatValue === "1st" || seatValue === "2nd") {
      seat[seatValue].total += 1;
      if (isWin) seat[seatValue].wins += 1;
    }

    for (const game of match.games ?? []) {
      myPts += Number(game.myPoints ?? 0) || 0;
      oppPts += Number(game.oppPoints ?? 0) || 0;
    }
  }

  return { fmt, seat, myPts, oppPts };
}

function GameDetailCard({ index, game }: { index: number; game: MatchGame | undefined }) {
  const myBf = game?.myBf?.trim() || "";
  const oppBf = game?.oppBf?.trim() || "";
  const went = game?.wentFirst?.trim() || "";
  const myPts = Number(game?.myPoints ?? 0) || 0;
  const oppPts = Number(game?.oppPoints ?? 0) || 0;
  const gameResult = game?.result?.trim() || "";

  const resultLabel =
    gameResult === "Win"
      ? { text: "✓ Win", cls: "text-emerald-300" }
      : gameResult === "Draw"
        ? { text: "~ Draw", cls: "text-amber-300" }
        : gameResult === "Loss"
          ? { text: "✗ Loss", cls: "text-rose-300" }
          : null;

  return (
    <div className="flex min-w-[200px] flex-col gap-2 rounded-[14px] border border-white/8 bg-slate-950/50 p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300/90">
          Game {index + 1}
        </span>
        {resultLabel ? (
          <span className={`text-[11px] font-semibold ${resultLabel.cls}`}>
            {resultLabel.text}
          </span>
        ) : null}
      </div>
      {game ? (
        <>
          <div className="space-y-1 text-xs">
            <div className="flex items-start gap-2">
              <span className="w-[52px] flex-shrink-0 text-slate-500">My BF</span>
              <span className="flex-1 text-slate-200">{myBf || "—"}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-[52px] flex-shrink-0 text-slate-500">Opp BF</span>
              <span className="flex-1 text-slate-200">{oppBf || "—"}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px]">
            <span className="font-semibold text-amber-200/90">
              Points: {myPts} – {oppPts}
            </span>
            <span
              className={
                went === "1st"
                  ? "font-semibold text-cyan-300"
                  : "text-slate-500"
              }
            >
              {went === "1st" ? "✓ Went 1st" : went === "2nd" ? "Went 2nd" : "Seat —"}
            </span>
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-600">Not played</div>
      )}
    </div>
  );
}

function MatchupSummary({
  cell,
  matches,
}: {
  cell: MatchupCell;
  matches: CommunityMatch[];
}) {
  const splits = useMemo(() => computeSplits(matches), [matches]);
  const overallWr = cell.decisiveGames === 0 ? 0 : (cell.wins / cell.decisiveGames) * 100;
  const overallColor =
    cell.decisiveGames === 0
      ? "var(--brand-gold)"
      : overallWr >= 55
        ? "var(--brand-win)"
        : overallWr < 45
          ? "var(--brand-loss)"
          : "var(--brand-gold)";

  const pointDelta = splits.myPts - splits.oppPts;
  const deltaLabel = pointDelta === 0 ? "" : ` (${pointDelta > 0 ? "+" : ""}${pointDelta})`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-col items-center gap-1.5">
          <LegendPortrait legend={cell.myLegend} size={52} />
          <span className="text-[11px] text-slate-400">{cell.myLegend.split(" ")[0]}</span>
        </div>
        <div className="flex flex-1 flex-col items-center">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">vs</span>
          <div
            className="mt-1 text-center text-3xl font-bold"
            style={{ color: overallColor }}
          >
            {cell.decisiveGames === 0 ? "—" : formatPercent(overallWr)}
          </div>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <LegendPortrait legend={cell.oppLegend} size={52} />
          <span className="text-[11px] text-slate-400">{cell.oppLegend.split(" ")[0]}</span>
        </div>
      </div>

      <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
        <div className="grid grid-cols-4 gap-2 text-center">
          <div>
            <div className="text-lg font-bold text-emerald-300">{cell.wins}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Wins</div>
          </div>
          <div>
            <div className="text-lg font-bold text-rose-300">{cell.losses}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Losses</div>
          </div>
          <div>
            <div className="text-lg font-bold text-amber-300">{cell.draws}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Draws</div>
          </div>
          <div>
            <div className="text-lg font-bold text-slate-200">{cell.totalGames}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Total</div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-3.5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            By Format
          </div>
          <div className="space-y-1.5">
            {(["Bo1", "Bo3"] as const).map((key) => {
              const split = splits.fmt[key];
              if (split.total === 0) {
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between text-xs text-slate-600"
                  >
                    <span>{key}</span>
                    <span>—</span>
                  </div>
                );
              }
              const losses = split.total - split.wins;
              return (
                <div key={key} className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{key}</span>
                  <span className={`font-semibold ${splitColor(split)}`}>
                    {split.wins}W / {losses}L ({formatPercent(splitPercent(split))})
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-3.5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Going 1st / 2nd
          </div>
          <div className="space-y-1.5">
            {(["1st", "2nd"] as const).map((key) => {
              const split = splits.seat[key];
              if (split.total === 0) {
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between text-xs text-slate-600"
                  >
                    <span>Going {key}</span>
                    <span>—</span>
                  </div>
                );
              }
              const losses = split.total - split.wins;
              return (
                <div key={key} className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Going {key}</span>
                  <span className={`font-semibold ${splitColor(split)}`}>
                    {split.wins}W / {losses}L ({formatPercent(splitPercent(split))})
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-[0.2em] text-slate-500">
            Game Points
          </span>
          <span className="font-semibold text-amber-200">
            {splits.myPts} – {splits.oppPts}
            {deltaLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

function MatchDetailPanel({
  matches,
  selectedId,
  onSelect,
}: {
  matches: CommunityMatch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const shown = matches.slice(0, 20);
  const selected = matches.find((m) => m.id === selectedId) ?? null;
  const gameSlots = selected?.fmt === "Bo3" ? 3 : 1;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
            Recent matches ({shown.length} of {matches.length})
          </CardTitle>
        </div>
        {shown.length === 0 ? (
          <CardDescription>No match records for this cell.</CardDescription>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-separate" style={{ borderSpacing: 0 }}>
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3">Player</th>
                  <th className="pb-2 pr-3">Result</th>
                  <th className="pb-2 pr-3">Deck</th>
                  <th className="pb-2 pr-3">Fmt</th>
                  <th className="pb-2">Score</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((match) => {
                  const isActive = match.id === selectedId;
                  return (
                    <tr
                      className={`group cursor-pointer border-t border-white/5 text-sm transition-colors ${
                        isActive
                          ? "bg-cyan-500/10"
                          : "hover:bg-white/[0.04]"
                      }`}
                      key={match.id}
                      onClick={() => onSelect(match.id)}
                    >
                      <td className="py-2 pr-3 text-xs text-slate-400">
                        {formatDate(match.date)}
                      </td>
                      <td className="py-2 pr-3 font-medium text-white">
                        {match.username ? (
                          <Link
                            className="underline-offset-4 hover:text-cyan-200 hover:underline"
                            href={playerHref(match.username)}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {match.username}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`py-2 pr-3 font-semibold ${resultColorClass(match.result)}`}>
                        {match.result || "—"}
                      </td>
                      <td className="py-2 pr-3 text-slate-300">
                        {match.deckName?.trim() || "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-400">
                        {match.fmt || "Bo1"}
                      </td>
                      <td className="py-2 text-xs text-slate-300">
                        {match.score?.trim() || defaultScore(match.result)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected ? (
        <div className="rounded-[18px] border border-white/8 bg-slate-950/40 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300/90">
                Game Details
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                {selected.username || "Community match"} ·{" "}
                {formatDate(selected.date)} · {selected.fmt || "Bo1"}
              </div>
            </div>
            {selected.deckSourceKey ? (
              <Link
                className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200 transition-colors hover:border-cyan-300 hover:bg-cyan-400/20"
                href={`/community/decks/${encodeURIComponent(`source:${selected.deckSourceKey}`)}`}
              >
                View deck
                <span aria-hidden="true">→</span>
              </Link>
            ) : selected.deckName ? (
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                {selected.deckName}
              </span>
            ) : null}
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {Array.from({ length: gameSlots }, (_, idx) => (
              <GameDetailCard
                game={selected.games?.[idx]}
                index={idx}
                key={`${selected.id}-g${idx}`}
              />
            ))}
          </div>
          {selected.myBattlefield || selected.oppBattlefield ? (
            <div className="mt-3 text-[11px] text-slate-500">
              Match-level battlefields:{" "}
              <span className="text-slate-300">
                {selected.myBattlefield || "—"}
              </span>{" "}
              vs{" "}
              <span className="text-slate-300">
                {selected.oppBattlefield || "—"}
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-[18px] border border-dashed border-white/8 bg-white/[0.02] p-6 text-center text-xs text-slate-500">
          Select a match to view the per-game breakdown.
        </div>
      )}
    </div>
  );
}

export function MatrixBrowser({ matrix, matches }: MatrixBrowserProps) {
  const {
    ref: dragRef,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
    onClickCapture,
  } = useDragScroll();
  const firstCell = matrix.cells.find((c) => c.totalGames > 0);
  const [selectedKey, setSelectedKey] = useState(
    firstCell ? `${firstCell.myLegend}:::${firstCell.oppLegend}` : "",
  );

  const selected =
    matrix.cells.find((c) => `${c.myLegend}:::${c.oppLegend}` === selectedKey) ?? null;
  const selectedMatches = useMemo(
    () => (selected ? matchupMatches(matches, selected) : []),
    [selected, matches],
  );

  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  // Keep the selected match in sync with the selected cell.
  const effectiveMatchId =
    selectedMatchId && selectedMatches.some((m) => m.id === selectedMatchId)
      ? selectedMatchId
      : (selectedMatches[0]?.id ?? null);

  return (
    <div className="space-y-6">
      <Card className="min-w-0 overflow-hidden p-5">
        <div className="mb-4 text-xs uppercase tracking-[0.2em] text-slate-500">
          Click any cell to inspect the matchup
        </div>
        <div
          className="overflow-auto"
          ref={dragRef}
          style={{ maxHeight: "72vh", cursor: "grab" }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onClickCapture={onClickCapture}
        >
          <table className="border-separate" style={{ borderSpacing: "4px" }}>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 min-w-[160px] bg-[#080c1a]" />
                {matrix.columns.map((legend) => (
                  <th
                    className="sticky top-0 z-20 bg-[#080c1a] px-0.5 pb-2 pt-1"
                    key={legend}
                    title={legend}
                  >
                    <Link
                      className="flex flex-col items-center gap-1 rounded-lg p-0.5 transition-colors hover:bg-white/5"
                      href={legendHref(legend)}
                    >
                      <LegendPortrait legend={legend} size={36} />
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((rowLegend) => (
                <tr key={rowLegend}>
                  <td
                    className="sticky left-0 z-10 pr-2"
                    style={{ background: "#080c1a" }}
                  >
                    <Link
                      className="flex min-w-[154px] items-center gap-2.5 rounded-[14px] border border-white/8 bg-white/[0.04] px-3 py-2.5 shadow-[2px_0_8px_rgba(0,0,0,0.4)] transition-colors hover:border-cyan-300/40 hover:bg-white/[0.06]"
                      href={legendHref(rowLegend)}
                    >
                      <LegendPortrait legend={rowLegend} size={34} />
                      <span className="max-w-[100px] truncate text-xs font-medium text-slate-300">
                        {rowLegend.split(" ")[0]}
                      </span>
                    </Link>
                  </td>
                  {matrix.columns.map((colLegend) => {
                    const cell = matrix.cells.find(
                      (c) => c.myLegend === rowLegend && c.oppLegend === colLegend,
                    );
                    const active =
                      cell && `${cell.myLegend}:::${cell.oppLegend}` === selectedKey;
                    const hasGames = (cell?.totalGames ?? 0) > 0;
                    const style = cellStyle(cell?.winRate ?? 0, hasGames, !!active);

                    return (
                      <td key={`${rowLegend}-${colLegend}`}>
                        <button
                          className="flex w-full min-w-[76px] flex-col items-center justify-center rounded-[14px] border px-2 py-3 text-center transition-all duration-200 hover:brightness-125"
                          onClick={() => {
                            if (!cell) return;
                            setSelectedKey(`${cell.myLegend}:::${cell.oppLegend}`);
                            setSelectedMatchId(null);
                          }}
                          style={style}
                          type="button"
                        >
                          <span
                            className={`text-sm leading-none ${winRateTextClass(cell?.winRate ?? 0, hasGames)}`}
                          >
                            {hasGames ? formatPercent(cell!.winRate) : "—"}
                          </span>
                          {hasGames && (
                            <span className="mt-1.5 text-[10px] leading-none text-slate-500">
                              {cell!.totalGames} {cell!.totalGames === 1 ? "match" : "matches"}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(340px,420px)_1fr]">
        <Card className="p-5">
          {selected ? (
            <MatchupSummary cell={selected} matches={selectedMatches} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center">
              <div className="mb-3 text-4xl opacity-20">⊞</div>
              <CardDescription>Select a cell to inspect the matchup</CardDescription>
            </div>
          )}
        </Card>
        <Card className="p-5">
          {selected ? (
            <MatchDetailPanel
              matches={selectedMatches}
              onSelect={setSelectedMatchId}
              selectedId={effectiveMatchId}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center">
              <CardDescription>Drill-down data appears here once you pick a cell.</CardDescription>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
