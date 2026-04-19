import "server-only";

import { unstable_cache } from "next/cache";

import {
  FIXTURE_AD_SLOTS,
  FIXTURE_HOME_HERO,
  FIXTURE_NEWS_POSTS,
  FIXTURE_SITE_SETTINGS,
  FIXTURE_STREAM_MODULE,
} from "@/lib/fixtures/content";
import type {
  AdSlotConfig,
  HomeHero,
  NewsPost,
  SiteSettings,
  StreamModule,
} from "@/lib/types";
import { isSanityConfigured, sanityClient } from "@/lib/sanity/client";
import {
  adSlotsQuery,
  homeHeroQuery,
  newsPostBySlugQuery,
  newsPostsQuery,
  siteSettingsQuery,
  streamModuleQuery,
} from "@/lib/sanity/queries";

// Sanity content changes infrequently; cache aggressively and rely on tag-
// based revalidation (via webhooks) for instant updates when editors publish.
const CONTENT_TTL_SECONDS = 600; // 10 min
const NEWS_TTL_SECONDS = 60; // matches existing news page revalidate

function withCacheFallback<TArgs extends unknown[], TResult>(
  inner: (...args: TArgs) => Promise<TResult>,
  cached: (...args: TArgs) => Promise<TResult>,
) {
  return async (...args: TArgs) => {
    try {
      return await cached(...args);
    } catch {
      // unstable_cache throws when called outside a Next.js request context
      // (e.g. during vitest); fall through to the raw fetch in that case.
      return inner(...args);
    }
  };
}

async function fetchNewsPosts(): Promise<NewsPost[]> {
  if (!isSanityConfigured()) return FIXTURE_NEWS_POSTS;
  return sanityClient.fetch(newsPostsQuery);
}

async function fetchNewsPostBySlug(slug: string): Promise<NewsPost | null> {
  if (!isSanityConfigured()) {
    return FIXTURE_NEWS_POSTS.find((post) => post.slug === slug) ?? null;
  }
  return sanityClient.fetch(newsPostBySlugQuery, { slug });
}

async function fetchSiteSettings(): Promise<SiteSettings> {
  if (!isSanityConfigured()) return FIXTURE_SITE_SETTINGS;
  return (await sanityClient.fetch(siteSettingsQuery)) ?? FIXTURE_SITE_SETTINGS;
}

async function fetchHomeHero(): Promise<HomeHero> {
  if (!isSanityConfigured()) return FIXTURE_HOME_HERO;
  return (await sanityClient.fetch(homeHeroQuery)) ?? FIXTURE_HOME_HERO;
}

async function fetchAdSlots(): Promise<AdSlotConfig[]> {
  if (!isSanityConfigured()) return FIXTURE_AD_SLOTS;
  const slots = (await sanityClient.fetch(adSlotsQuery)) as AdSlotConfig[] | null;
  return slots?.length ? slots : FIXTURE_AD_SLOTS;
}

async function fetchStreamModule(): Promise<StreamModule> {
  if (!isSanityConfigured()) return FIXTURE_STREAM_MODULE;
  return (await sanityClient.fetch(streamModuleQuery)) ?? FIXTURE_STREAM_MODULE;
}

const cachedSiteSettings = unstable_cache(fetchSiteSettings, ["sanity-site-settings-v1"], {
  revalidate: CONTENT_TTL_SECONDS,
  tags: ["sanity-content", "sanity-site-settings"],
});

const cachedHomeHero = unstable_cache(fetchHomeHero, ["sanity-home-hero-v1"], {
  revalidate: CONTENT_TTL_SECONDS,
  tags: ["sanity-content", "sanity-home-hero"],
});

const cachedAdSlots = unstable_cache(fetchAdSlots, ["sanity-ad-slots-v1"], {
  revalidate: CONTENT_TTL_SECONDS,
  tags: ["sanity-content", "sanity-ad-slots"],
});

const cachedStreamModule = unstable_cache(fetchStreamModule, ["sanity-stream-module-v1"], {
  revalidate: CONTENT_TTL_SECONDS,
  tags: ["sanity-content", "sanity-stream-module"],
});

const cachedNewsPosts = unstable_cache(fetchNewsPosts, ["sanity-news-posts-v1"], {
  revalidate: NEWS_TTL_SECONDS,
  tags: ["sanity-content", "sanity-news"],
});

const cachedNewsPostBySlug = unstable_cache(
  fetchNewsPostBySlug,
  ["sanity-news-post-by-slug-v1"],
  { revalidate: NEWS_TTL_SECONDS, tags: ["sanity-content", "sanity-news"] },
);

export const getSiteSettings = withCacheFallback(fetchSiteSettings, cachedSiteSettings);
export const getHomeHero = withCacheFallback(fetchHomeHero, cachedHomeHero);
export const getAdSlots = withCacheFallback(fetchAdSlots, cachedAdSlots);
export const getStreamModule = withCacheFallback(fetchStreamModule, cachedStreamModule);
export const getNewsPosts = withCacheFallback(fetchNewsPosts, cachedNewsPosts);
export const getNewsPostBySlug = withCacheFallback(
  fetchNewsPostBySlug,
  cachedNewsPostBySlug,
);
