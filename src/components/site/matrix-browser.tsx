"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import type { CSSProperties } from "react";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getLegendImageUrl, getLegendInitials } from "@/lib/legends";
import type { CommunityMatch, MatchupCell, MatrixView } from "@/lib/types";
import { formatPercent } from "@/lib/utils";

type MatrixBrowserProps = {
  matrix: MatrixView;
  matches: CommunityMatch[];
};

function matchupMatches(matches: CommunityMatch[], cell: MatchupCell) {
  return matches.filter(
    (m) => m.myChampion === cell.myLegend && m.oppChampion === cell.oppLegend,
  );
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

export function MatrixBrowser({ matrix, matches }: MatrixBrowserProps) {
  const drag = useDragScroll();
  const firstCell = matrix.cells.find((c) => c.totalGames > 0);
  const [selectedKey, setSelectedKey] = useState(
    firstCell ? `${firstCell.myLegend}:::${firstCell.oppLegend}` : "",
  );

  const selected =
    matrix.cells.find((c) => `${c.myLegend}:::${c.oppLegend}` === selectedKey) ?? null;
  const selectedMatches = selected ? matchupMatches(matches, selected) : [];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      {/* Matrix grid */}
      <Card className="min-w-0 overflow-hidden p-5">
        <div className="mb-4 text-xs uppercase tracking-[0.2em] text-slate-500">
          Click any cell to inspect the matchup
        </div>
        <div
          className="overflow-auto"
          ref={drag.ref}
          style={{ maxHeight: "72vh", cursor: "grab" }}
          onMouseDown={drag.onMouseDown}
          onMouseMove={drag.onMouseMove}
          onMouseUp={drag.onMouseUp}
          onMouseLeave={drag.onMouseLeave}
          onClickCapture={drag.onClickCapture}
        >
          <table className="border-separate" style={{ borderSpacing: "4px" }}>
            <thead>
              <tr>
                {/* sticky corner */}
                <th className="sticky left-0 top-0 z-30 min-w-[160px] bg-[#080c1a]" />
                {matrix.columns.map((legend) => (
                  <th
                    className="sticky top-0 z-20 bg-[#080c1a] px-0.5 pb-2 pt-1"
                    key={legend}
                    title={legend}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <LegendPortrait legend={legend} size={36} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((rowLegend) => (
                <tr key={rowLegend}>
                  {/* sticky row header */}
                  <td
                    className="sticky left-0 z-10 pr-2"
                    style={{ background: "#080c1a" }}
                  >
                    <div className="flex min-w-[154px] items-center gap-2.5 rounded-[14px] border border-white/8 bg-white/[0.04] px-3 py-2.5 shadow-[2px_0_8px_rgba(0,0,0,0.4)]">
                      <LegendPortrait legend={rowLegend} size={34} />
                      <span className="max-w-[100px] truncate text-xs font-medium text-slate-300">
                        {rowLegend.split(" ")[0]}
                      </span>
                    </div>
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
                          onClick={() =>
                            cell ? setSelectedKey(`${cell.myLegend}:::${cell.oppLegend}`) : null
                          }
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
                              {cell!.totalGames}g
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

      {/* Detail panel */}
      <Card className="space-y-5">
        {selected ? (
          <>
            {/* Champion portraits side by side */}
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center gap-1.5">
                <LegendPortrait legend={selected.myLegend} size={52} />
                <span className="text-[11px] text-slate-400">
                  {selected.myLegend.split(" ")[0]}
                </span>
              </div>
              <div className="flex flex-1 flex-col items-center">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">vs</span>
                <div
                  className="mt-1 text-center text-2xl font-bold"
                  style={{
                    color:
                      selected.winRate >= 55
                        ? "var(--brand-win)"
                        : selected.winRate < 45
                          ? "var(--brand-loss)"
                          : "var(--brand-gold)",
                  }}
                >
                  {formatPercent(selected.winRate)}
                </div>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <LegendPortrait legend={selected.oppLegend} size={52} />
                <span className="text-[11px] text-slate-400">
                  {selected.oppLegend.split(" ")[0]}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-bold text-emerald-300">{selected.wins}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Wins</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-rose-300">{selected.losses}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Losses</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-slate-300">{selected.totalGames}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Total</div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
                Underlying matches
              </CardTitle>
              <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
                {selectedMatches.length === 0 ? (
                  <CardDescription>No match records for this cell.</CardDescription>
                ) : (
                  selectedMatches.map((match) => (
                    <div
                      className="rounded-[18px] border border-white/8 bg-slate-950/30 p-3.5"
                      key={match.id}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-white">{match.username}</span>
                        <span
                          className={`text-xs font-semibold ${
                            match.result === "Win"
                              ? "text-emerald-400"
                              : match.result === "Loss"
                                ? "text-rose-400"
                                : "text-slate-400"
                          }`}
                        >
                          {match.result}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {match.score || match.fmt}
                        {match.deckName ? ` · ${match.deckName}` : ""}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 text-4xl opacity-20">⊞</div>
            <CardDescription>Select a cell to inspect the matchup</CardDescription>
          </div>
        )}
      </Card>
    </div>
  );
}
