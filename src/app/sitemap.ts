import type { MetadataRoute } from "next";

import { buildDeckGroups } from "@/lib/community/aggregate";
import { getCommunityMatchWindow } from "@/lib/community/data";
import { getNewsPosts } from "@/lib/sanity/content";

// Cap the number of deck URLs we emit so crawlers don't create an ISR
// entry for every one-game deck. buildDeckGroups already sorts by
// games DESC, so this keeps the most-played decks indexed.
const SITEMAP_DECK_LIMIT = 30;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, matches] = await Promise.all([getNewsPosts(), getCommunityMatchWindow()]);
  const decks = buildDeckGroups(matches).slice(0, SITEMAP_DECK_LIMIT);
  const staticRoutes = [
    "",
    "/community/leaderboard",
    "/community/meta",
    "/community/matrix",
    "/community/matches",
    "/community/decks",
    "/community/decks/compare",
    "/news",
    "/download",
    "/about",
    "/privacy",
    "/cookies",
  ];

  return [
    ...staticRoutes.map((path) => ({
      url: `https://riftlite.vercel.app${path}`,
      lastModified: new Date(),
    })),
    ...posts.map((post) => ({
      url: `https://riftlite.vercel.app/news/${post.slug}`,
      lastModified: new Date(post.publishedAt),
    })),
    ...decks.map((deck) => ({
      url: `https://riftlite.vercel.app/community/decks/${encodeURIComponent(deck.deckKey)}`,
      lastModified: new Date(),
    })),
  ];
}
