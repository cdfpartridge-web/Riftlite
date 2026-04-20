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
  let b = builder.image(source as never).auto("format").fit("crop");
  if (options?.width) b = b.width(options.width);
  if (options?.height) b = b.height(options.height);
  const url = b.url();
  // Append bg manually — @sanity/image-url doesn't expose .bg() but the
  // Sanity image pipeline accepts it as a query param. Fills transparent
  // areas (e.g. PNG card art) with the site background so they don't go black.
  return `${url}${url.includes("?") ? "&" : "?"}bg=0c1021`;
}
