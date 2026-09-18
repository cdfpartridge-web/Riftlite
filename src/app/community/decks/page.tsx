import { DateFilterLink as Link } from "@/components/site/date-filter-link";

import { CommunityFilterBar } from "@/components/site/community-filter-bar";
import { DeckCard } from "@/components/site/deck-card";
import { SectionHeading } from "@/components/site/section-heading";
import { Button } from "@/components/ui/button";
import { parseFilters } from "@/lib/community/filters";
import { getPaginatedDecks } from "@/lib/community/service";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Riftbound Community Decks",
  description:
    "Browse Riftbound community decks grouped by composition, with win rates, play counts, matchups, and deck snapshots.",
  path: "/community/decks",
});

export default async function DecksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const data = await getPaginatedDecks(filters);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading
          eyebrow="Decks"
          headingLevel={1}
          title="Browse what the community is playing"
          description="Decks grouped intelligently by composition, so you can spot the popular builds and the off-meta gems winning right now."
        />
        <Button asChild size="sm" variant="secondary">
          <Link href="/community/decks/compare">Compare two decks →</Link>
        </Button>
      </div>
      <CommunityFilterBar key={JSON.stringify(filters)} filters={filters} />
      {!data.items.length ? <p className="rounded-2xl border border-white/10 p-5 text-sm text-slate-300">No deck results in the available history for these filters. Try another date or clear the filters.</p> : null}
      <div className="grid gap-6 md:grid-cols-2">
        {data.items.map((deck) => (
          <DeckCard deck={deck} key={deck.deckKey} />
        ))}
      </div>
    </div>
  );
}
