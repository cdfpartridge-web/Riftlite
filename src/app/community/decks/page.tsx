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
        title="Grouped public deck snapshots"
        description="Deck groups are clustered by shared source key when available, with snapshot hashing as the fallback."
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
