import "server-only";

import { unstable_cache } from "next/cache";

import { listMetaStudioReplayCorpus } from "@/lib/replay-v2-server";

export const META_STUDIO_REPLAY_LIBRARY_CACHE_SECONDS = 6 * 60 * 60;

const cachedReplayCorpus = unstable_cache(
  listMetaStudioReplayCorpus,
  ["meta-studio-private-replay-corpus-v1"],
  { revalidate: META_STUDIO_REPLAY_LIBRARY_CACHE_SECONDS },
);

/**
 * The library is private, but its server-side corpus can safely be shared
 * between requests made by the same allowlisted Meta Studio operator. This
 * prevents each player/Legend filter from rescanning Firestore.
 */
export async function readMetaStudioReplayLibrary() {
  try {
    return await cachedReplayCorpus();
  } catch (error) {
    // Vitest and maintenance scripts can execute outside a Next request cache
    // context. Production still uses the persistent Next cache above.
    if (process.env.NODE_ENV === "test") return listMetaStudioReplayCorpus();
    throw error;
  }
}
