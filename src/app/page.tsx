import Image from "next/image";
import Link from "next/link";

import { AdSlot } from "@/components/site/ad-slot";
import { DiscordCta } from "@/components/site/discord-cta";
import { FadeUp } from "@/components/site/fade-up";
import { NewsCard } from "@/components/site/news-card";
import { SectionHeading } from "@/components/site/section-heading";
import { StatCard } from "@/components/site/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { SITE_PATHS } from "@/lib/constants";
import { getCommunityOverview } from "@/lib/community/service";
import {
  getAdSlots,
  getNewsPosts,
  getSiteSettings,
} from "@/lib/sanity/content";
import { createPageMetadata } from "@/lib/seo";
import { formatPercent, safeHref } from "@/lib/utils";

export const revalidate = 300;

export const metadata = createPageMetadata({
  title: "RiftLite - Automatic Riftbound Match Tracking",
  description:
    "Track Riftbound matches on TCGA and RiftAtlas automatically, review visual replays, study matchup stats, and browse the community meta with RiftLite.",
  path: "/",
  image: "/screenshots/replay-viewer.webp",
});

export default async function HomePage() {
  const [overview, newsPosts, adSlots, settings] = await Promise.all([
    getCommunityOverview(),
    getNewsPosts(),
    getAdSlots(),
    getSiteSettings(),
  ]);

  const downloadHref = safeHref(settings.downloadUrl);

  return (
    <div className="mx-auto max-w-7xl space-y-24 px-6 py-14">
      {/* Hero — download-first */}
      <section aria-labelledby="hero-title" className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="animate-fade-up space-y-7">
          <div className="inline-flex rounded-full border border-emerald-300/25 bg-emerald-300/8 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
            New · Fully automatic tracking
          </div>
          <div className="space-y-4">
            <h1 className="font-display text-5xl font-bold tracking-tight text-white md:text-6xl lg:text-7xl" id="hero-title">
              Know your matchups. Improve every game.
            </h1>
            <p className="max-w-xl text-lg leading-8 text-slate-400">
              RiftLite now tracks every Riftbound match you play on TCGA and RiftAtlas
              — fully automatic, no buttons to press. Review games with the new replay
              feature, study your real win rates by matchup, follow the community meta,
              and keep a live OBS overlay updated while you focus on the game.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <Button asChild size="lg">
              <Link href={downloadHref}>Download RiftLite — free</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href={SITE_PATHS.guide}>Guide</Link>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Windows · installs in under a minute
            </span>
            <span>No account required</span>
            <span>{overview.totalMatches.toLocaleString()} community matches tracked</span>
          </div>
        </div>

        {/* Hero visual — the replay viewer, front and centre */}
        <div className="animate-fade-up delay-150">
          <Card className="overflow-hidden bg-[linear-gradient(145deg,rgba(89,167,255,0.1),rgba(166,124,255,0.12))] shadow-[0_0_80px_rgba(89,167,255,0.08),0_8px_40px_rgba(4,8,23,0.5),inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase tracking-[0.26em] text-cyan-200">
                  New · Visual Replays
                </div>
                <div className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-200">
                  Frame by frame
                </div>
              </div>
              <CardTitle className="text-2xl">Replay every turn after the match.</CardTitle>
              <CardDescription className="text-base">
                Step through saved frames, flag key moments, trim the timeline, and turn a finished
                game into something you can actually study.
              </CardDescription>
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                <Image
                  alt="RiftLite visual replay viewer showing a saved match timeline"
                  className="h-auto w-full rounded-lg"
                  height={1032}
                  priority
                  src="/screenshots/replay-viewer.webp"
                  width={1917}
                />
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Stat cards — social proof */}
      <FadeUp className="grid gap-4 md:grid-cols-4">
        <StatCard label="Matches tracked" value={String(overview.totalMatches)} />
        <StatCard label="Players" value={String(overview.totalPlayers)} />
        <StatCard label="Top Legend" value={overview.topLegend?.legend ?? "—"} />
        <StatCard
          label="Top Legend WR"
          value={overview.topLegend ? formatPercent(overview.topLegend.winRate) : "—"}
          tone="win"
        />
      </FadeUp>

      {/* Feature: Visual replays */}
      <FadeUp className="space-y-10">
        <SectionHeading
          id="feature-replays"
          eyebrow="★ Visual replays"
          title="Go back through the game, frame by frame."
          description="RiftLite keeps timed visual replay frames for tracked matches, so you can review turning points, flag the moments that matter, and save a trimmed sequence for later study."
        />
        <div className="overflow-hidden rounded-3xl border border-cyan-300/15 bg-slate-950/60 p-3 shadow-[0_0_90px_rgba(89,167,255,0.1)]">
          <Image
            alt="RiftLite replay viewer with timeline controls, saved frames, and a visual match replay"
            className="h-auto w-full rounded-2xl"
            height={1032}
            src="/screenshots/replay-viewer.webp"
            width={1917}
          />
        </div>
        <ul className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Timeline playback",
              body: "Scrub through preserved frames, jump between turns, and replay the match at the speed that helps you learn.",
            },
            {
              title: "Flag key decisions",
              body: "Mark the turn, attack, response, or point swing you want to revisit without digging through the whole game.",
            },
            {
              title: "Trim what matters",
              body: "Keep the important frames and cut the rest, so reviews stay focused on the exact sequence you care about.",
            },
          ].map((item) => (
            <li className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5" key={item.title}>
              <div className="font-display text-base font-semibold text-white">{item.title}</div>
              <p className="mt-1.5 text-sm leading-6 text-slate-400">{item.body}</p>
            </li>
          ))}
        </ul>
      </FadeUp>

      {/* Feature: Fully automatic tracking */}
      <FadeUp className="space-y-10">
        <SectionHeading
          id="feature-auto"
          eyebrow="★ Fully automatic"
          title="Every game logs itself — on TCGA and RiftAtlas."
          description="Open RiftLite, play Riftbound where you already play it. RiftLite watches the match, captures your legend, your opponent's legend, the deck, and the result, and writes it to your history the second the game ends. No screenshots, no copy-paste, no end-of-session cleanup."
        />
        <ul className="grid gap-4 md:grid-cols-3">
          {[
            {
              eyebrow: "TCGA",
              title: "Browser-based play, captured live",
              body: "Plays through tcg-arena.fr? RiftLite reads the match feed in real time and turns each game into a logged match — including deck, points, and result.",
            },
            {
              eyebrow: "RiftAtlas",
              title: "Native client, fully tracked",
              body: "Same story for RiftAtlas matches: every game lands in your history with the right legends, the right deck, and the right outcome.",
            },
            {
              eyebrow: "Zero friction",
              title: "Nothing to press, nothing to forget",
              body: "No \"start tracking\" button, no manual result entry. Just play. RiftLite handles the rest, including syncing to community stats if you opt in.",
            },
          ].map((item) => (
            <li className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5" key={item.title}>
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300">
                {item.eyebrow}
              </div>
              <div className="mt-2 font-display text-base font-semibold text-white">{item.title}</div>
              <p className="mt-1.5 text-sm leading-6 text-slate-400">{item.body}</p>
            </li>
          ))}
        </ul>
      </FadeUp>

      {/* Community — the whole meta, right up top */}
      <FadeUp className="space-y-10">
        <SectionHeading
          id="feature-community"
          eyebrow="Community data"
          title="The whole meta, inside the app."
          description="Every game you log (anonymously, if you want) feeds the legend meta and community matchup matrix — and they feed you right back inside RiftLite. No tab-hopping, no scraping Discord."
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-slate-950/60 p-3">
            <Image
              alt="RiftLite community stats tab"
              className="h-auto w-full rounded-xl"
              height={819}
              src="/screenshots/community.webp"
              width={1456}
            />
          </div>
          <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-slate-950/60 p-3">
            <Image
              alt="Community match matrix — every legend vs every legend"
              className="h-auto w-full rounded-xl"
              height={1009}
              src="/screenshots/match-matrix.webp"
              width={1920}
            />
          </div>
        </div>
      </FadeUp>

      {/* Feature 1: Streamer Overlay details */}
      <FadeUp className="space-y-10">
        <SectionHeading
          id="feature-overlay"
          eyebrow="★ New in 0.47"
          title="A streamer overlay built for Riftbound."
          description="Drop one URL into OBS as a Browser Source and your viewers see the same matchup intel you do — personal win rates, community averages, going-first splits, and the most-played battlefield for game one. No cloud round-trip, no extra setup; it reads from your already-synced history."
        />
        <ul className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Zero-lag, local-first",
              body: "Served from 127.0.0.1 — instant updates when you change legend, no Firebase reads while you're live.",
            },
            {
              title: "Portrait or landscape",
              body: "Two layouts built in. Pick whichever fits your scene and grab the URL from the app.",
            },
            {
              title: "Personal + community side-by-side",
              body: "Your own matchup history next to community averages, so your chat sees the real picture.",
            },
          ].map((item) => (
            <li className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5" key={item.title}>
              <div className="font-display text-base font-semibold text-white">{item.title}</div>
              <p className="mt-1.5 text-sm leading-6 text-slate-400">{item.body}</p>
            </li>
          ))}
        </ul>
      </FadeUp>

      <AdSlot placement="home-hero" slots={adSlots} />

      {/* Feature 3: Stats matrix */}
      <FadeUp className="space-y-10">
        <SectionHeading
          id="feature-stats"
          eyebrow="Your stats"
          title="See your matchup matrix at a glance."
          description="Every legend you've played, every legend you've faced — win rates colour-coded, with going-first splits, recent form, battlefield performance, and a rolling win-rate chart. The kind of dashboard you'd spend a weekend building in a spreadsheet, except it's already there."
        />
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-slate-950/60 p-3 shadow-[0_0_80px_rgba(89,167,255,0.08)]">
          <Image
            alt="RiftLite personal stats panel — matchup matrix and summary sidebar"
            className="h-auto w-full rounded-xl"
            height={1009}
            src="/screenshots/stats-matrix.webp"
            width={1920}
          />
        </div>
      </FadeUp>

      {/* Feature 4: Deck library */}
      <FadeUp className="space-y-10">
        <SectionHeading
          id="feature-decks"
          eyebrow="Deck library"
          title="Piltover Archive, linked and cached."
          description="Paste a Piltover Archive link and RiftLite imports the full visual deck — runes, battlefields, mainboard, sideboard. Every match locks its deck snapshot, so your history stays accurate even when the live list keeps evolving."
        />
      </FadeUp>

      {/* Final download CTA */}
      <FadeUp>
        <Card className="relative overflow-hidden bg-[linear-gradient(135deg,rgba(89,167,255,0.18),rgba(166,124,255,0.16))]">
          <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-cyan-400/15 blur-3xl" />
          <div className="pointer-events-none absolute -left-24 -bottom-24 h-80 w-80 rounded-full bg-violet-400/10 blur-3xl" />
          <div className="relative flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl space-y-2">
              <h3 className="font-display text-3xl font-bold text-white md:text-4xl">
                Ready to track your next match?
              </h3>
              <p className="text-base leading-7 text-slate-300">
                Download RiftLite, play on TCGA or RiftAtlas, and every match logs itself.
                Stream overlay and community stats — all included.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href={downloadHref}>Download — free</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href={SITE_PATHS.guide}>How it works</Link>
              </Button>
            </div>
          </div>
        </Card>
      </FadeUp>

      {/* Community snapshot — smaller, under fold */}
      <FadeUp className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <Card className="space-y-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.26em] text-slate-500">
            Live community snapshot
          </div>
          <CardTitle className="text-2xl">
            {overview.totalMatches} matches · {overview.totalPlayers} players · {overview.totalDecks}{" "}
            decks
          </CardTitle>
          <CardDescription className="text-base">
            {overview.trackedLegends} legends tracked in the current window. Pulled straight from
            the same data RiftLite shows you in-app.
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
                <span className="font-medium text-emerald-300">
                  {formatPercent(overview.topDeck.winRate)} WR
                </span>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="secondary">
              <Link href={SITE_PATHS.matrix}>See the Match Matrix</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={SITE_PATHS.meta}>Legend Meta</Link>
            </Button>
          </div>
        </Card>
        <DiscordCta href={settings.discordUrl} />
      </FadeUp>

      <AdSlot placement="home-mid" slots={adSlots} />

      {/* Latest News */}
      <FadeUp className="space-y-8">
        <SectionHeading
          id="latest-news"
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
