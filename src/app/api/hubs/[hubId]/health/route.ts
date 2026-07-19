import { type NextRequest } from "next/server";
import { type Firestore } from "firebase-admin/firestore";

import { getDiscordGuildConfigsForHub } from "@/lib/discord/bot";
import { REPLAY_OWNER_COLLECTION } from "@/lib/replay-v2-server";
import { hubCapabilitiesForRole } from "@/lib/social/hub-permissions";
import {
  assertHubCapability,
  ensureUserProfile,
  identityUidsFor,
  requireUser,
  socialJson,
} from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ hubId: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { hubId } = await params;

  try {
    const role = await assertHubCapability(hubId, auth.decoded.uid, "view");
    const identityUids = await identityUidsFor(auth.decoded.uid);
    const [hubSnap, profile, discordConfigs, replayLists, discordLinkSnaps, shareSnaps] = await Promise.all([
      auth.db.collection("hubs").doc(hubId).get(),
      ensureUserProfile(auth.decoded.uid, auth.decoded.name ?? auth.decoded.email ?? "", auth.decoded.email ?? ""),
      getDiscordGuildConfigsForHub(hubId),
      Promise.all(identityUids.map((uid) => latestReplayRows(auth.db, uid))),
      Promise.all(identityUids.map((uid) => auth.db.collection("discordLinks").where("uid", "==", uid).limit(100).get())),
      Promise.all(identityUids.map((uid) => auth.db.collection("replayDiscordShares")
        .where("hubId", "==", hubId)
        .where("ownerUid", "==", uid)
        .limit(25)
        .get())),
    ]);

    if (!hubSnap.exists) {
      return socialJson({ error: "Hub not found." }, 404);
    }

    const links: Array<Record<string, unknown>> = discordLinkSnaps.flatMap((snapshot) => snapshot.docs.map((document) => ({
      id: document.id,
      ...(document.data() as Record<string, unknown>),
    })));
    const guilds = discordConfigs.map((config) => {
      const link = links.find((candidate) => String(candidate.guildId ?? "") === config.guildId);
      return {
        guildId: config.guildId,
        verifiedRoleId: config.verifiedRoleId,
        feedChannelId: config.feedChannelId,
        reportsChannelId: config.reportsChannelId,
        verifiedRoleConfigured: Boolean(config.verifiedRoleId),
        feedChannelConfigured: Boolean(config.feedChannelId),
        reportsChannelConfigured: Boolean(config.reportsChannelId),
        verifiedForAccount: Boolean(link),
        discordUsername: String(link?.discordUsername ?? ""),
        updatedAt: config.updatedAt,
      };
    });

    const replays = replayLists.flat();
    const uniqueReplays = Array.from(new Map(replays.map((replay) => [replay.replayId, replay])).values());
    uniqueReplays.sort((left, right) => replayTimestamp(String(right.capturedAt ?? right.createdAt ?? "")) - replayTimestamp(String(left.capturedAt ?? left.createdAt ?? "")));
    const latestReplay = uniqueReplays[0] ?? null;

    const identityUidSet = new Set(identityUids);
    const latestDelivery = shareSnaps.flatMap((snapshot) => snapshot.docs)
      .map((document): Record<string, unknown> => ({ id: document.id, ...(document.data() as Record<string, unknown>) }))
      .filter((delivery) => identityUidSet.has(String(delivery.ownerUid ?? "")))
      .sort((left, right) => Number(right.updatedAt ?? right.attemptedAt ?? 0) - Number(left.updatedAt ?? left.attemptedAt ?? 0))[0];

    const hub = hubSnap.data() ?? {};
    return socialJson({
      account: {
        uid: auth.decoded.uid,
        email: profile.email || auth.decoded.email || "",
        handle: profile.handle,
        displayName: profile.displayName,
        profileComplete: profile.profileComplete,
        identityUids,
      },
      hub: {
        id: hubId,
        name: String(hub.name ?? hubId),
        role,
        capabilities: hubCapabilitiesForRole(role),
      },
      discord: {
        configured: guilds.length > 0,
        verified: guilds.some((guild) => guild.verifiedForAccount),
        guilds,
      },
      replay: {
        latest: latestReplay ? {
          replayId: latestReplay.replayId,
          title: latestReplay.title,
          status: latestReplay.status,
          visibility: latestReplay.visibility,
          capturedAt: latestReplay.capturedAt ?? "",
          createdAt: latestReplay.createdAt,
          updatedAt: latestReplay.updatedAt,
          failure: latestReplay.failure,
        } : null,
        latestDiscordDelivery: latestDelivery ? {
          replayId: String(latestDelivery.replayId ?? ""),
          guildId: String(latestDelivery.guildId ?? ""),
          channelId: String(latestDelivery.channelId ?? ""),
          status: String(latestDelivery.status ?? ""),
          attempts: Number(latestDelivery.attempts ?? 0),
          attemptedAt: Number(latestDelivery.attemptedAt ?? 0),
          postedAt: Number(latestDelivery.postedAt ?? 0),
          updatedAt: Number(latestDelivery.updatedAt ?? 0),
          error: String(latestDelivery.error ?? ""),
        } : null,
      },
    });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Could not load hub health." }, 403);
  }
}

function replayTimestamp(value: string | undefined): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function latestReplayRows(db: Firestore, ownerUid: string): Promise<Array<Record<string, unknown>>> {
  const snapshot = await db.collection(REPLAY_OWNER_COLLECTION)
    .doc(ownerUid)
    .collection("items")
    .orderBy("createdAt", "desc")
    .limit(5)
    .get();
  return snapshot.docs.map((document) => {
    const data = document.data() as Record<string, unknown>;
    const failure = data.failure && typeof data.failure === "object" && !Array.isArray(data.failure)
      ? data.failure as Record<string, unknown>
      : null;
    return {
      replayId: String(data.replayId ?? document.id),
      title: String(data.title ?? "RiftLite Atlas replay"),
      status: String(data.status ?? "failed"),
      visibility: String(data.visibility ?? "private"),
      capturedAt: firestoreTimestampIso(data.capturedAt),
      createdAt: firestoreTimestampIso(data.createdAt),
      updatedAt: firestoreTimestampIso(data.updatedAt),
      ...(failure ? { failure: {
        code: String(failure.code ?? ""),
        message: String(failure.message ?? ""),
      } } : {}),
    };
  });
}

function firestoreTimestampIso(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  return "";
}
