import Link from "next/link";

import { Card } from "@/components/ui/card";
import type { LeaderboardRow } from "@/lib/types";
import { formatPercent } from "@/lib/utils";

type LeaderboardTableProps = {
  rows: LeaderboardRow[];
};

const RANK_STYLES: Record<number, { badge: string; row: string }> = {
  1: {
    badge: "bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/40",
    row: "bg-amber-400/[0.03]",
  },
  2: {
    badge: "bg-slate-300/15 text-slate-300 ring-1 ring-slate-300/30",
    row: "bg-slate-300/[0.02]",
  },
  3: {
    badge: "bg-amber-700/20 text-amber-600 ring-1 ring-amber-700/30",
    row: "bg-amber-700/[0.025]",
  },
};

function WinRateBar({ value }: { value: number }) {
  const color = value >= 55 ? "#49c187" : value >= 45 ? "#59a7ff" : "#ff6b7a";
  const textClass =
    value >= 55 ? "text-emerald-300" : value >= 45 ? "text-cyan-300" : "text-rose-300";
  return (
    <div className="flex items-center gap-2">
      <span className={`min-w-[44px] text-sm font-semibold tabular-nums ${textClass}`}>
        {formatPercent(value)}
      </span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, value)}%`, background: color }}
        />
      </div>
    </div>
  );
}

export function LeaderboardTable({ rows }: LeaderboardTableProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left">
          <thead>
            <tr className="border-b border-white/6 bg-white/[0.03]">
              {["Rank", "Player", "Games", "Win Rate", "Confidence", "Record"].map((h) => (
                <th
                  className="px-5 py-3.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"
                  key={h}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rankStyle = RANK_STYLES[row.rank];
              return (
                <tr
                  className={`border-t border-white/[0.04] transition-colors hover:bg-white/[0.03] ${rankStyle?.row ?? ""}`}
                  key={row.player}
                >
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${rankStyle ? rankStyle.badge : "text-slate-500"}`}
                    >
                      {row.rank}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <Link
                      className="text-sm font-semibold text-white underline-offset-4 hover:text-cyan-200 hover:underline"
                      href={`/community/players/${encodeURIComponent(row.player)}`}
                    >
                      {row.player}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-slate-300">{row.games}</td>
                  <td className="px-5 py-3.5">
                    <WinRateBar value={row.winRate} />
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-sky-300 tabular-nums">
                        {formatPercent(row.confidenceScore * 100)}
                      </span>
                      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-white/8">
                        <div
                          className="h-full rounded-full bg-sky-400/60"
                          style={{ width: `${Math.min(100, row.confidenceScore * 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-slate-400">
                    <span className="text-emerald-400">{row.wins}</span>
                    <span className="mx-1 text-white/20">/</span>
                    <span className="text-rose-400">{row.losses}</span>
                    {row.draws ? (
                      <>
                        <span className="mx-1 text-white/20">/</span>
                        <span className="text-slate-400">{row.draws}D</span>
                      </>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
