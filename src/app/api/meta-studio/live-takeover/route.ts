import { revalidatePath, revalidateTag } from "next/cache";
import { type NextRequest } from "next/server";

import {
  metaStudioJson,
  requireMetaStudioSession,
} from "@/lib/community/meta-studio-auth";
import { HOME_CONFIG_CACHE_TAG } from "@/lib/home-config";
import {
  liveTakeoverStorageFromConfig,
  normalizeLiveTakeoverConfig,
  normalizeTwitchChannelLogin,
  publicLiveTakeoverFromStatus,
} from "@/lib/live-takeover";
import {
  getStreamStatus,
  TWITCH_STATUS_CACHE_TAG,
} from "@/lib/twitch/status";
import type { StreamStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOME_CONFIG_COLLECTION = "app_config";
const HOME_CONFIG_DOCUMENT = "home";

function configCandidate(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const payload = body as Record<string, unknown>;
  const candidate = payload.config ?? payload.liveTakeover;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null;
}

function invalidConfigMessage(candidate: Record<string, unknown>): string {
  if (candidate.provider !== undefined && candidate.provider !== "twitch") {
    return "Twitch is the only supported live takeover provider right now.";
  }
  if (candidate.channelLogin !== undefined
    && !normalizeTwitchChannelLogin(candidate.channelLogin)) {
    return "Enter a valid Twitch channel login using letters, numbers, or underscores.";
  }
  return "";
}

async function streamStatusForConfig(
  config: ReturnType<typeof normalizeLiveTakeoverConfig>,
): Promise<StreamStatus> {
  if (config.enabled) return getStreamStatus(config.channelLogin);
  return {
    state: "unavailable",
    isLive: false,
    tooltip: "Live takeover disabled",
    channelLogin: config.channelLogin,
    channelUrl: `https://www.twitch.tv/${config.channelLogin}`,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireMetaStudioSession(request);
  if ("error" in auth) return auth.error;

  try {
    const snapshot = await auth.db
      .collection(HOME_CONFIG_COLLECTION)
      .doc(HOME_CONFIG_DOCUMENT)
      .get();
    const data = snapshot.exists ? snapshot.data() ?? {} : {};
    const config = normalizeLiveTakeoverConfig(data.liveTakeover);
    const streamStatus = await streamStatusForConfig(config);
    const updatedAt = Number(data.liveTakeoverUpdatedAt ?? 0);
    return metaStudioJson({
      ok: true,
      config,
      liveTakeover: publicLiveTakeoverFromStatus(config, streamStatus, updatedAt),
      streamStatus,
      updatedAt,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Live takeover settings could not be loaded.";
    console.error("[meta-studio/live-takeover] Read failed:", message);
    return metaStudioJson({ error: message }, 500);
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireMetaStudioSession(request);
  if ("error" in auth) return auth.error;
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return metaStudioJson({ error: "Live takeover changes must come from Meta Studio." }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return metaStudioJson({ error: "A valid JSON request body is required." }, 400);
  }
  const candidate = configCandidate(body);
  if (!candidate) {
    return metaStudioJson({ error: "Live takeover settings are required." }, 400);
  }
  const invalidMessage = invalidConfigMessage(candidate);
  if (invalidMessage) {
    return metaStudioJson({ error: invalidMessage }, 400);
  }

  const config = liveTakeoverStorageFromConfig(candidate);
  const updatedAt = Date.now();
  try {
    await auth.db
      .collection(HOME_CONFIG_COLLECTION)
      .doc(HOME_CONFIG_DOCUMENT)
      .set({
        liveTakeover: config,
        liveTakeoverUpdatedAt: updatedAt,
        liveTakeoverUpdatedBy: auth.uid,
      }, { merge: true });

    revalidateTag(TWITCH_STATUS_CACHE_TAG, "max");
    revalidateTag(HOME_CONFIG_CACHE_TAG, "max");
    revalidatePath("/api/app/home");
    revalidatePath("/api/app/live-takeover");

    const streamStatus = await streamStatusForConfig(config);
    const liveTakeover = publicLiveTakeoverFromStatus(
      config,
      streamStatus,
      updatedAt,
    );
    const message = !config.enabled
      ? "Live takeover ended. Desktop Home will return to the video carousel."
      : liveTakeover.active
        ? "Live takeover is on and Twitch confirms the channel is live."
        : "Live takeover is armed. Desktop Home will switch when Twitch reports the channel live.";

    return metaStudioJson({
      ok: true,
      config,
      liveTakeover,
      streamStatus,
      updatedAt,
      message,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Live takeover settings could not be saved.";
    console.error("[meta-studio/live-takeover] Save failed:", message);
    return metaStudioJson({ error: message }, 500);
  }
}
