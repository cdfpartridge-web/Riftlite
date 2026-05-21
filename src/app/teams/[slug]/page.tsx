import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { TeamActionsClient } from "@/components/site/team-actions-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { fullTeamFromDoc, memberFromDoc } from "@/lib/social-hub";

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
  const { team, members } = payload;
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
    </div>
  );
}

async function loadTeam(slug: string): Promise<{ team: Team; members: Member[] } | null> {
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
  return {
    team,
    members: memberSnap?.docs.map((doc) => memberFromDoc(doc.id, doc.data())) ?? [],
  };
}
