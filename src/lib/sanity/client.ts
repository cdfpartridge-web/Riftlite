import "server-only";

import { createImageUrlBuilder } from "@sanity/image-url";
import { createClient } from "next-sanity";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? "";
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
const apiVersion = "2026-03-01";

export const sanityClient = createClient({
  projectId: projectId || "demo",
  dataset,
  apiVersion,
  useCdn: true,
  token: process.env.SANITY_API_TOKEN,
});

const builder = createImageUrlBuilder(sanityClient);

export function isSanityConfigured() {
  return Boolean(projectId);
}

export function urlForImage(source: unknown, options?: { width?: number; height?: number }) {
  // bg fills transparent areas (e.g. PNG legends/card art) with the site's
  // background colour instead of black. auto("format") serves WebP/AVIF which
  // preserve transparency when the browser supports them, but the bg fallback
  // handles the cases where it converts to JPEG.
  let b = builder.image(source as never).bg("0c1021").auto("format").fit("crop");
  if (options?.width) b = b.width(options.width);
  if (options?.height) b = b.height(options.height);
  return b.url();
}
