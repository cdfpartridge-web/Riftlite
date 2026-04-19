import { CommunityFilterBar } from "@/components/site/community-filter-bar";
import { CommunityMetaAlerts } from "@/components/site/community-meta-alerts";
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
      <CommunityMetaAlerts />
      <SectionHeading
        eyebrow="Recent Matches"
        title="See how the latest games actually played out"
        description="Click any match for a full game-by-game breakdown — battlefields, points, and the moment things turned."
      />
      <CommunityFilterBar filters={filters} />
      <MatchesBrowser matches={data.items} />
    </div>
  );
}
