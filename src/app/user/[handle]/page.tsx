import { notFound } from "next/navigation";

import { LegendChip, legendHref } from "@/components/site/legend-chip";
import { SectionHeading } from "@/components/site/section-heading";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getPublicProfileByHandle } from "@/lib/social/server";
import { formatDate, formatPercent } from "@/lib/utils";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return {
    title: `${decodeURIComponent(handle)} | RiftLite profile`,
    description: "Public RiftLite player profile with opted-in community match data.",
  };
}

export default async function UserProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const result = await getPublicProfileByHandle(decodeURIComponent(handle));
  if (!result) notFound();
  const { profile, aggregate } = result;
  const recent = profile.showMatches ? aggregate.recentMatches : [];

  return (
    <div className="space-y-8 py-8">
      <SectionHeading
        eyebrow="RiftLite Profile"
        title={profile.displayName || profile.handle}
        description={`@${profile.handle} - Public, opted-in RiftLite profile. Community-submitted matches only.`}
      />

      {profile.showStats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ProfileStat label="Matches" value={String(aggregate.totalMatches)} />
          <ProfileStat label="Win rate" value={formatPercent(aggregate.winRate)} />
          <ProfileStat label="Record" value={`${aggregate.wins}-${aggregate.losses}`} />
          <ProfileStat label="Top legend" value={aggregate.topLegend || "None"} />
        </div>
      ) : (
        <Card>
          <CardTitle>Stats hidden</CardTitle>
          <CardDescription className="mt-2">This player has made their profile public but kept stats private.</CardDescription>
        </Card>
      )}

      <Card className="p-5">
        <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">Recent public matches</CardTitle>
        {recent.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] border-separate" style={{ borderSpacing: 0 }}>
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3">Legend</th>
                  <th className="pb-2 pr-3">Opponent</th>
                  <th className="pb-2 pr-3">Result</th>
                  <th className="pb-2 pr-3">Format</th>
                  <th className="pb-2">Deck</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((match) => (
                  <tr className="border-t border-white/5 text-sm" key={match.id}>
                    <td className="py-2 pr-3 text-xs text-slate-400">{formatDate(match.date)}</td>
                    <td className="py-2 pr-3"><LegendChip href={legendHref(match.myChampion)} legend={match.myChampion} size={24} /></td>
                    <td className="py-2 pr-3"><LegendChip href={legendHref(match.oppChampion)} legend={match.oppChampion} size={24} /></td>
                    <td className="py-2 pr-3 font-semibold text-cyan-200">{match.result}</td>
                    <td className="py-2 pr-3 text-slate-300">{match.fmt}</td>
                    <td className="py-2 text-slate-300">{profile.showDecks ? match.deckName || "No deck" : "Hidden"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <CardDescription className="mt-3">No public matches are visible for this profile yet.</CardDescription>
        )}
      </Card>
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold text-cyan-200">{value}</div>
    </div>
  );
}
