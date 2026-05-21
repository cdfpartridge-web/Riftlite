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
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/lfg">Find Match</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/download">Create in Desktop</Link>
            </Button>
          </div>
        </div>
      </section>

      {teams.length ? (
        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
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
                </div>
              </Card>
            </Link>
          ))}
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

async function loadTeams(): Promise<TeamCard[]> {
  const db = getFirestoreAdmin();
  if (!db) return [];
  const snap = await db.collection("publicTeams").orderBy("updatedAt", "desc").limit(60).get().catch(() => null);
  return snap?.docs.map((doc) => publicTeamFromDoc(doc.id, doc.data())) ?? [];
}
