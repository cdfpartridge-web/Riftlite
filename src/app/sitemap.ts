import type { MetadataRoute } from "next";

import { buildDeckGroups } from "@/lib/community/aggregate";
import { getCommunityMatchWindow } from "@/lib/community/data";
import { LEGENDS } from "@/lib/constants";
import { getNewsPosts } from "@/lib/sanity/content";

// Cap the number of deck URLs we emit so crawlers don't create an ISR
// entry for every one-game deck. buildDeckGroups already sorts by
// games DESC, so this keeps the most-played decks indexed.
const SITEMAP_DECK_LIMIT = 30;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, matches] = await Promise.all([getNewsPosts(), getCommunityMatchWindow()]);
  const decks = buildDeckGroups(matches).slice(0, SITEMAP_DECK_LIMIT);
  const now = new Date();
  const staticRoutes: Array<{
    path: string;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
    priority: number;
  }> = [
    { path: "", changeFrequency: "daily", priority: 1.0 },
    { path: "/download", changeFrequency: "weekly", priority: 0.9 },
    { path: "/guide", changeFrequency: "monthly", priority: 0.8 },
    { path: "/scorepad", changeFrequency: "monthly", priority: 0.6 },
    { path: "/community/meta", changeFrequency: "daily", priority: 0.8 },
    { path: "/community/matrix", changeFrequency: "daily", priority: 0.8 },
    { path: "/community/matches", changeFrequency: "daily", priority: 0.7 },
    { path: "/community/decks", changeFrequency: "daily", priority: 0.8 },
    { path: "/community/decks/compare", changeFrequency: "weekly", priority: 0.6 },
    { path: "/news", changeFrequency: "weekly", priority: 0.7 },
    { path: "/about", changeFrequency: "monthly", priority: 0.5 },
    { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
    { path: "/cookies", changeFrequency: "yearly", priority: 0.3 },
  ];

  return [
    ...staticRoutes.map(({ path, changeFrequency, priority }) => ({
      url: `https://www.riftlite.com${path}`,
      lastModified: now,
      changeFrequency,
      priority,
    })),
    ...posts.map((post) => ({
      url: `https://www.riftlite.com/news/${post.slug}`,
      lastModified: new Date(post.publishedAt),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...LEGENDS.map((legend) => ({
      url: `https://www.riftlite.com/community/legends/${encodeURIComponent(legend)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.55,
    })),
    ...decks.map((deck) => ({
      url: `https://www.riftlite.com/community/decks/${encodeURIComponent(deck.deckKey)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
