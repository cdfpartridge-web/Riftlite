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

export function urlForImage(source: unknown) {
  return builder.image(source as never).fit("crop").auto("format").url();
}
