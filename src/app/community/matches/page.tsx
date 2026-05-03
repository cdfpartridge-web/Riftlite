import { CommunityFilterBar } from "@/components/site/community-filter-bar";
import { MatchesBrowser } from "@/components/site/matches-browser";
import { SectionHeading } from "@/components/site/section-heading";
import { parseFilters } from "@/lib/community/filters";
import { getPaginatedMatches } from "@/lib/community/service";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Recent Riftbound Matches",
  description:
    "Browse recent community Riftbound matches with legends, results, points, battlefields, and game-by-game details.",
  path: "/community/matches",
});

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
        headingLevel={1}
        title="See how the latest games actually played out"
        description="Click any match for a full game-by-game breakdown — battlefields, points, and the moment things turned."
      />
      <CommunityFilterBar filters={filters} />
      <MatchesBrowser matches={data.items} />
    </div>
  );
}
