import type { Metadata } from "next";

export const SITE_URL = "https://www.riftlite.com";
export const SITE_NAME = "RiftLite";
export const DEFAULT_OG_IMAGE = "/brand/riftlite-logo-transparent.png";
export const DEFAULT_SITE_DESCRIPTION =
  "Automatic Riftbound match tracking for TCGA and RiftAtlas, with visual replays, personal matchup stats, community meta data, and an OBS overlay.";

type PageMetadataOptions = {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: "website" | "article";
  publishedTime?: string;
  tags?: string[];
  noIndex?: boolean;
};

export function absoluteUrl(path = "/"): string {
  if (/^https?:\/\//i.test(path)) return path;
  return new URL(path, SITE_URL).toString();
}

export function createPageMetadata({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
  type = "website",
  publishedTime,
  tags,
  noIndex = false,
}: PageMetadataOptions): Metadata {
  const canonical = absoluteUrl(path);
  const imageUrl = absoluteUrl(image);
  const openGraph =
    type === "article"
      ? {
          title,
          description,
          url: canonical,
          siteName: SITE_NAME,
          type,
          publishedTime,
          tags,
          images: [{ url: imageUrl, width: 1200, height: 630 }],
        }
      : {
          title,
          description,
          url: canonical,
          siteName: SITE_NAME,
          type,
          images: [{ url: imageUrl, width: 1200, height: 630 }],
        };

  return {
    title,
    description,
    alternates: { canonical },
    openGraph,
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
          googleBot: {
            index: false,
            follow: false,
          },
        }
      : undefined,
  };
}

export function createNoIndexMetadata(title: string, description: string, path: string): Metadata {
  return createPageMetadata({ title, description, path, noIndex: true });
}
