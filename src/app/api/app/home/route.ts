import { NextResponse } from "next/server";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { resolvePublicLiveTakeover } from "@/lib/live-takeover-status";
import { normalizeCreatorVideoCarouselConfig } from "@/lib/youtube/creator-video-config";
import {
  type CreatorVideoCarouselResult,
  getCreatorVideoCarousel,
} from "@/lib/youtube/creator-video-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HomeFeaturedVideo = {
  title: string;
  url: string;
  embedUrl: string;
};

type HomeFeaturedVideoSlots = [HomeFeaturedVideo | null, HomeFeaturedVideo | null];

const DEFAULT_FEATURED_VIDEOS: HomeFeaturedVideo[] = [
  {
    title: "Featured RiftLite video",
    url: "https://www.youtube.com/watch?v=4n0x_t-wprg",
    embedUrl: "https://www.youtube-nocookie.com/embed/4n0x_t-wprg",
  },
  {
    title: "Featured RiftLite video",
    url: "https://www.youtube.com/watch?v=gUHFg8zSnSY",
    embedUrl: "https://www.youtube-nocookie.com/embed/gUHFg8zSnSY",
  },
];

const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=7200",
};

export async function GET() {
  const homeConfig = await readHomeConfig();
  const featuredVideos = readFeaturedVideos(homeConfig.data);
  const creatorVideoCarousel = normalizeCreatorVideoCarouselConfig(
    homeConfig.data?.creatorVideoCarousel,
    homeConfig.data?.communitySpotlights,
  );
  const [creatorVideoResult, liveTakeover] = await Promise.all([
    readCreatorVideoCarousel(creatorVideoCarousel, homeConfig.db),
    resolvePublicLiveTakeover(homeConfig.data),
  ]);
  return NextResponse.json({
    // Keep the singular field for older desktop builds while current builds
    // use the ordered array to populate both homepage video slots.
    featuredVideo: featuredVideos[0],
    featuredVideos,
    creatorVideos: creatorVideoResult.videos,
    creatorVideoCarousel: {
      enabled: creatorVideoCarousel.enabled,
      rotationSeconds: creatorVideoCarousel.rotationSeconds,
      maxItems: creatorVideoCarousel.maxItems,
    },
    creatorVideosUpdatedAt: creatorVideoResult.updatedAt,
    liveTakeover,
  }, { headers: JSON_HEADERS });
}

type HomeConfigRead = {
  db: ReturnType<typeof getFirestoreAdmin>;
  data: Record<string, unknown> | null;
};

async function readHomeConfig(): Promise<HomeConfigRead> {
  const db = getFirestoreAdmin();
  if (!db) return { db: null, data: null };
  try {
    const snapshot = await db.collection("app_config").doc("home").get();
    return {
      db,
      data: snapshot.exists ? snapshot.data() ?? null : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/app/home] Failed to read home config:", message);
    return { db, data: null };
  }
}

function readFeaturedVideos(data: Record<string, unknown> | null): HomeFeaturedVideo[] {
  const envVideos = parseFeaturedVideoSlots([
    {
      title: process.env.RIFTLITE_HOME_VIDEO_TITLE,
      url: process.env.RIFTLITE_HOME_VIDEO_URL,
      embedUrl: process.env.RIFTLITE_HOME_VIDEO_EMBED_URL,
    },
    {
      title: process.env.RIFTLITE_HOME_VIDEO_2_TITLE,
      url: process.env.RIFTLITE_HOME_VIDEO_2_URL,
      embedUrl: process.env.RIFTLITE_HOME_VIDEO_2_EMBED_URL,
    },
  ]);
  const fallback = fillFeaturedVideoSlots(envVideos, defaultFeaturedVideoSlots());
  if (!data) return fallback;
  const configuredVideos = parseFeaturedVideoSlots(
    data.featuredVideos ?? (data.featuredVideo ? [data.featuredVideo] : data),
  );
  return fillFeaturedVideoSlots(configuredVideos, toFeaturedVideoSlots(fallback));
}

async function readCreatorVideoCarousel(
  config: ReturnType<typeof normalizeCreatorVideoCarouselConfig>,
  db: ReturnType<typeof getFirestoreAdmin>,
): Promise<CreatorVideoCarouselResult> {
  try {
    return await getCreatorVideoCarousel(config, db);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/app/home] Failed to read creator videos:", message);
    return { videos: [], updatedAt: "" };
  }
}

function parseFeaturedVideoSlots(value: unknown): HomeFeaturedVideoSlots {
  const entries = Array.isArray(value) ? value : [value];
  return [parseFeaturedVideo(entries[0]), parseFeaturedVideo(entries[1])];
}

function fillFeaturedVideoSlots(
  videos: HomeFeaturedVideoSlots,
  fallback: HomeFeaturedVideoSlots,
): HomeFeaturedVideo[] {
  const filled: HomeFeaturedVideo[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < 2; index += 1) {
    const candidates = [videos[index], fallback[index], ...DEFAULT_FEATURED_VIDEOS];
    const next = candidates.find((video) => video && !seen.has(video.embedUrl));
    if (next) {
      filled.push(next);
      seen.add(next.embedUrl);
    }
  }
  return filled;
}

function defaultFeaturedVideoSlots(): HomeFeaturedVideoSlots {
  return [DEFAULT_FEATURED_VIDEOS[0], DEFAULT_FEATURED_VIDEOS[1]];
}

function toFeaturedVideoSlots(videos: HomeFeaturedVideo[]): HomeFeaturedVideoSlots {
  return [videos[0] ?? null, videos[1] ?? null];
}

function parseFeaturedVideo(value: unknown): HomeFeaturedVideo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const url = typeof payload.url === "string" ? payload.url.trim() : "";
  const embedSource = typeof payload.embedUrl === "string" ? payload.embedUrl.trim() : url;
  const videoId = youtubeVideoIdFromUrl(embedSource);
  if (!videoId) {
    return null;
  }
  return {
    title: typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : DEFAULT_FEATURED_VIDEOS[0].title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
  };
}

function youtubeVideoIdFromUrl(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return "";
  }
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = normalizeYoutubeVideoId(url.pathname.split("/").filter(Boolean)[0] ?? "");
      return id;
    }
    if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "m.youtube.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      const embedIndex = parts.indexOf("embed");
      const shortsIndex = parts.indexOf("shorts");
      const liveIndex = parts.indexOf("live");
      const id = normalizeYoutubeVideoId(embedIndex >= 0
        ? parts[embedIndex + 1] ?? ""
        : shortsIndex >= 0
          ? parts[shortsIndex + 1] ?? ""
          : liveIndex >= 0
            ? parts[liveIndex + 1] ?? ""
            : url.searchParams.get("v") ?? "");
      return id;
    }
  } catch {
    return "";
  }
  return "";
}

function normalizeYoutubeVideoId(value: string): string {
  return value.trim().match(/^[A-Za-z0-9_-]{11}$/)?.[0] ?? "";
}
