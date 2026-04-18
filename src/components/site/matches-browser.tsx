"use client";

import { useState } from "react";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { CommunityMatch } from "@/lib/types";
import { formatDate } from "@/lib/utils";

type MatchesBrowserProps = {
  matches: CommunityMatch[];
};

function ResultBadge({ result }: { result: string }) {
  const style =
    result === "Win"
      ? "bg-emerald-400/12 text-emerald-300 ring-1 ring-emerald-400/25"
      : result === "Loss"
        ? "bg-rose-400/12 text-rose-300 ring-1 ring-rose-400/25"
        : "bg-white/8 text-slate-400 ring-1 ring-white/12";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>
      {result}
    </span>
  );
}

export function MatchesBrowser({ matches }: MatchesBrowserProps) {
  const [selectedId, setSelectedId] = useState(matches[0]?.id ?? "");
  const selected = matches.find((m) => m.id === selectedId) ?? matches[0];

  return (
    <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead>
              <tr className="border-b border-white/6 bg-white/[0.03]">
                {["Date", "Player", "Result", "Legend", "Vs", "Deck", "Format"].map((h) => (
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
              {matches.map((match) => {
                const active = match.id === selectedId;
                return (
                  <tr
                    className={`cursor-pointer border-t border-white/[0.04] text-sm transition-colors hover:bg-white/[0.03] ${active ? "bg-cyan-300/[0.04]" : ""}`}
                    key={match.id}
                    onClick={() => setSelectedId(match.id)}
                  >
                    <td className="px-5 py-3.5 text-slate-500">{formatDate(match.date)}</td>
                    <td className="px-5 py-3.5 font-medium text-white">{match.username}</td>
                    <td className="px-5 py-3.5">
                      <ResultBadge result={match.result} />
                    </td>
                    <td className="px-5 py-3.5 text-slate-200">{match.myChampion}</td>
                    <td className="px-5 py-3.5 text-slate-400">{match.oppChampion}</td>
                    <td className="max-w-[120px] truncate px-5 py-3.5 text-slate-400">
                      {match.deckName || "—"}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">{match.fmt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-5">
        {selected ? (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <CardTitle>{selected.username}</CardTitle>
                <ResultBadge result={selected.result} />
              </div>
              <CardDescription>
                {selected.myChampion} vs {selected.oppChampion} · {selected.score || selected.fmt}
              </CardDescription>
              {selected.deckName && (
                <div className="text-xs text-slate-500">{selected.deckName}</div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Games
              </div>
              <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
                {selected.games.map((game, index) => (
                  <div
                    className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3.5"
                    key={`${selected.id}-${index}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Game {index + 1}
                      </span>
                      <ResultBadge result={game.result} />
                    </div>
                    <div className="mt-2 text-sm text-slate-300">
                      {game.wentFirst || "Seat unknown"}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      BF: {game.myBf || "—"} vs {game.oppBf || "—"} · {game.myPoints}–{game.oppPoints} pts
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <CardDescription>No matches available for the current filters.</CardDescription>
        )}
      </Card>
    </div>
  );
}
