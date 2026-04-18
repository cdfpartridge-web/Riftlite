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
        title="Confidence-ranked public win rates"
        description="Rankings use the same Wilson lower-bound logic as the desktop app, balancing win rate against sample size."
      />
      <CommunityFilterBar filters={filters} />
      <LeaderboardTable rows={rows} />
    </div>
  );
}
