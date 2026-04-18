"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getLegendImageUrl, getLegendInitials } from "@/lib/legends";
import type { DeckGroup } from "@/lib/types";
import { formatPercent } from "@/lib/utils";

type DeckCardProps = {
  deck: DeckGroup;
};

function LegendAvatar({ legend }: { legend: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/30 to-violet-500/30 ring-1 ring-white/15">
        <span className="font-display text-xl font-bold text-white">
          {getLegendInitials(legend)}
        </span>
      </div>
    );
  }
  return (
    <Image
      alt={legend}
      className="h-16 w-16 rounded-2xl object-cover ring-1 ring-white/15 shadow-[0_0_20px_rgba(89,167,255,0.2)]"
      height={64}
      src={getLegendImageUrl(legend)}
      width={64}
      onError={() => setFailed(true)}
    />
  );
}

export function DeckCard({ deck }: DeckCardProps) {
  const wrColor =
    deck.winRate >= 55
      ? "text-emerald-300"
      : deck.winRate < 45
        ? "text-rose-300"
        : "text-cyan-300";

  return (
    <Card className="card-hover flex h-full flex-col justify-between gap-5">
      <div className="space-y-4">
        <div className="flex items-start gap-4">
          <LegendAvatar legend={deck.legend} />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {deck.legend}
            </div>
            <CardTitle className="mt-1 text-lg leading-snug">{deck.title}</CardTitle>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3">
          <div className="text-center">
            <div className="text-sm font-bold text-white">{deck.games}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Games</div>
          </div>
          <div className="h-6 w-px bg-white/10" />
          <div className="text-center">
            <div className={`text-sm font-bold ${wrColor}`}>{formatPercent(deck.winRate)}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Win Rate</div>
          </div>
        </div>
      </div>
      <Link
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-300 transition-colors hover:text-cyan-200"
        href={`/community/decks/${encodeURIComponent(deck.deckKey)}`}
      >
        Open deck snapshot
        <span className="text-base leading-none">→</span>
      </Link>
    </Card>
  );
}
