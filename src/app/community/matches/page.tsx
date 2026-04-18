import { CommunityFilterBar } from "@/components/site/community-filter-bar";
import { MatchesBrowser } from "@/components/site/matches-browser";
import { SectionHeading } from "@/components/site/section-heading";
import { parseFilters } from "@/lib/community/filters";
import { getPaginatedMatches } from "@/lib/community/service";

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const data = await getPaginatedMatches(filters);

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Recent Matches"
        title="Browse the latest shared community matches"
        description="The selected row reveals the per-game battlefield and points breakdown extracted from the stored game data."
      />
      <CommunityFilterBar filters={filters} />
      <MatchesBrowser matches={data.items} />
    </div>
  );
}
