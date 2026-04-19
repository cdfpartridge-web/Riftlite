import Link from "next/link";

import { CommunityFilterBar } from "@/components/site/community-filter-bar";
import { CommunityMetaAlerts } from "@/components/site/community-meta-alerts";
import { DeckCard } from "@/components/site/deck-card";
import { SectionHeading } from "@/components/site/section-heading";
import { Button } from "@/components/ui/button";
import { parseFilters } from "@/lib/community/filters";
import { getPaginatedDecks } from "@/lib/community/service";

export default async function DecksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const data = await getPaginatedDecks(filters);

  return (
    <div className="space-y-8">
      <CommunityMetaAlerts />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading
          eyebrow="Decks"
          title="Browse what the community is playing"
          description="Decks grouped intelligently by composition, so you can spot the popular builds and the off-meta gems winning right now."
        />
        <Button asChild size="sm" variant="secondary">
          <Link href="/community/decks/compare">Compare two decks →</Link>
        </Button>
      </div>
      <CommunityFilterBar filters={filters} />
      <div className="grid gap-6 md:grid-cols-2">
        {data.items.map((deck) => (
          <DeckCard deck={deck} key={deck.deckKey} />
        ))}
      </div>
    </div>
  );
}
