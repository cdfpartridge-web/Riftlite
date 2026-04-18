import { CommunityFilterBar } from "@/components/site/community-filter-bar";
import { MetaTable } from "@/components/site/meta-table";
import { SectionHeading } from "@/components/site/section-heading";
import { parseFilters } from "@/lib/community/filters";
import { getLegendMeta } from "@/lib/community/service";

export default async function MetaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const rows = await getLegendMeta(filters);

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Legend Meta"
        title="Win rates by legend across the public community feed"
        description="Legends are sorted by games played so the busiest archetypes rise to the top."
      />
      <CommunityFilterBar filters={filters} />
      <MetaTable rows={rows} />
    </div>
  );
}
