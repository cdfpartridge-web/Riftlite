import { notFound } from "next/navigation";

import { ProfileMatchExplorer } from "@/components/site/profile-match-explorer";
import { SectionHeading } from "@/components/site/section-heading";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getPublicProfileByHandle } from "@/lib/social/server";
import type { CommunityMatch } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const decoded = decodeURIComponent(handle);
  return {
    title: `${decoded} | RiftLite profile`,
    description: "Public RiftLite player profile with opted-in match history, filters, deck snapshots, and game drilldowns.",
  };
}

function sanitizeMatches(matches: CommunityMatch[], showDecks: boolean): CommunityMatch[] {
  if (showDecks) return matches;
  return matches.map((match) => ({
    ...match,
    deckName: "",
    deckSourceKey: "",
    deckSourceUrl: "",
    deckSnapshot: null,
  }));
}

export default async function UserProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const result = await getPublicProfileByHandle(decodeURIComponent(handle));
  if (!result) notFound();

  const { profile, aggregate } = result;
  const matches = profile.showMatches
    ? sanitizeMatches(aggregate.recentMatches, profile.showDecks)
    : [];
  const updatedLabel = aggregate.updatedAt ? formatDate(new Date(aggregate.updatedAt).toISOString()) : "Unknown";

  return (
    <div className="mx-auto max-w-[1500px] space-y-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeading
          eyebrow="RiftLite Profile"
          title={profile.displayName || profile.handle}
          description={`@${profile.handle} - Public, opted-in RiftLite profile. Community-submitted matches only.`}
        />
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Profile data
          </div>
          <div className="mt-1">
            {matches.length} public matches loaded - updated {updatedLabel}
          </div>
        </div>
      </div>

      {!profile.showMatches ? (
        <Card>
          <CardTitle>Match history hidden</CardTitle>
          <CardDescription className="mt-2">
            This player has made their profile public but kept their public match history private.
          </CardDescription>
        </Card>
      ) : (
        <ProfileMatchExplorer
          displayName={profile.displayName}
          handle={profile.handle}
          matches={matches}
          showDecks={profile.showDecks}
          showStats={profile.showStats}
        />
      )}
    </div>
  );
}
