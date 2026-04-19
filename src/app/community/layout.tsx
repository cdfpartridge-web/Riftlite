import { CommunityNav } from "@/components/site/community-nav";

// Note: the meta-alerts strip used to live here. It was moved into the
// five overview pages (leaderboard, meta, matrix, matches, decks) via
// <CommunityMetaAlerts /> so that drill-down pages (player/legend/deck
// detail/compare) don't spend render time aggregating alerts that the
// visitor already saw on the way in.
export default function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-screen-2xl space-y-8 px-6 py-12">
      <CommunityNav />
      <div>{children}</div>
    </div>
  );
}
