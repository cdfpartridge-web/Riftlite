import { CommunityFilterBar } from "@/components/site/community-filter-bar";
import { DeckCard } from "@/components/site/deck-card";
import { SectionHeading } from "@/components/site/section-heading";
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
      <SectionHeading
        eyebrow="Decks"
        title="Browse what the community is playing"
        description="Decks grouped intelligently by composition, so you can spot the popular builds and the off-meta gems winning right now."
      />
      <CommunityFilterBar filters={filters} />
      <div className="grid gap-6 md:grid-cols-2">
        {data.items.map((deck) => (
          <DeckCard deck={deck} key={deck.deckKey} />
        ))}
      </div>
    </div>
  );
}
