"use client";

import Image from "next/image";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { getLegendImageUrl, getLegendInitials } from "@/lib/legends";
import type { LegendMetaRow } from "@/lib/types";
import { formatPercent } from "@/lib/utils";

type MetaTableProps = {
  rows: LegendMetaRow[];
};

function LegendPortrait({ legend }: { legend: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500/25 to-violet-500/25 ring-1 ring-white/15">
        <span className="font-display text-[10px] font-bold text-white">
          {getLegendInitials(legend)}
        </span>
      </div>
    );
  }
  return (
    <Image
      alt={legend}
      className="h-9 w-9 flex-shrink-0 rounded-full object-cover ring-1 ring-white/15"
      height={36}
      src={getLegendImageUrl(legend)}
      width={36}
      onError={() => setFailed(true)}
    />
  );
}

function WinRateBar({ value }: { value: number }) {
  const color = value >= 55 ? "#49c187" : value >= 45 ? "#59a7ff" : "#ff6b7a";
  const textClass =
    value >= 55 ? "text-emerald-300" : value >= 45 ? "text-cyan-300" : "text-rose-300";
  return (
    <div className="flex items-center gap-2.5">
      <span className={`min-w-[46px] text-sm font-semibold tabular-nums ${textClass}`}>
        {formatPercent(value)}
      </span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, value)}%`, background: color }}
        />
      </div>
    </div>
  );
}

export function MetaTable({ rows }: MetaTableProps) {
  const maxGames = Math.max(...rows.map((r) => r.games), 1);

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left">
          <thead>
            <tr className="border-b border-white/6 bg-white/[0.03]">
              {["Legend", "Games", "Wins", "Losses", "Win Rate"].map((h) => (
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
            {rows.map((row, i) => (
              <tr
                className="border-t border-white/[0.04] transition-colors hover:bg-white/[0.025]"
                key={row.legend}
              >
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <LegendPortrait legend={row.legend} />
                    <div>
                      <div className="text-sm font-medium text-white">{row.legend}</div>
                      {i === 0 && (
                        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-amber-400/80">
                          Most played
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-300">{row.games}</span>
                    <div className="h-1 w-12 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full bg-white/20"
                        style={{ width: `${(row.games / maxGames) * 100}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-sm text-emerald-400">{row.wins}</td>
                <td className="px-5 py-3.5 text-sm text-rose-400">{row.losses}</td>
                <td className="px-5 py-3.5">
                  <WinRateBar value={row.winRate} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
