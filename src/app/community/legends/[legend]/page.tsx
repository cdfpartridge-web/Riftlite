import Link from "next/link";
import { notFound } from "next/navigation";

import { LegendChip } from "@/components/site/legend-chip";
import { SectionHeading } from "@/components/site/section-heading";
import { TrendChart } from "@/components/site/trend-chart";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getLegendProfile } from "@/lib/community/service";
import { legendHref } from "@/lib/legend-links";
import { createPageMetadata } from "@/lib/seo";
import { formatDate, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

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
  params: Promise<{ legend: string }>;
}) {
  const { legend } = await params;
  const name = decodeURIComponent(legend);
  return createPageMetadata({
    title: `${name} Riftbound Stats`,
    description: `Community stats for ${name}: win rate, top decks, best and worst matchups, recent matches, and most-paired battlefields.`,
    path: `/community/legends/${encodeURIComponent(name)}`,
  });
}

export default async function LegendProfilePage({
  params,
}: {
  params: Promise<{ legend: string }>;
}) {
  const { legend: rawLegend } = await params;
  const legend = decodeURIComponent(rawLegend);

  // buildLegendProfile already validates legend ∈ LEGENDS and returns
  // null if not. Don't double-check here — if a runtime quirk made the
  // LEGENDS const inaccessible from this server-component context, the
  // pre-check would notFound() every legend (which is exactly what we
  // were seeing in production). Single source of truth.
  let profile;
  try {
    profile = await getLegendProfile(legend);
  } catch (error) {
    console.error("[legends/[legend]] getLegendProfile threw", { legend, error });
    notFound();
  }
  if (!profile) notFound();

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading
          eyebrow="Legend deep-dive"
          headingLevel={1}
          title={profile.legend}
          description={`${profile.games} community games tracked · ${formatPercent(profile.winRate)} win rate · ${formatPercent(profile.playRate)} of all matches.`}
        />
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button asChild size="sm" variant="secondary">
            <Link href="/community/meta">← Legend meta</Link>
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
          label="Play rate"
          value={formatPercent(profile.playRate)}
          tone="accent"
          sub={`of ${profile.totalMatches.toLocaleString()} community matches`}
        />
        <StatBlock
          label="Top deck archetypes"
          value={profile.topDecks.length.toString()}
          sub={profile.topDecks[0]?.title}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card className="p-5">
          <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
            Play rate, last 8 weeks
          </CardTitle>
          <div className="mt-4">
            <TrendChart
              accent="#A67CFF"
              buckets={profile.playRateTrend}
              label="Weekly play rate"
              valueKey="winRate"
            />
          </div>
        </Card>
        <Card className="p-5">
          <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
            Win rate, last 8 weeks
          </CardTitle>
          <div className="mt-4">
            <TrendChart
              accent="#49C187"
              buckets={profile.winRateTrend}
              label="Weekly win rate"
              valueKey="winRate"
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
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
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2 text-sm"
                  key={row.oppLegend}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">vs</span>
                    <LegendChip href={legendHref(row.oppLegend)} legend={row.oppLegend} size={26} />
                  </div>
                  <div className="flex items-center gap-3 text-xs">
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
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2 text-sm"
                  key={row.oppLegend}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">vs</span>
                    <LegendChip href={legendHref(row.oppLegend)} legend={row.oppLegend} size={26} />
                  </div>
                  <div className="flex items-center gap-3 text-xs">
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

      <Card className="p-5">
        <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
          Top decks running {profile.legend}
        </CardTitle>
        {profile.topDecks.length === 0 ? (
          <CardDescription className="mt-3">No decks with tracked snapshots yet.</CardDescription>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {profile.topDecks.map((deck) => (
              <Link
                className="flex flex-col gap-2 rounded-2xl border border-white/6 bg-white/[0.03] p-4 transition-colors hover:border-cyan-300/40 hover:bg-white/[0.05]"
                href={`/community/decks/${encodeURIComponent(deck.deckKey)}`}
                key={deck.deckKey}
              >
                <div className="truncate text-sm font-semibold text-white">{deck.title}</div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">{deck.games} games</span>
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
            Most-played battlefields
          </CardTitle>
          {profile.myBattlefields.length === 0 ? (
            <CardDescription className="mt-3">No battlefield data with enough games.</CardDescription>
          ) : (
            <ul className="mt-3 space-y-2">
              {profile.myBattlefields.map((row) => (
                <li
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2 text-sm"
                  key={row.battlefield}
                >
                  <span className="truncate text-slate-200">{row.battlefield}</span>
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
        <Card className="p-5">
          <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
            Most-faced opposing battlefields
          </CardTitle>
          {profile.oppBattlefields.length === 0 ? (
            <CardDescription className="mt-3">No opposing battlefield data yet.</CardDescription>
          ) : (
            <ul className="mt-3 space-y-2">
              {profile.oppBattlefields.map((row) => (
                <li
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2 text-sm"
                  key={row.battlefield}
                >
                  <span className="truncate text-slate-200">{row.battlefield}</span>
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
      </div>

      <Card className="p-5">
        <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
          Top players on {profile.legend}
        </CardTitle>
        {profile.topPlayers.length === 0 ? (
          <CardDescription className="mt-3">Need at least 3 games per player.</CardDescription>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {profile.topPlayers.map((row) => (
              <Link
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/6 bg-white/[0.03] p-3 text-sm transition-colors hover:border-cyan-300/40 hover:bg-white/[0.05]"
                href={`/community/players/${encodeURIComponent(row.player)}`}
                key={row.player}
              >
                <span className="truncate font-semibold text-white">{row.player}</span>
                <div className="flex flex-shrink-0 items-center gap-3 text-xs">
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
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
          Recent {profile.legend} matches
        </CardTitle>
        {profile.recentMatches.length === 0 ? (
          <CardDescription className="mt-3">No recent matches.</CardDescription>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] border-separate" style={{ borderSpacing: 0 }}>
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3">Player</th>
                  <th className="pb-2 pr-3">Opponent</th>
                  <th className="pb-2 pr-3">Result</th>
                  <th className="pb-2 pr-3">Deck</th>
                  <th className="pb-2">Score</th>
                </tr>
              </thead>
              <tbody>
                {profile.recentMatches.map((match) => (
                  <tr className="border-t border-white/5 text-sm hover:bg-white/[0.03]" key={match.id}>
                    <td className="py-2 pr-3 text-xs text-slate-400">{formatDate(match.date)}</td>
                    <td className="py-2 pr-3">
                      <Link
                        className="text-slate-200 hover:text-cyan-200"
                        href={`/community/players/${encodeURIComponent(match.username)}`}
                      >
                        {match.username || "—"}
                      </Link>
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
