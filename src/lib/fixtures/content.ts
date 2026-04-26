import type {
  AdSlotConfig,
  HomeHero,
  NewsPost,
  SiteSettings,
  StreamModule,
} from "@/lib/types";

export const FIXTURE_SITE_SETTINGS: SiteSettings = {
  siteTitle: "RiftLite",
  siteDescription:
    "Live Riftbound stats, decks, and matchup data — built for players, by the community.",
  discordUrl: "https://discord.gg/KP3esbeBYF",
  twitchUrl: "https://www.twitch.tv/bmucasts",
  youtubeUrl: "https://www.youtube.com/@bmucasts",
  downloadUrl: "https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/latest/download/RiftLiteBetaInstall.exe",
  guideVideoId: "zQbb_9Nn-KQ",
};

export const FIXTURE_HOME_HERO: HomeHero = {
  eyebrow: "Built for Riftbound players",
  headline: "Know your matchups. Master your decks.",
  subheading:
    "Track your win rates, study the meta, browse the decks winning right now — all powered by the Riftbound community.",
  primaryCtaLabel: "Get the App",
  primaryCtaHref: "/download",
  secondaryCtaLabel: "Explore Community Stats",
  secondaryCtaHref: "/community/leaderboard",
};

export const FIXTURE_STREAM_MODULE: StreamModule = {
  title: "BMU Casts on Twitch",
  subtitle:
    "Keep the stream front-and-centre while browsing the numbers. Live status comes from the Twitch API when configured.",
  channelLogin: "bmucasts",
  channelUrl: "https://www.twitch.tv/bmucasts",
};

export const FIXTURE_AD_SLOTS: AdSlotConfig[] = [
  {
    placement: "home-hero",
    mode: "sponsor",
    eyebrow: "Featured Sponsor",
    title: "Reserve this RiftLite headline placement",
    body: "Direct sponsors can run branded art, a short message, and a tracked CTA here without cluttering the experience.",
    ctaLabel: "Become A Sponsor",
    ctaHref: "mailto:bmucasts@gmail.com",
  },
  {
    placement: "home-mid",
    mode: "adsense",
    title: "Home mid ad",
    adsenseSlot: "5763595628",
  },
  {
    placement: "community-top",
    mode: "adsense",
    title: "Community top ad",
    adsenseSlot: "2957455573",
  },
  {
    placement: "news-inline",
    mode: "adsense",
    title: "News inline ad",
    adsenseSlot: "2661942105",
  },
  {
    placement: "community-sidebar",
    mode: "placeholder",
    eyebrow: "Partner Placement",
    title: "Community sidebar sponsor slot",
    body: "Use this space for stream promos, partner offers, or future AdSense units.",
  },
  {
    placement: "news-footer",
    mode: "placeholder",
    eyebrow: "Promotion",
    title: "Article footer sponsor slot",
    body: "A second monetisation surface for long-form updates and announcement posts.",
  },
];

export const FIXTURE_NEWS_POSTS: NewsPost[] = [
  {
    slug: "riftlite-public-site-preview",
    title: "RiftLite’s public site is live in preview",
    excerpt:
      "The new web experience brings public community analytics, deck browsing, stream promotion, and a polished brand home into one place.",
    publishedAt: "2026-04-18T15:00:00Z",
    tags: ["Website", "Community", "Release"],
    featured: true,
    body: [
      {
        _type: "block",
        children: [
          {
            _type: "span",
            text: "This preview is the first full pass at turning RiftLite into a proper public-facing platform. Visitors can now browse read-only stats, matchup data, deck snapshots, and site news without needing the desktop app open.",
          },
        ],
      },
      {
        _type: "block",
        children: [
          {
            _type: "span",
            text: "The long-term goal is simple: make RiftLite feel trustworthy, current, and premium everywhere players discover it.",
          },
        ],
      },
    ],
  },
  {
    slug: "community-data-now-on-the-web",
    title: "Community stats now have a web home",
    excerpt:
      "Leaderboard confidence ranking, legend meta, matrix drilldowns, and match filtering now translate into a modern browser experience.",
    publishedAt: "2026-04-17T18:30:00Z",
    tags: ["Stats", "Web"],
    body: [
      {
        _type: "block",
        children: [
          {
            _type: "span",
            text: "The web portal mirrors the desktop app’s public analytics logic so players see consistent numbers wherever they browse.",
          },
        ],
      },
    ],
  },
];
