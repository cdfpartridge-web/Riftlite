import "server-only";

import { unstable_cache } from "next/cache";

import { getFirestoreAdmin } from "@/lib/firebase/admin";

export const HOME_CONFIG_CACHE_TAG = "app-home-config-v1";
export const HOME_CONFIG_CACHE_SECONDS = 5 * 60;

async function readHomeConfigFromFirestore(): Promise<Record<string, unknown> | null> {
  const db = getFirestoreAdmin();
  if (!db) return null;
  try {
    const snapshot = await db.collection("app_config").doc("home").get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() ?? null;
    if (!data) return null;

    // The Next data cache must receive a serialization-safe value. Firestore
    // Timestamp instances, if any are added to this document later, expose a
    // JSON representation and are reduced to plain data here.
    const serialized = JSON.stringify(data);
    const parsed = JSON.parse(serialized) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[home-config] Failed to read app_config/home:", message);
    return null;
  }
}

const cachedHomeConfig = unstable_cache(
  readHomeConfigFromFirestore,
  ["app-home-config-v1"],
  {
    revalidate: HOME_CONFIG_CACHE_SECONDS,
    tags: [HOME_CONFIG_CACHE_TAG],
  },
);

export async function getCachedHomeConfig(): Promise<Record<string, unknown> | null> {
  try {
    return await cachedHomeConfig();
  } catch {
    // Vitest and unusual non-request runtimes do not provide a Next incremental
    // cache. Preserve endpoint availability there without weakening production
    // caching.
    return readHomeConfigFromFirestore();
  }
}
