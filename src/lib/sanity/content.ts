import "server-only";

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

export async function getNewsPosts(): Promise<NewsPost[]> {
  if (!isSanityConfigured()) {
    return FIXTURE_NEWS_POSTS;
  }

  return sanityClient.fetch(newsPostsQuery);
}

export async function getNewsPostBySlug(slug: string): Promise<NewsPost | null> {
  if (!isSanityConfigured()) {
    return FIXTURE_NEWS_POSTS.find((post) => post.slug === slug) ?? null;
  }

  return sanityClient.fetch(newsPostBySlugQuery, { slug });
}

export async function getSiteSettings(): Promise<SiteSettings> {
  if (!isSanityConfigured()) {
    return FIXTURE_SITE_SETTINGS;
  }

  return (await sanityClient.fetch(siteSettingsQuery)) ?? FIXTURE_SITE_SETTINGS;
}

export async function getHomeHero(): Promise<HomeHero> {
  if (!isSanityConfigured()) {
    return FIXTURE_HOME_HERO;
  }

  return (await sanityClient.fetch(homeHeroQuery)) ?? FIXTURE_HOME_HERO;
}

export async function getAdSlots(): Promise<AdSlotConfig[]> {
  if (!isSanityConfigured()) {
    return FIXTURE_AD_SLOTS;
  }

  const slots = (await sanityClient.fetch(adSlotsQuery)) as AdSlotConfig[] | null;
  return slots?.length ? slots : FIXTURE_AD_SLOTS;
}

export async function getStreamModule(): Promise<StreamModule> {
  if (!isSanityConfigured()) {
    return FIXTURE_STREAM_MODULE;
  }

  return (await sanityClient.fetch(streamModuleQuery)) ?? FIXTURE_STREAM_MODULE;
}
