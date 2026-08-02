import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, ExternalLink, History, Layers3, PlayCircle } from "lucide-react";
import type { ReactNode } from "react";

import { ProfileMatchExplorer } from "@/components/site/profile-match-explorer";
import { SectionHeading } from "@/components/site/section-heading";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getPublicProfileByHandle } from "@/lib/social/server";
import type { CommunityMatch } from "@/lib/types";
import { formatDate, formatPercent } from "@/lib/utils";

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

function profileDeckCount(matches: CommunityMatch[]) {
  return new Set(matches.map((match) => (
    match.deckSourceKey || match.deckSnapshot?.sourceKey ||
    (match.deckName ? `${match.myChampion}:${match.deckName}` : "")
  )).filter(Boolean)).size;
}

function replayResultTone(result: string) {
  if (result === "win") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (result === "loss") return "border-rose-400/30 bg-rose-400/10 text-rose-200";
  if (result === "draw") return "border-amber-400/30 bg-amber-400/10 text-amber-100";
  return "border-white/10 bg-white/[0.04] text-slate-300";
}

function ProfileStat({ label, value, detail, icon }: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
      <div className="flex items-center justify-between gap-3 text-cyan-200">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</span>
        {icon}
      </div>
      <div className="mt-2 font-display text-2xl font-bold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

export default async function UserProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const result = await getPublicProfileByHandle(decodeURIComponent(handle));
  if (!result) notFound();

  const { profile, aggregate, publicReplays } = result;
  const matches = profile.showMatches
    ? sanitizeMatches(aggregate.recentMatches, profile.showDecks)
    : [];
  const deckCount = profile.showDecks ? profileDeckCount(matches) : 0;
  const updatedLabel = aggregate.updatedAt ? formatDate(new Date(aggregate.updatedAt).toISOString()) : "Unknown";

  return (
    <div className="mx-auto max-w-[1500px] space-y-8 py-8">
      <div className="overflow-hidden rounded-[2rem] border border-cyan-300/15 bg-gradient-to-br from-cyan-300/[0.08] via-blue-500/[0.035] to-transparent p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <SectionHeading
            eyebrow="Public RiftLite profile"
            headingLevel={1}
            title={profile.displayName || profile.handle}
            description={`@${profile.handle} · Opted-in match history, decks, performance, and Public Web Replays.`}
          />
          <div className="rounded-2xl border border-white/8 bg-slate-950/35 px-4 py-3 text-sm text-slate-400">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Last updated</div>
            <div className="mt-1 text-slate-200">{updatedLabel}</div>
          </div>
        </div>

        <nav aria-label="Profile sections" className="mt-6 flex flex-wrap gap-2">
          {profile.showMatches ? <a className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-300 hover:border-cyan-300/35 hover:text-white" href="#match-history">Match history</a> : null}
          {profile.showMatches && profile.showDecks ? <a className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-300 hover:border-cyan-300/35 hover:text-white" href="#decks">Decks</a> : null}
          <a className="rounded-full border border-cyan-300/25 bg-cyan-300/[0.08] px-4 py-2 text-sm font-semibold text-cyan-100 hover:border-cyan-300/50" href="#web-replays">Web Replays ({publicReplays.length})</a>
        </nav>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ProfileStat
            label="Public matches"
            value={profile.showMatches ? String(aggregate.totalMatches) : "Hidden"}
            detail={profile.showMatches ? `${matches.length} recent matches available here` : "Disabled by this player"}
            icon={<History size={18} />}
          />
          <ProfileStat
            label="Win rate"
            value={profile.showStats ? formatPercent(aggregate.winRate) : "Hidden"}
            detail={profile.showStats ? `${aggregate.wins}W · ${aggregate.losses}L · ${aggregate.draws}D` : "Stats are private"}
            icon={<BarChart3 size={18} />}
          />
          <ProfileStat
            label="Decks"
            value={profile.showMatches && profile.showDecks ? String(deckCount) : "Hidden"}
            detail={profile.showMatches && profile.showDecks ? "Distinct public decks in recent history" : "Deck details are private"}
            icon={<Layers3 size={18} />}
          />
          <ProfileStat
            label="Web Replays"
            value={String(publicReplays.length)}
            detail="Public, ready-to-watch replays"
            icon={<PlayCircle size={18} />}
          />
        </div>
      </div>

      <section className="scroll-mt-28 space-y-4" id="web-replays">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300">Watch their games</p>
            <h2 className="mt-1 font-display text-2xl font-bold text-white">Public Web Replays</h2>
            <p className="mt-1 text-sm text-slate-500">Only replays deliberately set to Public and fully processed are listed here.</p>
          </div>
          <Link className="text-sm font-semibold text-cyan-200 hover:text-white" href="/replays">Browse all public replays</Link>
        </div>
        {publicReplays.length ? (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {publicReplays.map((replay) => {
              const matchup = replay.playerLegend && replay.opponentLegend
                ? `${replay.playerLegend} vs ${replay.opponentLegend}`
                : replay.playerName && replay.opponentName
                  ? `${replay.playerName} vs ${replay.opponentName}`
                  : replay.title;
              const replayDate = replay.capturedAt || replay.createdAt;
              return (
                <Card className="group flex h-full flex-col p-5 transition hover:-translate-y-0.5 hover:border-cyan-300/35" key={replay.replayId}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-200"><PlayCircle size={20} /></span>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${replayResultTone(replay.result)}`}>
                      {replay.result === "unknown" ? replay.platform : replay.result}
                    </span>
                  </div>
                  <CardTitle className="mt-4 text-lg">{matchup}</CardTitle>
                  <CardDescription className="mt-2">
                    {replay.format.toUpperCase()} · {replay.platform === "tcga" ? "TCGA" : "Rift Atlas"} · {replayDate ? formatDate(replayDate) : "Date unavailable"}
                  </CardDescription>
                  <Link className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-cyan-200 hover:text-white" href={`/replays/${encodeURIComponent(replay.replayId)}`}>
                    Watch replay <ExternalLink size={15} />
                  </Link>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardTitle>No Public Web Replays yet</CardTitle>
            <CardDescription className="mt-2">Private and Unlisted replays are never exposed on a public profile.</CardDescription>
          </Card>
        )}
      </section>

      {!profile.showMatches ? (
        <section className="scroll-mt-28" id="match-history">
          <Card>
            <CardTitle>Match history hidden</CardTitle>
            <CardDescription className="mt-2">
              This player has made their profile public but kept their public match history and decks private.
            </CardDescription>
          </Card>
        </section>
      ) : (
        <section className="scroll-mt-28" id="match-history">
          <ProfileMatchExplorer
            displayName={profile.displayName}
            handle={profile.handle}
            matches={matches}
            showDecks={profile.showDecks}
            showStats={profile.showStats}
          />
        </section>
      )}
    </div>
  );
}
