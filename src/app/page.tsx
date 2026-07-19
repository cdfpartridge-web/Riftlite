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
  title: "RiftLite - The Complete Riftbound Companion",
  description:
    "Automatically track Riftbound matches, watch animated Atlas replays, prepare matchups, review video, study the live meta, and run private testing hubs with RiftLite.",
  path: "/",
  image: "/screenshots/web-replay-v0801.png",
});

const workflow = [
  {
    step: "01",
    title: "Play normally",
    body: "Open TCGA or RiftAtlas through RiftLite. There is no match form and no start-tracking button.",
  },
  {
    step: "02",
    title: "Capture automatically",
    body: "Legends, deck, result, points, BO3 games, sideboarding, and replay evidence stay connected.",
  },
  {
    step: "03",
    title: "Review deeply",
    body: "Watch the board replay, inspect the video, flag decisions, compare matchups, and update your prep.",
  },
  {
    step: "04",
    title: "Share with your team",
    body: "Keep it private, create an unlisted replay link, or send future matches to a private-hub Discord.",
  },
] as const;

const featureCards = [
  {
    eyebrow: "Automatic capture",
    title: "Every match logs itself",
    body: "TCGA and RiftAtlas matches land in your history with the matchup, deck, points, result, and BO1 or BO3 structure intact.",
    detail: "TCGA + RiftAtlas",
  },
  {
    eyebrow: "Video review",
    title: "Replay, coach, clip, export",
    body: "Record the full match, review at up to 6×, add flags, drawings and audio notes, then export MP4s or short vertical clips.",
    detail: "Flags · MP4 · Shadow clips",
  },
  {
    eyebrow: "Matchup Lab",
    title: "Turn history into decisions",
    body: "See your personal matchup matrix, recent form, going-first splits, battlefield performance, and the matches behind every number.",
    detail: "Personal + community data",
  },
  {
    eyebrow: "Decks & prep",
    title: "Prepare before game one",
    body: "Save visual decklists, version snapshots, mulligan plans, sideboard maps, battlefield priorities, and matchup-specific notes.",
    detail: "Mulligan · Sideboard · Notes",
  },
  {
    eyebrow: "Accounts & cloud",
    title: "Move devices without starting over",
    body: "Link one RiftLite identity and opt in to protected cloud backup for matches, decks, prep, and settings. Local replay video stays local.",
    detail: "Opt-in · Conflict-safe",
  },
  {
    eyebrow: "Testing teams",
    title: "Private hubs that feed themselves",
    body: "Bring players into a private hub, verify through Discord, collect opted-in match data, and post permanent replay links to reports channels.",
    detail: "Hubs · Discord · LFG",
  },
] as const;

const replayHighlights = [
  "Animated mulligans, card choices, tokens, counters, labels, equipment, and board movement",
  "Complete BO3 playback with between-game score, setup, and exact captured sideboard changes",
  "Private by default, with unlisted permanent links when you choose to share",
  "Automatic account-owned upload after an opted-in Atlas match finishes",
] as const;

export default async function HomePage() {
  const [overview, newsPosts, adSlots, settings] = await Promise.all([
    getCommunityOverview(),
    getNewsPosts(),
    getAdSlots(),
    getSiteSettings(),
  ]);

  const downloadHref = safeHref(settings.downloadUrl);
  const playerStatLabel =
    overview.playerCountMode === "lifetime" ? "Players tracked" : "Recent players";

  return (
    <div className="overflow-hidden">
      <div className="mx-auto max-w-[1440px] space-y-28 px-5 py-10 sm:px-8 lg:px-12 lg:py-16">
        <section
          aria-labelledby="hero-title"
          className="relative grid min-h-[720px] gap-12 overflow-hidden rounded-[38px] border border-cyan-300/10 bg-[radial-gradient(circle_at_78%_12%,rgba(166,124,255,0.22),transparent_35%),radial-gradient(circle_at_10%_20%,rgba(89,167,255,0.18),transparent_34%),linear-gradient(145deg,rgba(12,20,48,0.98),rgba(6,10,27,0.96))] px-6 py-10 shadow-[0_30px_100px_rgba(2,7,23,0.65),inset_0_1px_0_rgba(255,255,255,0.08)] sm:px-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:px-14 lg:py-14"
        >
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(114,215,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(114,215,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" />
          <div className="relative z-10 animate-fade-up space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/8 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.23em] text-cyan-100">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(114,215,255,0.9)]" />
              RiftLite 0.9.00 · Windows + macOS
            </div>
            <div className="space-y-5">
              <h1
                className="max-w-3xl font-display text-5xl font-bold leading-[0.96] tracking-[-0.045em] text-white sm:text-6xl lg:text-7xl"
                id="hero-title"
              >
                Play the match.
                <span className="block bg-gradient-to-r from-cyan-200 via-sky-300 to-violet-300 bg-clip-text text-transparent">
                  Keep the lesson.
                </span>
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-slate-300">
                RiftLite is the complete Riftbound companion for serious play: automatic match
                tracking, animated Atlas replays, video review, matchup prep, live community data,
                and private testing teams in one desktop app.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href={downloadHref}>Download RiftLite — free</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href={SITE_PATHS.replays}>Watch a real replay</Link>
              </Button>
            </div>
            <div className="grid max-w-2xl gap-3 text-sm text-slate-300 sm:grid-cols-3">
              {[
                "Automatic on TCGA + Atlas",
                "Local-first, opt-in cloud",
                "No account needed to start",
              ].map((item) => (
                <div className="flex items-center gap-2" key={item}>
                  <span className="text-cyan-300">✓</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 animate-fade-up delay-150 lg:pl-2">
            <div className="absolute -inset-10 rounded-full bg-violet-500/12 blur-3xl" />
            <div className="relative overflow-hidden rounded-[30px] border border-white/12 bg-[#050a17] p-2 shadow-[0_25px_90px_rgba(0,0,0,0.65),0_0_70px_rgba(89,167,255,0.12)]">
              <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200">
                    RiftLite Web Replay
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">Akali vs Annie · BO3</div>
                </div>
                <div className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-200">
                  Live feature
                </div>
              </div>
              <Image
                alt="RiftLite Web Replay showing an animated Akali versus Annie best-of-three matchup"
                className="h-auto w-full rounded-[22px]"
                height={1080}
                priority
                src="/screenshots/web-replay-v0801.png"
                width={1920}
              />
            </div>
            <div className="absolute -bottom-5 left-6 right-6 grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-[#0a1023]/95 p-3 shadow-2xl backdrop-blur-xl sm:left-auto sm:right-8 sm:w-[430px]">
              {[
                ["BO3", "One replay"],
                ["Sideboard", "Animated"],
                ["Sharing", "Private first"],
              ].map(([label, value]) => (
                <div className="text-center" key={label}>
                  <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</div>
                  <div className="mt-1 text-xs font-semibold text-white">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <FadeUp className="grid gap-4 md:grid-cols-4">
          <StatCard label="Lifetime matches tracked" value={overview.totalMatches.toLocaleString()} />
          <StatCard label={playerStatLabel} value={overview.totalPlayers.toLocaleString()} />
          <StatCard label="Legends in the data" value={overview.trackedLegends.toLocaleString()} />
          <StatCard label="Current top Legend" value={overview.topLegend?.legend ?? "—"} tone="win" />
        </FadeUp>

        <FadeUp className="space-y-10">
          <SectionHeading
            id="how-riftlite-works"
            eyebrow="One connected workflow"
            title="From queue to review without the admin."
            description="RiftLite stays out of the way while you play, then brings the match, replay, statistics, prep, and team workflow together when you are ready to learn from it."
          />
          <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {workflow.map((item) => (
              <li
                className="group relative overflow-hidden rounded-3xl border border-white/[0.07] bg-white/[0.025] p-6 transition duration-300 hover:-translate-y-1 hover:border-cyan-300/20 hover:bg-cyan-300/[0.035]"
                key={item.step}
              >
                <div className="text-5xl font-black tracking-[-0.06em] text-white/[0.055] transition group-hover:text-cyan-200/10">
                  {item.step}
                </div>
                <h3 className="mt-6 font-display text-xl font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{item.body}</p>
              </li>
            ))}
          </ol>
        </FadeUp>

        <FadeUp className="grid gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
          <div className="relative overflow-hidden rounded-[32px] border border-cyan-300/15 bg-[#050a17] p-2 shadow-[0_0_90px_rgba(89,167,255,0.1)]">
            <Image
              alt="Animated RiftLite Web Replay with matchup cards, timeline, and current-card inspector"
              className="h-auto w-full rounded-[24px]"
              height={1080}
              src="/screenshots/web-replay-v0801.png"
              width={1920}
            />
          </div>
          <div className="space-y-7">
            <SectionHeading
              id="feature-web-replay"
              eyebrow="RiftLite Web Replay"
              title="The match becomes a living board."
              description="Complete an opted-in Atlas match and RiftLite can rebuild it online as an account-owned, deterministic replay—ready inside the app or on the web."
            />
            <ul className="space-y-3">
              {replayHighlights.map((item) => (
                <li
                  className="flex gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4 text-sm leading-6 text-slate-300"
                  key={item}
                >
                  <span className="mt-0.5 text-cyan-300">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href={SITE_PATHS.replays}>Explore public replays</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/account">Connect your account</Link>
              </Button>
            </div>
          </div>
        </FadeUp>

        <FadeUp className="space-y-10">
          <SectionHeading
            id="feature-suite"
            eyebrow="Everything around the match"
            title="One companion, not six disconnected tools."
            description="RiftLite covers the full testing loop—from capture and replay to prep, statistics, account continuity, and team collaboration."
          />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {featureCards.map((feature) => (
              <article
                className="group min-h-64 rounded-[28px] border border-white/[0.07] bg-[linear-gradient(145deg,rgba(19,29,61,0.66),rgba(8,13,31,0.78))] p-7 transition duration-300 hover:-translate-y-1 hover:border-violet-300/20 hover:shadow-[0_20px_60px_rgba(0,0,0,0.28)]"
                key={feature.title}
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200">
                  {feature.eyebrow}
                </div>
                <h3 className="mt-6 font-display text-2xl font-semibold tracking-tight text-white">
                  {feature.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{feature.body}</p>
                <div className="mt-7 border-t border-white/[0.06] pt-4 text-xs font-semibold text-slate-300">
                  {feature.detail}
                </div>
              </article>
            ))}
          </div>
        </FadeUp>

        <AdSlot placement="home-hero" slots={adSlots} />

        <FadeUp className="space-y-10">
          <SectionHeading
            id="feature-insight"
            eyebrow="Your data, made useful"
            title="See the pattern. Prepare the answer."
            description="Move from a saved result to the exact matchup evidence, deck version, replay moment, and prep note that helps with the next game."
          />
          <div className="grid gap-5 lg:grid-cols-12">
            <div className="overflow-hidden rounded-[30px] border border-white/[0.08] bg-slate-950/60 p-2 lg:col-span-7">
              <Image
                alt="RiftLite personal matchup statistics and matrix"
                className="h-full w-full rounded-[23px] object-cover"
                height={1009}
                src="/screenshots/stats-matrix.webp"
                width={1920}
              />
            </div>
            <div className="overflow-hidden rounded-[30px] border border-white/[0.08] bg-slate-950/60 p-2 lg:col-span-5">
              <Image
                alt="RiftLite visual deck library"
                className="h-full w-full rounded-[23px] object-cover object-left"
                height={1009}
                src="/screenshots/deck-viewer.webp"
                width={1920}
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ["Matchup Lab", "Filter by your Legend, open the supporting matches, and compare real personal results with the community."],
              ["Versioned decks", "Keep the exact list used for each match, even after the live deck changes."],
              ["Visual preparation", "Build mulligan, sideboard, battlefield, and card-priority plans for every matchup."],
            ].map(([title, body]) => (
              <Card className="rounded-3xl" key={title}>
                <CardTitle>{title}</CardTitle>
                <CardDescription className="mt-2">{body}</CardDescription>
              </Card>
            ))}
          </div>
        </FadeUp>

        <FadeUp className="relative overflow-hidden rounded-[36px] border border-violet-300/15 bg-[radial-gradient(circle_at_80%_20%,rgba(166,124,255,0.2),transparent_34%),linear-gradient(135deg,rgba(17,27,61,0.94),rgba(7,12,29,0.96))] p-8 sm:p-12">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:42px_42px]" />
          <div className="relative grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div className="space-y-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-violet-200">
                Built for testing groups
              </div>
              <h2 className="font-display text-4xl font-bold tracking-tight text-white md:text-5xl">
                Your private hub can become the team’s shared memory.
              </h2>
              <p className="text-base leading-7 text-slate-300">
                Players keep their own account and local data. The hub receives only the opted-in
                match and replay workflows you configure, with Discord verification and reports
                built around the same RiftLite identity.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link href="/hubs">Open My Hubs</Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link href={SITE_PATHS.lfg}>Find players</Link>
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["Verified members", "One account identity across RiftLite, the website, hub membership, and Discord."],
                ["Replay reports", "Post new unlisted replay links automatically to the hub’s configured reports channel."],
                ["Private team data", "Hub match details stay separate from the public community dataset."],
                ["Goals & leaderboards", "Build testing reports, contribution tracking, and weekly progress around real matches."],
              ].map(([title, body]) => (
                <div className="rounded-2xl border border-white/[0.08] bg-black/15 p-5" key={title}>
                  <h3 className="font-display text-lg font-semibold text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </FadeUp>

        <FadeUp className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-stretch">
          <Card className="relative overflow-hidden p-8 sm:p-10">
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
            <div className="relative space-y-6">
              <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-200">
                Live Riftbound community
              </div>
              <CardTitle className="max-w-2xl text-3xl sm:text-4xl">
                {overview.totalMatches.toLocaleString()} matches. A meta you can actually inspect.
              </CardTitle>
              <CardDescription className="max-w-2xl text-base leading-7">
                Browse the same community matchups, deck trends, and season filters that power the
                in-app tools. Vendetta Preview and the pre-Vendetta archive remain separate.
              </CardDescription>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
                  <div className="text-xs text-slate-500">Players tracked</div>
                  <div className="mt-1 text-2xl font-bold text-white">{overview.totalPlayers.toLocaleString()}</div>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
                  <div className="text-xs text-slate-500">Decks tracked</div>
                  <div className="mt-1 text-2xl font-bold text-white">{overview.totalDecks.toLocaleString()}</div>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
                  <div className="text-xs text-slate-500">Top Legend win rate</div>
                  <div className="mt-1 text-2xl font-bold text-emerald-300">
                    {overview.topLegend ? formatPercent(overview.topLegend.winRate) : "—"}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="secondary">
                  <Link href={SITE_PATHS.matrix}>Explore the Match Matrix</Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link href={SITE_PATHS.decks}>Browse community decks</Link>
                </Button>
              </div>
            </div>
          </Card>
          <DiscordCta href={settings.discordUrl} />
        </FadeUp>

        <AdSlot placement="home-mid" slots={adSlots} />

        <FadeUp className="space-y-8">
          <SectionHeading
            id="latest-news"
            eyebrow="Latest News"
            title="Patch notes, meta shifts, and announcements."
            description="Stay on top of what is changing in Riftbound and what is new in RiftLite."
          />
          <div className="grid gap-6 lg:grid-cols-2">
            {newsPosts.slice(0, 2).map((post) => (
              <NewsCard key={post.slug} post={post} />
            ))}
          </div>
          <div>
            <Button asChild variant="secondary">
              <Link href="/news">View all news</Link>
            </Button>
          </div>
        </FadeUp>

        <FadeUp>
          <Card className="relative overflow-hidden border-cyan-300/15 bg-[linear-gradient(135deg,rgba(89,167,255,0.2),rgba(166,124,255,0.18))] p-8 sm:p-12">
            <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-cyan-400/15 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-violet-400/10 blur-3xl" />
            <div className="relative flex flex-col items-start gap-7 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-3xl space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-100">
                  Free to start · No account required
                </div>
                <h2 className="font-display text-4xl font-bold tracking-tight text-white md:text-5xl">
                  Your next match can teach you more.
                </h2>
                <p className="text-base leading-7 text-slate-200">
                  Download RiftLite, choose TCGA or RiftAtlas, and let the companion handle the
                  capture while you focus on the game.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href={downloadHref}>Download v0.9.00</Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <Link href={SITE_PATHS.guide}>See how it works</Link>
                </Button>
              </div>
            </div>
          </Card>
        </FadeUp>
      </div>
    </div>
  );
}
