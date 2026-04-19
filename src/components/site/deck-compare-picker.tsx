"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { DeckGroup } from "@/lib/types";
import { formatPercent } from "@/lib/utils";

type DeckComparePickerProps = {
  decks: DeckGroup[];
  initialA?: string;
  initialB?: string;
};

export function DeckComparePicker({ decks, initialA, initialB }: DeckComparePickerProps) {
  const router = useRouter();
  const [a, setA] = useState(initialA ?? "");
  const [b, setB] = useState(initialB ?? "");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return decks.slice(0, 80);
    return decks
      .filter(
        (d) =>
          d.title.toLowerCase().includes(q) || d.legend.toLowerCase().includes(q),
      )
      .slice(0, 80);
  }, [decks, query]);

  const canCompare = a && b && a !== b;

  function pick(key: string) {
    if (!a) {
      setA(key);
      return;
    }
    if (!b) {
      setB(key);
      return;
    }
    // Both filled: replace the oldest slot.
    setB(key);
  }

  function clear(slot: "a" | "b") {
    if (slot === "a") setA("");
    else setB("");
  }

  function submit() {
    if (!canCompare) return;
    const params = new URLSearchParams({ a, b });
    router.push(`/community/decks/compare?${params.toString()}`);
  }

  function decksByKey(key: string): DeckGroup | undefined {
    return decks.find((d) => d.deckKey === key);
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Slot
          deck={a ? decksByKey(a) : undefined}
          label="Deck A"
          onClear={() => clear("a")}
        />
        <Slot
          deck={b ? decksByKey(b) : undefined}
          label="Deck B"
          onClear={() => clear("b")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="h-10 w-full max-w-xs rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-slate-200 outline-none ring-cyan-400/30 transition-colors focus:border-cyan-400/50 focus:ring-1"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search decks by title or legend…"
          type="search"
          value={query}
        />
        <Button disabled={!canCompare} onClick={submit} size="sm">
          Compare →
        </Button>
        {canCompare ? (
          <Link
            className="text-xs font-semibold text-slate-500 hover:text-slate-300"
            href="/community/decks"
          >
            Cancel
          </Link>
        ) : null}
      </div>

      <Card className="p-4">
        <CardTitle className="text-xs uppercase tracking-[0.22em] text-slate-500">
          Pick two decks
        </CardTitle>
        {filtered.length === 0 ? (
          <CardDescription className="mt-2">No decks match that search.</CardDescription>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((deck) => {
              const selected = deck.deckKey === a || deck.deckKey === b;
              return (
                <button
                  className={`flex flex-col gap-1 rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                    selected
                      ? "border-cyan-400/60 bg-cyan-400/10"
                      : "border-white/6 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]"
                  }`}
                  key={deck.deckKey}
                  onClick={() => pick(deck.deckKey)}
                  type="button"
                >
                  <div className="truncate text-sm font-semibold text-white">{deck.title}</div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">{deck.legend}</span>
                    <span className="flex items-center gap-2 text-slate-400">
                      <span>{deck.games}g</span>
                      <span
                        className={`font-semibold tabular-nums ${
                          deck.winRate >= 55
                            ? "text-emerald-300"
                            : deck.winRate < 45
                              ? "text-rose-300"
                              : "text-slate-200"
                        }`}
                      >
                        {formatPercent(deck.winRate)}
                      </span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function Slot({
  deck,
  label,
  onClear,
}: {
  deck: DeckGroup | undefined;
  label: string;
  onClear: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </div>
      {deck ? (
        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{deck.title}</div>
            <div className="text-[11px] text-slate-500">
              {deck.legend} · {deck.games} games · {formatPercent(deck.winRate)}
            </div>
          </div>
          <button
            className="text-xs text-slate-500 hover:text-rose-300"
            onClick={onClear}
            type="button"
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="mt-2 text-sm text-slate-500">Select a deck below.</div>
      )}
    </div>
  );
}
