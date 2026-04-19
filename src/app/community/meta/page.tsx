import { AdSlot } from "@/components/site/ad-slot";
import { CommunityFilterBar } from "@/components/site/community-filter-bar";
import { CommunityMetaAlerts } from "@/components/site/community-meta-alerts";
import { MetaTable } from "@/components/site/meta-table";
import { SectionHeading } from "@/components/site/section-heading";
import { parseFilters } from "@/lib/community/filters";
import { getLegendMeta } from "@/lib/community/service";
import { getAdSlots } from "@/lib/sanity/content";

export default async function MetaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const [rows, adSlots] = await Promise.all([getLegendMeta(filters), getAdSlots()]);

  return (
    <div className="space-y-8">
      <CommunityMetaAlerts />
      <SectionHeading
        eyebrow="Legend Meta"
        title="Which legends are actually winning?"
        description="Win rates and play counts for every legend, ranked by popularity so you can see what's defining the meta this week."
      />
      <AdSlot placement="community-top" slots={adSlots} />
      <CommunityFilterBar filters={filters} />
      <MetaTable rows={rows} />
    </div>
  );
}
