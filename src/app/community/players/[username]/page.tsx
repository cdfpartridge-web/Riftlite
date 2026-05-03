import Link from "next/link";
import { notFound } from "next/navigation";

import { LegendChip } from "@/components/site/legend-chip";
import { SectionHeading } from "@/components/site/section-heading";
import { TrendChart } from "@/components/site/trend-chart";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getPlayerProfile } from "@/lib/community/service";
import { legendHref } from "@/lib/legend-links";
import { createPageMetadata } from "@/lib/seo";
import { formatDate, formatPercent } from "@/lib/utils";

export const revalidate = 600;

function StreakBadge({ streak }: { streak: { type: string; length: number } }) {
  if (!streak.type || streak.length === 0) return null;
  const tone =
    streak.type === "W"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
      : streak.type === "L"
        ? "bg-rose-500/15 text-rose-300 ring-rose-500/30"
        : "bg-amber-400/10 text-amber-200 ring-amber-400/30";
  const label =
    streak.type === "W" ? "win streak" : streak.type === "L" ? "loss streak" : "draw streak";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ring-1 ${tone}`}
    >
      {streak.length}
      <span className="font-normal tracking-normal opacity-80">{label}</span>
    </span>
  );
}

function StatBlock({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "win" | "loss" | "accent";
}) {
  const valueColor =
    tone === "win"
      ? "text-emerald-300"
      : tone === "loss"
        ? "text-rose-300"
        : tone === "accent"
          ? "text-cyan-300"
          : "text-slate-100";
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl font-bold tracking-tight ${valueColor}`}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div> : null}
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const name = decodeURIComponent(username);
  return createPageMetadata({
    title: `${name} Player Profile`,
    description: `Riftbound community profile for ${name}: win rate, favourite legends, matchup breakdown, and deck history.`,
    path: `/community/players/${encodeURIComponent(name)}`,
    noIndex: true,
  });
}

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getPlayerProfile(decodeURIComponent(username));
  if (!profile) notFound();

  const recentWindow = profile.recentMatches;
  const isoDate = (ms: number) =>
    ms > 0 ? formatDate(new Date(ms).toISOString()) : "—";

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading
          eyebrow="Player Profile"
          headingLevel={1}
          title={profile.player}
          description={`Tracking ${profile.games} community matches — ${isoDate(profile.firstSeenMs)} to ${isoDate(profile.lastSeenMs)}.`}
        />
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <StreakBadge streak={profile.currentStreak} />
          <Button asChild size="sm" variant="secondary">
            <Link href="/community/matches">← Recent Matches</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock
          label="Games"
          value={profile.games.toString()}
          sub={`${profile.wins}W · ${profile.losses}L · ${profile.draws}D`}
        />
        <StatBlock
          label="Win rate"
          value={formatPercent(profile.winRate)}
          tone={profile.winRate >= 55 ? "win" : profile.winRate < 45 ? "loss" : "accent"}
          sub={`${profile.wins} wins / ${profile.wins + profile.losses} decisive`}
        />
        <StatBlock
          label="Wilson score"
          value={formatPercent(profile.confidenceScore * 100)}
          tone="accent"
          sub="Confidence-adjusted rank"
        />
        <StatBlock
          label="Decks played"
          value={profile.decks.length.toString()}
          sub={profile.favouriteLegends.length ? `${profile.favouriteLegends.length} legends` : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card className="p-5">
          <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
            Win rate, last 8 weeks
          </CardTitle>
          <div className="mt-4">
            <TrendChart
              accent="#49C187"
              buckets={profile.trend}
              label="Weekly win rate"
              valueKey="winRate"
            />
          </div>
        </Card>
        <Card className="p-5">
          <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
            Games per week
          </CardTitle>
          <div className="mt-4">
            <TrendChart
              accent="#59A7FF"
              buckets={profile.trend}
              label="Weekly volume"
              unit=""
              valueKey="games"
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(320px,400px)_1fr]">
        <Card className="p-5">
          <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
            Favourite legends
          </CardTitle>
          {profile.favouriteLegends.length === 0 ? (
            <CardDescription className="mt-3">No legend data yet.</CardDescription>
          ) : (
            <ul className="mt-3 space-y-2">
              {profile.favouriteLegends.map((row) => (
                <li
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2"
                  key={row.legend}
                >
                  <LegendChip href={legendHref(row.legend)} legend={row.legend} size={30} />
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-slate-400">{row.games}g</span>
                    <span
                      className={`font-semibold tabular-nums ${
                        row.winRate >= 55
                          ? "text-emerald-300"
                          : row.winRate < 45
                            ? "text-rose-300"
                            : "text-slate-200"
                      }`}
                    >
                      {formatPercent(row.winRate)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-5">
            <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
              Best matchups
            </CardTitle>
            {profile.bestMatchups.length === 0 ? (
              <CardDescription className="mt-3">Need at least 3 games per matchup.</CardDescription>
            ) : (
              <ul className="mt-3 space-y-2">
                {profile.bestMatchups.map((row) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2 text-xs"
                    key={`${row.myLegend}__${row.oppLegend}`}
                  >
                    <div className="flex items-center gap-2">
                      <LegendChip href={legendHref(row.myLegend)} legend={row.myLegend} size={22} />
                      <span className="text-slate-500">vs</span>
                      <LegendChip href={legendHref(row.oppLegend)} legend={row.oppLegend} size={22} />
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400">{row.games}g</span>
                      <span className="font-semibold text-emerald-300 tabular-nums">
                        {formatPercent(row.winRate)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-5">
            <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
              Worst matchups
            </CardTitle>
            {profile.worstMatchups.length === 0 ? (
              <CardDescription className="mt-3">Need at least 3 games per matchup.</CardDescription>
            ) : (
              <ul className="mt-3 space-y-2">
                {profile.worstMatchups.map((row) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2 text-xs"
                    key={`${row.myLegend}__${row.oppLegend}`}
                  >
                    <div className="flex items-center gap-2">
                      <LegendChip href={legendHref(row.myLegend)} legend={row.myLegend} size={22} />
                      <span className="text-slate-500">vs</span>
                      <LegendChip href={legendHref(row.oppLegend)} legend={row.oppLegend} size={22} />
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400">{row.games}g</span>
                      <span className="font-semibold text-rose-300 tabular-nums">
                        {formatPercent(row.winRate)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
            Decks played
          </CardTitle>
        </div>
        {profile.decks.length === 0 ? (
          <CardDescription className="mt-3">No tracked decks for this player yet.</CardDescription>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {profile.decks.map((deck) => (
              <Link
                className="flex items-center justify-between gap-4 rounded-2xl border border-white/6 bg-white/[0.03] p-4 transition-colors hover:border-cyan-300/40 hover:bg-white/[0.05]"
                href={`/community/decks/${encodeURIComponent(deck.deckKey)}`}
                key={deck.deckKey}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">{deck.title}</div>
                  <div className="text-[11px] text-slate-500">{deck.legend}</div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3 text-xs">
                  <span className="text-slate-400">{deck.games}g</span>
                  <span
                    className={`font-semibold tabular-nums ${
                      deck.winRate >= 55
                        ? "text-emerald-300"
                        : deck.winRate < 45
                          ? "text-rose-300"
                          : "text-slate-200"
                    }`}
                  >
                    {formatPercent(deck.winRate)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
          Recent matches ({recentWindow.length})
        </CardTitle>
        {recentWindow.length === 0 ? (
          <CardDescription className="mt-3">No recent matches.</CardDescription>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] border-separate" style={{ borderSpacing: 0 }}>
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3">Legend</th>
                  <th className="pb-2 pr-3">Opponent</th>
                  <th className="pb-2 pr-3">Result</th>
                  <th className="pb-2 pr-3">Deck</th>
                  <th className="pb-2">Score</th>
                </tr>
              </thead>
              <tbody>
                {recentWindow.map((match) => (
                  <tr
                    className="border-t border-white/5 text-sm hover:bg-white/[0.03]"
                    key={match.id}
                  >
                    <td className="py-2 pr-3 text-xs text-slate-400">{formatDate(match.date)}</td>
                    <td className="py-2 pr-3">
                      <LegendChip
                        href={legendHref(match.myChampion)}
                        legend={match.myChampion}
                        size={22}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <LegendChip
                        href={legendHref(match.oppChampion)}
                        legend={match.oppChampion}
                        size={22}
                      />
                    </td>
                    <td
                      className={`py-2 pr-3 font-semibold ${
                        match.result === "Win"
                          ? "text-emerald-400"
                          : match.result === "Loss"
                            ? "text-rose-400"
                            : "text-amber-300"
                      }`}
                    >
                      {match.result || "—"}
                    </td>
                    <td className="py-2 pr-3 text-slate-300">{match.deckName || "—"}</td>
                    <td className="py-2 text-xs text-slate-400">{match.score || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
