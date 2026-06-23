import Link from "next/link";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { publicTeamFromDoc } from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Teams | RiftLite",
  description: "Discover public RiftLite teams, testing groups, and communities.",
};

type TeamCard = ReturnType<typeof publicTeamFromDoc>;

export default async function TeamsPage() {
  const teams = await loadTeams();

  return (
    <div className="mx-auto max-w-screen-2xl space-y-8 px-6 py-12">
      <section className="rounded-[32px] border border-cyan-300/15 bg-[linear-gradient(135deg,rgba(18,52,96,0.72),rgba(80,35,114,0.45))] p-8 shadow-[0_28px_90px_rgba(4,8,23,0.45)]">
        <Badge>Social Hub</Badge>
        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight text-white md:text-6xl">Teams</h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300">
              Public RiftLite team profiles for testing groups, tournament squads, local scenes, and coaching communities.
              Create teams in the app, manage applications, sync team match history, and keep private teams hidden from this directory.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="secondary">
              <Link href="/download">Create in Desktop</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <FeatureCard
          title="Public or private"
          body="Public teams get profile pages. Private teams stay inside RiftLite for closed testing groups."
        />
        <FeatureCard
          title="Applications and roles"
          body="Owners can review applicants, promote admins, remove members, and moderate team boards."
        />
        <FeatureCard
          title="Team match hub"
          body="Members can sync matches to teams from the desktop app for shared stats and matchup review."
        />
        <FeatureCard
          title="Member board"
          body="Team posts are low-read and member-only, built for announcements and testing notes rather than noisy chat."
        />
      </section>

      {teams.length ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-3xl font-bold text-white">Team directory</h2>
              <p className="mt-2 text-sm text-slate-400">
                Showing public teams only. Team owners can control visibility, recruitment, links, and images from RiftLite.
              </p>
            </div>
            <Badge>{teams.length} public teams</Badge>
          </div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <Link className="group block" href={`/teams/${team.slug}`} key={team.id}>
              <Card className="h-full overflow-hidden p-0 transition-transform duration-300 group-hover:-translate-y-1">
                <div className="relative h-40 bg-slate-950">
                  {team.bannerUrl ? (
                    <img alt="" className="h-full w-full object-cover opacity-75" src={team.bannerUrl} />
                  ) : (
                    <div className="h-full bg-[linear-gradient(135deg,rgba(89,167,255,0.28),rgba(166,124,255,0.22))]" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0b1022] via-transparent to-transparent" />
                  <div className="absolute bottom-4 left-4 flex items-end gap-3">
                    <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-cyan-300/30 bg-slate-950 shadow-[0_0_22px_rgba(89,167,255,0.24)]">
                      {team.logoUrl ? (
                        <img alt="" className="h-full w-full object-cover" src={team.logoUrl} />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xl font-bold text-cyan-200">{team.name.slice(0, 1)}</div>
                      )}
                    </div>
                    <div>
                      <h2 className="font-display text-2xl font-bold text-white">{team.name}</h2>
                      <p className="text-sm text-cyan-200">{team.region || "Online"} - {team.memberCount} members</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-4 p-5">
                  <p className="line-clamp-3 text-sm leading-6 text-slate-300">{team.description || "A RiftLite team looking for testing partners."}</p>
                  <div className="flex flex-wrap gap-2">
                    {(team.purposes.length ? team.purposes : ["Testing"]).slice(0, 4).map((purpose) => (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-200" key={purpose}>{purpose}</span>
                    ))}
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-300/8 px-3 py-1 text-xs font-semibold text-cyan-100">{team.recruitmentStatus || "open"}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 border-t border-white/8 pt-4 text-xs">
                    <MiniStat label="Members" value={String(team.memberCount)} />
                    <MiniStat label="Applicants" value={String(team.applicationCount)} />
                    <MiniStat label="Visibility" value={team.visibility} />
                  </div>
                  <div className="text-sm font-semibold text-cyan-200 transition group-hover:text-cyan-100">
                    View team hub
                  </div>
                </div>
              </Card>
            </Link>
          ))}
          </div>
        </section>
      ) : (
        <Card>
          <CardTitle>No teams yet</CardTitle>
          <CardDescription className="mt-2">Create the first public team from the RiftLite desktop Social Hub.</CardDescription>
        </Card>
      )}
    </div>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <Card className="p-5">
      <CardTitle className="text-base">{title}</CardTitle>
      <CardDescription className="mt-2 leading-6">{body}</CardDescription>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-950/30 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 truncate font-bold text-white" title={value}>{value}</div>
    </div>
  );
}

async function loadTeams(): Promise<TeamCard[]> {
  const db = getFirestoreAdmin();
  if (!db) return [];
  const snap = await db.collection("publicTeams").orderBy("updatedAt", "desc").limit(60).get().catch(() => null);
  return snap?.docs.map((doc) => publicTeamFromDoc(doc.id, doc.data())).filter((team) => team.visibility === "public") ?? [];
}
