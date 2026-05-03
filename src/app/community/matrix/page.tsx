import { AdSlot } from "@/components/site/ad-slot";
import { CommunityFilterBar } from "@/components/site/community-filter-bar";
import { MatrixBrowser } from "@/components/site/matrix-browser";
import { SectionHeading } from "@/components/site/section-heading";
import { parseFilters } from "@/lib/community/filters";
import { getFilteredCommunityMatches, getMatrix } from "@/lib/community/service";
import { getAdSlots } from "@/lib/sanity/content";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Riftbound Matchup Matrix",
  description:
    "Study the Riftbound matchup matrix with legend head-to-head win rates and recent community match data.",
  path: "/community/matrix",
});

export default async function MatrixPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const [matrix, matches, adSlots] = await Promise.all([
    getMatrix(filters),
    getFilteredCommunityMatches(filters),
    getAdSlots(),
  ]);

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Match Matrix"
        headingLevel={1}
        title="Find the matchups that swing your win rate"
        description="Every cell shows the head-to-head win rate between two legends — click through to study the actual games behind the numbers."
      />
      <AdSlot placement="community-top" slots={adSlots} />
      <CommunityFilterBar filters={filters} />
      <MatrixBrowser matches={matches} matrix={matrix} />
    </div>
  );
}
