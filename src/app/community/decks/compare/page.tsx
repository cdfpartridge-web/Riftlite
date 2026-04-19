import Link from "next/link";

import { DeckComparePicker } from "@/components/site/deck-compare-picker";
import { LegendChip, legendHref } from "@/components/site/legend-chip";
import { SectionHeading } from "@/components/site/section-heading";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getDeckComparison, listAllDeckGroups } from "@/lib/community/service";
import type { DeckGroup } from "@/lib/types";
import { formatPercent } from "@/lib/utils";

export const revalidate = 600;

export const metadata = {
  title: "Deck comparison · RiftLite",
  description:
    "Put two Riftbound decks head to head — win rates, shared matchups, and card-for-card differences.",
};

function DeckSummaryCard({ deck, accent }: { deck: DeckGroup; accent: string }) {
  return (
    <Card className="relative space-y-3 overflow-hidden p-5">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-1"
        style={{ background: accent }}
      />
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: accent }}>
        {deck.legend}
      </div>
      <CardTitle className="text-lg font-semibold leading-snug">{deck.title}</CardTitle>
      <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2 text-center">
        <div>
          <div className="text-base font-bold text-white">{deck.games}</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Games</div>
        </div>
        <div>
          <div
            className={`text-base font-bold tabular-nums ${
              deck.winRate >= 55
                ? "text-emerald-300"
                : deck.winRate < 45
                  ? "text-rose-300"
                  : "text-slate-200"
            }`}
          >
            {formatPercent(deck.winRate)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Win rate</div>
        </div>
        <div>
          <div className="text-base font-bold text-slate-200">
            {deck.wins}–{deck.losses}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Record</div>
        </div>
      </div>
      <Link
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-300 hover:text-cyan-200"
        href={`/community/decks/${encodeURIComponent(deck.deckKey)}`}
      >
        Open deck snapshot →
      </Link>
    </Card>
  );
}

export default async function DeckComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const a = typeof params.a === "string" ? params.a : "";
  const b = typeof params.b === "string" ? params.b : "";

  if (!a || !b) {
    const decks = await listAllDeckGroups();
    return (
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SectionHeading
            eyebrow="Deck comparison"
            title="Put two decks head to head"
            description="See side-by-side win rates, shared opponents, and a card-for-card diff for any two community decks."
          />
          <Button asChild size="sm" variant="secondary">
            <Link href="/community/decks">← All decks</Link>
          </Button>
        </div>
        <DeckComparePicker decks={decks} initialA={a} initialB={b} />
      </div>
    );
  }

  const comparison = await getDeckComparison(a, b);
  if (!comparison) {
    const decks = await listAllDeckGroups();
    return (
      <div className="space-y-8">
        <SectionHeading
          eyebrow="Deck comparison"
          title="We couldn't find those two decks"
          description="Pick a fresh pair below — the keys in the URL may have gone stale as the meta rotates."
        />
        <DeckComparePicker decks={decks} initialA={a} initialB={b} />
      </div>
    );
  }

  const { a: deckA, b: deckB, cardDiff, sharedMatchups } = comparison;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading
          eyebrow="Deck comparison"
          title={`${deckA.title} vs ${deckB.title}`}
          description={`${deckA.legend} vs ${deckB.legend} · ${deckA.games + deckB.games} games tracked between the two.`}
        />
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button asChild size="sm" variant="secondary">
            <Link href="/community/decks/compare">Pick different decks</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DeckSummaryCard accent="#59A7FF" deck={deckA} />
        <DeckSummaryCard accent="#A67CFF" deck={deckB} />
      </div>

      <Card className="p-5">
        <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
          Shared matchups
        </CardTitle>
        <CardDescription className="mt-1">
          Opponents faced by either deck — lets you see who each deck handles better.
        </CardDescription>
        {sharedMatchups.length === 0 ? (
          <CardDescription className="mt-3">
            Not enough overlap yet — aim for at least 3 combined games per opponent.
          </CardDescription>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] border-separate" style={{ borderSpacing: 0 }}>
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <th className="pb-2 pr-3">Opponent</th>
                  <th className="pb-2 pr-3">
                    <span className="text-cyan-300">Deck A</span>
                  </th>
                  <th className="pb-2 pr-3">
                    <span className="text-violet-300">Deck B</span>
                  </th>
                  <th className="pb-2">Edge</th>
                </tr>
              </thead>
              <tbody>
                {sharedMatchups.map((row) => {
                  const diff = row.aWinRate - row.bWinRate;
                  const edge =
                    row.aGames === 0 || row.bGames === 0
                      ? "—"
                      : `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pts ${diff >= 0 ? "A" : "B"}`;
                  const edgeClass =
                    row.aGames === 0 || row.bGames === 0
                      ? "text-slate-500"
                      : diff >= 0
                        ? "text-cyan-300"
                        : "text-violet-300";
                  return (
                    <tr className="border-t border-white/5 text-sm" key={row.oppLegend}>
                      <td className="py-2 pr-3">
                        <LegendChip
                          href={legendHref(row.oppLegend)}
                          legend={row.oppLegend}
                          size={22}
                        />
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-300">
                        {row.aGames === 0
                          ? "—"
                          : `${row.aWins}/${row.aGames} (${formatPercent(row.aWinRate)})`}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-300">
                        {row.bGames === 0
                          ? "—"
                          : `${row.bWins}/${row.bGames} (${formatPercent(row.bWinRate)})`}
                      </td>
                      <td className={`py-2 text-xs font-semibold ${edgeClass}`}>{edge}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
          Card diff
        </CardTitle>
        {!cardDiff ? (
          <CardDescription className="mt-3">
            Neither deck has a tracked snapshot yet — import one from a source to unlock this view.
          </CardDescription>
        ) : (
          <div className="mt-4 grid gap-6 lg:grid-cols-3">
            <DiffColumn
              accent="#59A7FF"
              emptyLabel="Nothing unique to A."
              entries={cardDiff.onlyA.map((entry) => ({
                name: entry.name,
                detail: `×${entry.qty}`,
              }))}
              title="Only in Deck A"
            />
            <DiffColumn
              accent="#94A3B8"
              emptyLabel="No shared cards with matching names."
              entries={cardDiff.shared.map((entry) => ({
                name: entry.name,
                detail: `${entry.qtyA === entry.qtyB ? `×${entry.qtyA}` : `A×${entry.qtyA} · B×${entry.qtyB}`}`,
                drift: entry.qtyA !== entry.qtyB,
              }))}
              title="Shared cards"
            />
            <DiffColumn
              accent="#A67CFF"
              emptyLabel="Nothing unique to B."
              entries={cardDiff.onlyB.map((entry) => ({
                name: entry.name,
                detail: `×${entry.qty}`,
              }))}
              title="Only in Deck B"
            />
          </div>
        )}
      </Card>
    </div>
  );
}

function DiffColumn({
  accent,
  emptyLabel,
  entries,
  title,
}: {
  accent: string;
  emptyLabel: string;
  entries: Array<{ name: string; detail: string; drift?: boolean }>;
  title: string;
}) {
  return (
    <div>
      <div
        className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em]"
        style={{ color: accent }}
      >
        {title}
      </div>
      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/8 bg-white/[0.02] px-3 py-4 text-center text-xs text-slate-500">
          {emptyLabel}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((entry) => (
            <li
              className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-1.5 text-xs"
              key={entry.name + entry.detail}
            >
              <span className="truncate text-slate-200">{entry.name}</span>
              <span
                className={`flex-shrink-0 tabular-nums ${
                  entry.drift ? "text-amber-300" : "text-slate-400"
                }`}
              >
                {entry.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
