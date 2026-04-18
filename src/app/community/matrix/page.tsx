import { CommunityFilterBar } from "@/components/site/community-filter-bar";
import { MatrixBrowser } from "@/components/site/matrix-browser";
import { SectionHeading } from "@/components/site/section-heading";
import { parseFilters } from "@/lib/community/filters";
import { getFilteredCommunityMatches, getMatrix } from "@/lib/community/service";

export default async function MatrixPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const [matrix, matches] = await Promise.all([
    getMatrix(filters),
    getFilteredCommunityMatches(filters),
  ]);

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Match Matrix"
        title="See which public matchups are trending up or down"
        description="Each cell shows the filtered win rate for a specific matchup and opens the underlying matches on click."
      />
      <CommunityFilterBar filters={filters} />
      <MatrixBrowser matches={matches} matrix={matrix} />
    </div>
  );
}
