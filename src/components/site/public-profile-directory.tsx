"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowUpRight, Search, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { DiscoverablePublicProfile } from "@/lib/social/server";

export function PublicProfileDirectory({
  initialProfiles,
}: {
  initialProfiles: DiscoverablePublicProfile[];
}) {
  const [query, setQuery] = useState("");
  const [profiles, setProfiles] = useState(initialProfiles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  async function searchProfiles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/user/search?q=${encodeURIComponent(query.trim())}`, {
        cache: "no-store",
      });
      const payload = await response.json() as {
        profiles?: DiscoverablePublicProfile[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Player profiles could not be searched.");
      setProfiles(Array.isArray(payload.profiles) ? payload.profiles : []);
      setSearched(Boolean(query.trim()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Player profiles could not be searched.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-cyan-300/20 bg-gradient-to-br from-cyan-300/[0.07] to-blue-500/[0.03] p-6">
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={searchProfiles}>
          <label className="min-w-0 flex-1 space-y-2 text-sm font-semibold text-slate-300">
            <span>Find a public player</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                className="social-input w-full pl-11"
                placeholder="Search by display name or @handle"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </label>
          <Button className="sm:self-end" disabled={busy} type="submit">
            {busy ? "Searching..." : "Search profiles"}
          </Button>
        </form>
        <CardDescription className="mt-3">
          Only players who have enabled both a public and searchable profile appear here.
        </CardDescription>
        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      </Card>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold text-white">
            {searched ? "Search results" : "Public player profiles"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Open a profile for opted-in stats, match history, deck snapshots, and Public Web Replays.
          </p>
        </div>
        <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-slate-400">
          {profiles.length} shown
        </span>
      </div>

      {profiles.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {profiles.map((profile) => (
            <Link
              className="group rounded-3xl border border-white/8 bg-white/[0.025] p-5 transition hover:-translate-y-0.5 hover:border-cyan-300/35 hover:bg-cyan-300/[0.05]"
              href={`/user/${encodeURIComponent(profile.handle)}`}
              key={profile.uid}
            >
              <div className="flex items-start justify-between gap-4">
                <span className="grid h-12 w-12 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-200">
                  <UserRound size={23} />
                </span>
                <ArrowUpRight className="text-slate-600 transition group-hover:text-cyan-200" size={19} />
              </div>
              <CardTitle className="mt-5 text-lg">{profile.displayName || profile.handle}</CardTitle>
              <CardDescription className="mt-1">@{profile.handle}</CardDescription>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/75">
                View public profile
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="p-6">
          <CardTitle>No discoverable profiles found</CardTitle>
          <CardDescription className="mt-2">
            Try a shorter name or handle. A direct profile link still works when its owner has made the profile Public but not Searchable.
          </CardDescription>
        </Card>
      )}
    </div>
  );
}
