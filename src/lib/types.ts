export type MatchResult = "Win" | "Loss" | "Draw" | string;

export type DeckEntry = {
  qty: number;
  name: string;
  cardId?: string;
  imageUrl?: string;
};

export type MatchGame = {
  myBf: string;
  oppBf: string;
  wentFirst: string;
  result: MatchResult;
  myPoints: number;
  oppPoints: number;
};

export type DeckSnapshot = {
  title?: string;
  legend: string;
  legendKey: string;
  sourceUrl?: string;
  sourceKey?: string;
  legendEntry?: DeckEntry | null;
  champion?: DeckEntry[];
  runes: DeckEntry[];
  battlefields: DeckEntry[];
  mainDeck: DeckEntry[];
  sideboard: DeckEntry[];
};

export type CommunityMatch = {
  id: string;
  uid: string;
  username: string;
  date: string;
  result: MatchResult;
  myChampion: string;
  oppChampion: string;
  oppName: string;
  fmt: string;
  score: string;
  wentFirst: string;
  myBattlefield: string;
  oppBattlefield: string;
  flags: string;
  games: MatchGame[];
  deckName: string;
  deckSourceUrl: string;
  deckSourceKey: string;
  deckSnapshot: DeckSnapshot | null;
  createdAt: number;
};

export type CommunityFilterParams = {
  legend: string;
  result: string;
  seat: string;
  battlefield: string;
  flags: string;
  page: number;
  pageSize: number;
};

export type LegendMetaRow = {
  legend: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
};

export type MatchupCell = {
  myLegend: string;
  oppLegend: string;
  wins: number;
  losses: number;
  draws: number;
  decisiveGames: number;
  totalGames: number;
  winRate: number;
};

export type MatrixView = {
  rows: string[];
  columns: string[];
  cells: MatchupCell[];
};

export type DeckGroup = {
  deckKey: string;
  title: string;
  legend: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  sourceUrl: string;
  sourceKey: string;
  snapshot: DeckSnapshot | null;
  representativeMatchId: string;
};

export type CommunityOverview = {
  totalMatches: number;
  totalPlayers: number;
  totalDecks: number;
  trackedLegends: number;
  topLegend: LegendMetaRow | null;
  topDeck: DeckGroup | null;
  featuredDecks: DeckGroup[];
};

export type NewsPost = {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  coverImage?: string; // plain CDN URL projected from GROQ (coverImage.asset->url)
  body: unknown[];
  tags: string[];
  featured?: boolean;
};

export type AdSlotPlacement =
  | "home-hero"
  | "home-mid"
  | "community-top"
  | "community-sidebar"
  | "news-inline"
  | "news-footer";

export type AdSlotConfig = {
  placement: AdSlotPlacement;
  mode: "sponsor" | "adsense" | "placeholder";
  title: string;
  eyebrow?: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
  imageUrl?: string;
  adsenseClient?: string;
  adsenseSlot?: string;
};

export type SiteSettings = {
  siteTitle: string;
  siteDescription: string;
  discordUrl: string;
  twitchUrl: string;
  youtubeUrl: string;
  downloadUrl: string;
  guideVideoId?: string;
};

export type HomeHero = {
  eyebrow: string;
  headline: string;
  subheading: string;
  primaryCtaLabel: string;
  primaryCtaHref: string;
  secondaryCtaLabel: string;
  secondaryCtaHref: string;
};

export type StreamModule = {
  title: string;
  subtitle: string;
  channelLogin: string;
  channelUrl: string;
};

export type StreamStatus = {
  state: "live" | "offline" | "unavailable";
  isLive: boolean;
  tooltip: string;
  channelLogin: string;
  channelUrl: string;
};
