import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { CollectionReference } from "firebase-admin/firestore";

import { ProfileMatchExplorer } from "@/components/site/profile-match-explorer";
import { TeamActionsClient } from "@/components/site/team-actions-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { normalizeMatch } from "@/lib/community/data";
import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { fullTeamFromDoc, memberFromDoc } from "@/lib/social-hub";
import type { CommunityMatch } from "@/lib/types";
import { formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Team = ReturnType<typeof fullTeamFromDoc>;
type Member = ReturnType<typeof memberFromDoc>;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const payload = await loadTeam(slug);
  if (!payload) return { title: "Team not found | RiftLite" };
  return {
    title: `${payload.team.name} | RiftLite Teams`,
    description: payload.team.description || "A public RiftLite team profile.",
  };
}

export default async function TeamProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const payload = await loadTeam(slug);
  if (!payload) notFound();
  const { team, members, matches } = payload;
  const stats = teamMatchStats(matches);
  const topLegend = topValue(matches, (match) => match.myChampion);
  const topDeck = topValue(matches, (match) => match.deckName || match.deckSnapshot?.title || "");
  const socials = team.socials as Record<string, unknown>;
  const links = ([
    ["Discord", team.discord],
    ["Website", team.website],
    ["X", socials.x],
    ["YouTube", socials.youtube],
    ["Twitch", socials.twitch],
    ["Instagram", socials.instagram],
    ["Metafy", socials.metafy],
  ] as Array<[string, unknown]>).flatMap(([label, href]) => (typeof href === "string" && href ? [[label, href] as [string, string]] : []));

  return (
    <div className="mx-auto max-w-screen-2xl space-y-8 px-6 py-12">
      <section className="overflow-hidden rounded-[34px] border border-cyan-300/15 bg-[#0b1022] shadow-[0_28px_90px_rgba(4,8,23,0.48)]">
        <div className="relative min-h-[320px]">
          {team.bannerUrl ? (
            <img alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" src={team.bannerUrl} />
          ) : (
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(89,167,255,0.28),rgba(166,124,255,0.2))]" />
          )}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(132,231,255,0.22),transparent_34%),linear-gradient(90deg,#081023_0%,rgba(8,16,35,0.88)_45%,rgba(8,16,35,0.64)_100%)]" />
          <div className="relative grid min-h-[320px] gap-8 p-8 lg:grid-cols-[auto_1fr_auto] lg:items-end">
            <div className="h-28 w-28 overflow-hidden rounded-[28px] border border-cyan-300/30 bg-slate-950 shadow-[0_0_40px_rgba(89,167,255,0.28)]">
              {team.logoUrl ? (
                <img alt="" className="h-full w-full object-cover" src={team.logoUrl} />
              ) : (
                <div className="flex h-full items-center justify-center text-4xl font-bold text-cyan-200">{team.name.slice(0, 1)}</div>
              )}
            </div>
            <div>
              <Badge>RiftLite team</Badge>
              <h1 className="mt-4 font-display text-5xl font-bold tracking-tight text-white md:text-7xl">{team.name}</h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-200">{team.description || "A public RiftLite team profile."}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-sm font-semibold text-white">{team.region || "Online"}</span>
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/8 px-3 py-1 text-sm font-semibold text-cyan-100">{team.recruitmentStatus || "open"}</span>
                {team.purposes.map((purpose) => <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-sm font-semibold text-white" key={purpose}>{purpose}</span>)}
              </div>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <Button asChild>
                <Link href="/teams">All teams</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
        <div className="space-y-6">
          <Card>
            <CardTitle>Team hub</CardTitle>
            <CardDescription className="mt-2">
              Public team profile, member tools, and team-synced match data from RiftLite Desktop.
            </CardDescription>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <TeamStat label="Synced matches" value={String(matches.length)} sub="Public team window" />
              <TeamStat label="Win rate" value={formatPercent(stats.winRate)} sub={`${stats.wins}-${stats.losses}${stats.draws ? `, ${stats.draws} draws` : ""}`} />
              <TeamStat label="Top legend" value={topLegend?.[0] ?? "None yet"} sub={topLegend ? `${topLegend[1]} games` : "Sync matches from the app"} />
              <TeamStat label="Top deck" value={topDeck?.[0] ?? "No decks yet"} sub={topDeck ? `${topDeck[1]} games` : "Deck snapshots appear here"} />
            </div>
          </Card>

          <Card>
            <CardTitle>Members</CardTitle>
            <CardDescription className="mt-2">{members.length} public members shown.</CardDescription>
            <div className="mt-5 grid gap-3">
              {members.map((member) => (
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3" key={member.uid}>
                  <span className="font-semibold text-white">{member.displayName}</span>
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">{member.role}</span>
                </div>
              ))}
            </div>
          </Card>

          {links.length ? (
            <Card>
              <CardTitle>Links</CardTitle>
              <div className="mt-5 grid gap-2">
                {links.map(([label, href]) => (
                  <Button asChild key={label} variant="secondary">
                    <a href={href} rel="noopener noreferrer" target="_blank">{label}</a>
                  </Button>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
        <TeamActionsClient recruitmentStatus={team.recruitmentStatus} slug={team.slug} teamId={team.id} />
      </div>

      <ProfileMatchExplorer
        matches={matches}
        handle={team.slug}
        displayName={team.name}
        showStats
        showDecks
        explorerTitle="Team match explorer"
        explorerDescription="Filter this team's synced match window, then click a row to inspect games, battlefields, player names, and deck snapshots."
        emptyDescription="This public team has not synced public team matches yet. Members can send matches to teams from the RiftLite desktop Social Hub."
        recentTitle="Recent team matches"
        sourceLabel="Team hub"
        matchContextLabel="team-synced match"
      />
    </div>
  );
}

function TeamStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-1 truncate font-display text-2xl font-bold text-cyan-200" title={value}>
        {value}
      </div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

function teamMatchStats(matches: CommunityMatch[]) {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const match of matches) {
    if (match.result === "Win") wins += 1;
    else if (match.result === "Loss") losses += 1;
    else if (match.result === "Draw") draws += 1;
  }
  const decisive = wins + losses;
  return {
    wins,
    losses,
    draws,
    winRate: decisive ? Number(((wins / decisive) * 100).toFixed(1)) : 0,
  };
}

function topValue(matches: CommunityMatch[], pick: (match: CommunityMatch) => string) {
  const counts = new Map<string, number>();
  for (const match of matches) {
    const value = pick(match).trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
}

async function loadTeam(slug: string): Promise<{ team: Team; members: Member[]; matches: CommunityMatch[] } | null> {
  const db = getFirestoreAdmin();
  if (!db) return null;
  const clean = slug.trim().toLowerCase();
  const slugSnap = await db.collection("teamSlugs").doc(clean).get().catch(() => null);
  const teamId = String(slugSnap?.data()?.teamId ?? "");
  if (!teamId) return null;
  const teamSnap = await db.collection("teams").doc(teamId).get().catch(() => null);
  if (!teamSnap?.exists) return null;
  const team = fullTeamFromDoc(teamSnap.id, teamSnap.data() ?? {});
  if (team.visibility === "private" || team.hidden) return null;
  const memberSnap = await teamSnap.ref.collection("members").orderBy("joinedAt", "asc").limit(80).get().catch(() => null);
  const matches = await loadTeamMatches(teamSnap.ref.collection("matches"));
  return {
    team,
    members: memberSnap?.docs.map((doc) => memberFromDoc(doc.id, doc.data())) ?? [],
    matches,
  };
}

async function loadTeamMatches(collection: CollectionReference): Promise<CommunityMatch[]> {
  const ordered =
    (await collection.orderBy("created_at", "desc").limit(500).get().catch(() => null)) ??
    (await collection.orderBy("createdAt", "desc").limit(500).get().catch(() => null)) ??
    (await collection.limit(500).get().catch(() => null));

  return ordered?.docs
    .map((doc) =>
      normalizeMatch(doc.id, {
        id: doc.id,
        ...doc.data(),
      }),
    )
    .filter((match) => !match.superseded) ?? [];
}
