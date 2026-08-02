import { PublicProfileDirectory } from "@/components/site/public-profile-directory";
import { SectionHeading } from "@/components/site/section-heading";
import { searchDiscoverablePublicProfiles } from "@/lib/social/server";
import { createPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "RiftLite Player Profiles",
  description: "Find opted-in RiftLite player profiles with public match history, deck snapshots, stats, and Web Replays.",
  path: "/players",
});

export default async function PlayersPage() {
  const profiles = await searchDiscoverablePublicProfiles("", 24);
  return (
    <div className="space-y-8 py-10">
      <SectionHeading
        eyebrow="RiftLite players"
        headingLevel={1}
        title="Public player profiles"
        description="A home for the history behind the numbers: opted-in match results, decks, performance, and watchable Public Web Replays."
      />
      <PublicProfileDirectory initialProfiles={profiles} />
    </div>
  );
}
