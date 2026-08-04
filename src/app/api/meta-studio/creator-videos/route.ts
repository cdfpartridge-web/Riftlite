import { revalidatePath, revalidateTag } from "next/cache";
import { type NextRequest } from "next/server";

import {
  metaStudioJson,
  requireMetaStudioSession,
} from "@/lib/community/meta-studio-auth";
import {
  CREATOR_VIDEO_FEED_CACHE_TAG,
  communitySpotlightVideoProfilesFromConfig,
  creatorVideoCarouselStorageFromConfig,
  normalizeCreatorVideoCarouselConfig,
} from "@/lib/youtube/creator-video-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOME_CONFIG_COLLECTION = "app_config";
const HOME_CONFIG_DOCUMENT = "home";

export async function GET(request: NextRequest) {
  const auth = await requireMetaStudioSession(request);
  if ("error" in auth) return auth.error;

  try {
    const snapshot = await auth.db
      .collection(HOME_CONFIG_COLLECTION)
      .doc(HOME_CONFIG_DOCUMENT)
      .get();
    const data = snapshot.exists ? snapshot.data() ?? {} : {};
    return metaStudioJson({
      ok: true,
      config: normalizeCreatorVideoCarouselConfig(
        data.creatorVideoCarousel,
        data.communitySpotlights,
      ),
      updatedAt: Number(data.creatorVideoCarouselUpdatedAt ?? 0),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Creator video carousel settings could not be loaded.";
    console.error("[meta-studio/creator-videos] Read failed:", message);
    return metaStudioJson({ error: message }, 500);
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireMetaStudioSession(request);
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return metaStudioJson({ error: "A valid JSON request body is required." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return metaStudioJson({ error: "Creator video carousel settings are required." }, 400);
  }
  const payload = body as Record<string, unknown>;
  const candidate = payload.config ?? payload.creatorVideoCarousel;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return metaStudioJson({ error: "Creator video carousel settings are required." }, 400);
  }

  const candidateConfig = normalizeCreatorVideoCarouselConfig(candidate);
  const communitySpotlights = communitySpotlightVideoProfilesFromConfig(candidateConfig);
  const config = normalizeCreatorVideoCarouselConfig(candidate, communitySpotlights);
  const storedCarousel = creatorVideoCarouselStorageFromConfig(config);
  const updatedAt = Date.now();
  try {
    await auth.db
      .collection(HOME_CONFIG_COLLECTION)
      .doc(HOME_CONFIG_DOCUMENT)
      .set({
        communitySpotlights,
        creatorVideoCarousel: storedCarousel,
        creatorVideoCarouselUpdatedAt: updatedAt,
        creatorVideoCarouselUpdatedBy: auth.uid,
      }, { merge: true });

    revalidateTag(CREATOR_VIDEO_FEED_CACHE_TAG, "max");
    revalidatePath("/api/app/home");

    return metaStudioJson({
      ok: true,
      config,
      updatedAt,
      message: "Creator video carousel settings saved and desktop Home refreshed.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Creator video carousel settings could not be saved.";
    console.error("[meta-studio/creator-videos] Save failed:", message);
    return metaStudioJson({ error: message }, 500);
  }
}
