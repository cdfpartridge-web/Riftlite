import Link from "next/link";

import { AdSlot } from "@/components/site/ad-slot";
import { DeckCard } from "@/components/site/deck-card";
import { FadeUp } from "@/components/site/fade-up";
import { NewsCard } from "@/components/site/news-card";
import { SectionHeading } from "@/components/site/section-heading";
import { StatCard } from "@/components/site/stat-card";
import { StreamPanel } from "@/components/site/stream-panel";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getCommunityOverview } from "@/lib/community/service";
import { getAdSlots, getHomeHero, getNewsPosts, getStreamModule } from "@/lib/sanity/content";
import { getStreamStatus } from "@/lib/twitch/status";
import { formatPercent } from "@/lib/utils";

export default async function HomePage() {
  const [hero, overview, newsPosts, adSlots, streamModule, streamStatus] =
    await Promise.all([
      getHomeHero(),
      getCommunityOverview(),
      getNewsPosts(),
      getAdSlots(),
      getStreamModule(),
      getStreamStatus(),
    ]);

  return (
    <div className="mx-auto max-w-7xl space-y-20 px-6 py-14">

      {/* Hero */}
      <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="animate-fade-up space-y-7">
          <div className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/8 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
            {hero.eyebrow}
          </div>
          <div className="space-y-4">
            <h1 className="font-display text-5xl font-bold tracking-tight text-white md:text-6xl lg:text-7xl">
              {hero.headline}
            </h1>
            <p className="max-w-xl text-lg leading-8 text-slate-400">
              {hero.subheading}
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <Button asChild size="lg">
              <Link href={hero.primaryCtaHref}>{hero.primaryCtaLabel}</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href={hero.secondaryCtaHref}>{hero.secondaryCtaLabel}</Link>
            </Button>
          </div>
        </div>

        <div className="animate-fade-up delay-150">
          <Card className="overflow-hidden bg-[linear-gradient(145deg,rgba(89,167,255,0.1),rgba(166,124,255,0.12))] shadow-[0_0_80px_rgba(89,167,255,0.08),0_8px_40px_rgba(4,8,23,0.5),inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="space-y-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.26em] text-slate-500">
                Live community snapshot
              </div>
              <CardTitle className="text-3xl">
                {overview.totalMatches} public matches tracked
              </CardTitle>
              <CardDescription className="text-base">
                {overview.totalPlayers} players · {overview.totalDecks} grouped decks ·{" "}
                {overview.trackedLegends} legends in the current window.
              </CardDescription>
              {overview.topDeck ? (
                <div className="rounded-2xl border border-white/8 bg-slate-950/30 p-5">
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">
                    Most-played deck
                  </div>
                  <div className="mt-2 font-display text-xl font-semibold text-white">
                    {overview.topDeck.title}
                  </div>
                  <div className="mt-1.5 text-sm text-slate-400">
                    {overview.topDeck.legend} · {overview.topDeck.games} games ·{" "}
                    <span className="text-emerald-300 font-medium">{formatPercent(overview.topDeck.winRate)} WR</span>
                  </div>
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </section>

      {/* Stat cards */}
      <FadeUp className="grid gap-4 md:grid-cols-4">
        <StatCard label="Matches" value={String(overview.totalMatches)} />
        <StatCard label="Players" value={String(overview.totalPlayers)} />
        <StatCard label="Top Legend" value={overview.topLegend?.legend ?? "—"} />
        <StatCard
          label="Top Legend WR"
          value={overview.topLegend ? formatPercent(overview.topLegend.winRate) : "—"}
          tone="win"
        />
      </FadeUp>

      <AdSlot placement="home-hero" slots={adSlots} />

      {/* Featured Decks */}
      <FadeUp className="space-y-8">
        <SectionHeading
          eyebrow="Featured Decks"
          title="See what the community is winning with."
          description="Browse the decks players are running right now, with real win rates pulled straight from live community matches."
        />
        <div className="grid gap-6 lg:grid-cols-3">
          {overview.featuredDecks.map((deck) => (
            <DeckCard deck={deck} key={deck.deckKey} />
          ))}
        </div>
      </FadeUp>

      {/* Stream */}
      <FadeUp className="space-y-8">
        <SectionHeading
          eyebrow="Live on Twitch"
          title="Watch BMU Casts while you browse the numbers."
          description="Catch the latest Riftbound streams without leaving the stats — perfect for studying matchups in real time."
        />
        <StreamPanel module={streamModule} status={streamStatus} />
      </FadeUp>

      <AdSlot placement="home-mid" slots={adSlots} />

      {/* Latest News */}
      <FadeUp className="space-y-8">
        <SectionHeading
          eyebrow="Latest News"
          title="Patch notes, meta shifts, and announcements."
          description="Stay on top of what's changing in Riftbound and what's new in RiftLite."
        />
        <div className="grid gap-6 lg:grid-cols-2">
          {newsPosts.slice(0, 2).map((post) => (
            <NewsCard key={post.slug} post={post} />
          ))}
        </div>
        <div className="text-center">
          <Button asChild variant="secondary">
            <Link href="/news">View all news</Link>
          </Button>
        </div>
      </FadeUp>
    </div>
  );
}
