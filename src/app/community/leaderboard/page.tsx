import { AdSlot } from "@/components/site/ad-slot";
import { CommunityFilterBar } from "@/components/site/community-filter-bar";
import { LeaderboardTable } from "@/components/site/leaderboard-table";
import { SectionHeading } from "@/components/site/section-heading";
import { parseFilters } from "@/lib/community/filters";
import { getLeaderboard } from "@/lib/community/service";
import { getAdSlots } from "@/lib/sanity/content";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const [rows, adSlots] = await Promise.all([getLeaderboard(filters), getAdSlots()]);

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Leaderboard"
        title="The decks topping Riftbound right now"
        description="Smart rankings that reward proven win rates over small-sample flukes — so the top of the board reflects real consistency."
      />
      <AdSlot placement="community-top" slots={adSlots} />
      <CommunityFilterBar filters={filters} />
      <LeaderboardTable rows={rows} />
    </div>
  );
}
