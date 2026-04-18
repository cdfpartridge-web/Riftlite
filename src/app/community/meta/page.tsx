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
        title="Which legends are actually winning?"
        description="Win rates and play counts for every legend, ranked by popularity so you can see what's defining the meta this week."
      />
      <CommunityFilterBar filters={filters} />
      <MetaTable rows={rows} />
    </div>
  );
}
