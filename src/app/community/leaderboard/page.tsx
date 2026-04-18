import { CommunityFilterBar } from "@/components/site/community-filter-bar";
import { LeaderboardTable } from "@/components/site/leaderboard-table";
import { SectionHeading } from "@/components/site/section-heading";
import { parseFilters } from "@/lib/community/filters";
import { getLeaderboard } from "@/lib/community/service";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const rows = await getLeaderboard(filters);

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Leaderboard"
        title="The decks topping Riftbound right now"
        description="Smart rankings that reward proven win rates over small-sample flukes — so the top of the board reflects real consistency."
      />
      <CommunityFilterBar filters={filters} />
      <LeaderboardTable rows={rows} />
    </div>
  );
}
