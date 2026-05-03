import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CopyDeckButton } from "@/components/site/copy-deck-button";
import { MatchesBrowser } from "@/components/site/matches-browser";
import { SectionHeading } from "@/components/site/section-heading";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { getDeckDetail } from "@/lib/community/service";
import { createPageMetadata } from "@/lib/seo";
import type { DeckSnapshot } from "@/lib/types";
import { formatPercent, safeHref } from "@/lib/utils";

type Props = {
  params: Promise<{ deckKey: string }>;
};

function toPiltoverArchiveText(snapshot: DeckSnapshot): string {
  const sections: string[] = [];

  if (snapshot.legendEntry) {
    sections.push(`Legend:\n${snapshot.legendEntry.qty} ${snapshot.legendEntry.name}`);
  }

  if (snapshot.champion && snapshot.champion.length > 0) {
    sections.push(
      `Champion:\n${snapshot.champion.map((e) => `${e.qty} ${e.name}`).join("\n")}`,
    );
  }

  if (snapshot.mainDeck.length > 0) {
    sections.push(
      `MainDeck:\n${snapshot.mainDeck.map((e) => `${e.qty} ${e.name}`).join("\n")}`,
    );
  }

  if (snapshot.battlefields.length > 0) {
    sections.push(
      `Battlefields:\n${snapshot.battlefields.map((e) => `${e.qty} ${e.name}`).join("\n")}`,
    );
  }

  if (snapshot.runes.length > 0) {
    sections.push(
      `Runes:\n${snapshot.runes.map((e) => `${e.qty} ${e.name}`).join("\n")}`,
    );
  }

  if (snapshot.sideboard.length > 0) {
    sections.push(
      `Sideboard:\n${snapshot.sideboard.map((e) => `${e.qty} ${e.name}`).join("\n")}`,
    );
  }

  return sections.join("\n\n");
}

function DeckSection({
  label,
  entries,
}: {
  label: string;
  entries: DeckSnapshot["mainDeck"];
}) {
  if (!entries || entries.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">
          {label}
        </div>
        <div className="h-px flex-1 bg-white/6" />
        <div className="text-[10px] text-slate-600">{entries.length} card{entries.length !== 1 ? "s" : ""}</div>
      </div>
      <div className="space-y-1">
        {entries.map((entry) => (
          <div
            className="flex items-center justify-between rounded-xl border border-white/6 bg-white/[0.03] px-3.5 py-2.5 transition-colors hover:bg-white/[0.05]"
            key={`${label}-${entry.cardId ?? entry.name}`}
          >
            <span className="text-sm text-slate-200">{entry.name}</span>
            <span className="min-w-[28px] rounded-lg bg-white/8 px-2 py-0.5 text-center text-xs font-bold text-slate-300">
              ×{entry.qty}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { deckKey } = await params;
  const decodedKey = decodeURIComponent(deckKey);
  const detail = await getDeckDetail(decodedKey);

  if (!detail.deck) {
    return createPageMetadata({
      title: "Deck Not Found",
      description: "This Riftbound community deck could not be found.",
      path: `/community/decks/${encodeURIComponent(decodedKey)}`,
      noIndex: true,
    });
  }

  const { deck } = detail;
  return createPageMetadata({
    title: `${deck.title} Deck Snapshot`,
    description: `${deck.legend} Riftbound deck snapshot with ${deck.games} tracked games and a ${formatPercent(deck.winRate)} win rate.`,
    path: `/community/decks/${encodeURIComponent(deck.deckKey)}`,
  });
}

export default async function DeckDetailPage({
  params,
}: Props) {
  const { deckKey } = await params;
  const detail = await getDeckDetail(decodeURIComponent(deckKey));

  if (!detail.deck) {
    notFound();
  }

  const { deck } = detail;
  const snapshot = deck.snapshot;
  const copyText = snapshot ? toPiltoverArchiveText(snapshot) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading
          eyebrow="Deck Detail"
          headingLevel={1}
          title={deck.title}
          description={`${deck.legend} · ${deck.games} games · ${formatPercent(deck.winRate)} win rate`}
        />
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {copyText && <CopyDeckButton text={copyText} />}
          <Button asChild size="sm" variant="secondary">
            <Link href={`/community/decks/compare?a=${encodeURIComponent(deck.deckKey)}`}>
              Compare vs…
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href="/community/decks">← Back to decks</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
        {/* Deck list */}
        <div className="space-y-5">
          {snapshot ? (
            <Card className="space-y-6 p-5">
              {snapshot.legendEntry && (
                <DeckSection label="Legend" entries={[snapshot.legendEntry]} />
              )}
              {snapshot.champion && snapshot.champion.length > 0 && (
                <DeckSection label="Champion" entries={snapshot.champion} />
              )}
              <DeckSection label="Main Deck" entries={snapshot.mainDeck} />
              <DeckSection label="Battlefields" entries={snapshot.battlefields} />
              <DeckSection label="Runes" entries={snapshot.runes} />
              <DeckSection label="Sideboard" entries={snapshot.sideboard} />
            </Card>
          ) : (
            <Card>
              <div className="py-8 text-center text-sm text-slate-500">
                No deck snapshot available for this group.
              </div>
            </Card>
          )}

          {deck.sourceUrl && (
            <Card className="p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">
                Source
              </div>
              <Link
                className="mt-2 block truncate text-sm text-cyan-300 underline-offset-4 hover:underline"
                href={safeHref(deck.sourceUrl)}
              >
                {deck.sourceUrl}
              </Link>
            </Card>
          )}
        </div>

        {/* Matches */}
        <div className="space-y-4">
          <CardTitle className="text-base font-semibold text-slate-400">
            Matches using this deck
          </CardTitle>
          {detail.matches.length > 0 ? (
            <MatchesBrowser matches={detail.matches} />
          ) : (
            <Card>
              <div className="py-8 text-center text-sm text-slate-500">
                No match records for this deck group.
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
