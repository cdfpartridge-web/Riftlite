import { NextResponse } from "next/server";

import { getFirestoreAdmin } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HomeFeaturedVideo = {
  title: string;
  url: string;
  embedUrl: string;
};

const DEFAULT_FEATURED_VIDEO: HomeFeaturedVideo = {
  title: "Featured video",
  url: "https://www.youtube.com/watch?v=DMXztr0OOXc",
  embedUrl: "https://www.youtube-nocookie.com/embed/DMXztr0OOXc",
};

const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=7200",
};

export async function GET() {
  const featuredVideo = await readFeaturedVideo();
  return NextResponse.json({ featuredVideo }, { headers: JSON_HEADERS });
}

async function readFeaturedVideo(): Promise<HomeFeaturedVideo> {
  const envVideo = parseFeaturedVideo({
    title: process.env.RIFTLITE_HOME_VIDEO_TITLE,
    url: process.env.RIFTLITE_HOME_VIDEO_URL,
    embedUrl: process.env.RIFTLITE_HOME_VIDEO_EMBED_URL,
  });
  const fallback = envVideo ?? DEFAULT_FEATURED_VIDEO;

  const db = getFirestoreAdmin();
  if (!db) {
    return fallback;
  }

  try {
    const snapshot = await db.collection("app_config").doc("home").get();
    const data = snapshot.exists ? snapshot.data() : null;
    const video = parseFeaturedVideo(data?.featuredVideo ?? data);
    return video ?? fallback;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/app/home] Failed to read home config:", message);
    return fallback;
  }
}

function parseFeaturedVideo(value: unknown): HomeFeaturedVideo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const url = typeof payload.url === "string" ? payload.url.trim() : "";
  const embedSource = typeof payload.embedUrl === "string" ? payload.embedUrl.trim() : url;
  const embedUrl = youtubeEmbedFromUrl(embedSource);
  if (!embedUrl) {
    return null;
  }
  return {
    title: typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : DEFAULT_FEATURED_VIDEO.title,
    url: url || embedUrl,
    embedUrl,
  };
}

function youtubeEmbedFromUrl(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return "";
  }
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : "";
    }
    if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "m.youtube.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      const embedIndex = parts.indexOf("embed");
      const id = embedIndex >= 0 ? parts[embedIndex + 1] : url.searchParams.get("v") ?? "";
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : "";
    }
  } catch {
    return "";
  }
  return "";
}
