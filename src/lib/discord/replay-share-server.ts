import "server-only";

import { createHash } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { getDiscordGuildConfigsForHub } from "@/lib/discord/bot";
import { postDiscordGuildMessage } from "@/lib/discord/destinations";
import {
  discordReplayReportChannelId,
  formatDiscordReplayPost,
  isDiscordReplayResultResolved,
  summarizeReplayForDiscord,
} from "@/lib/discord/replay-share";
import type { DiscordActiveDeckInput } from "@/lib/discord/replay-share";
import {
  aggregateReplayDiscordConfigResults,
  type ReplayDiscordHubShareStatus,
} from "@/lib/discord/replay-share-status";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";
import { assertHubCapability, identityUidsFor } from "@/lib/social/server";

export type ReplayDiscordHubShareResult = {
  hubId: string;
  status: ReplayDiscordHubShareStatus;
  message?: string;
};

export async function shareReplayToDiscordFeeds(input: {
  ownerUid: string;
  replayId: string;
  replay: CanonicalReplayV2;
  hubIds: string[];
  activeDeck?: DiscordActiveDeckInput;
  origin: string;
  beforeFirstPost?: () => Promise<void>;
}): Promise<ReplayDiscordHubShareResult[]> {
  if (!isDiscordReplayResultResolved(input.replay)) {
    throw new Error("The completed match result is not available yet.");
  }
  const db = getFirestoreAdmin();
  if (!db) throw new Error("Firebase admin is not configured.");
  const identityUids = await identityUidsFor(input.ownerUid);
  const summary = summarizeReplayForDiscord(input.replay, input.activeDeck);
  const replayUrl = `${input.origin.replace(/\/$/, "")}/replays/${encodeURIComponent(input.replayId)}`;
  const content = formatDiscordReplayPost(summary, replayUrl);
  const results: ReplayDiscordHubShareResult[] = [];
  let prepared = false;

  for (const hubId of input.hubIds) {
    const isMember = await Promise.all(identityUids.map((uid) => (
      assertHubCapability(hubId, uid, "view").then(() => true).catch(() => false)
    ))).then((values) => values.some(Boolean));
    if (!isMember) {
      results.push({ hubId, status: "not-member" });
      continue;
    }
    const configuredGuilds = await getDiscordGuildConfigsForHub(hubId);
    // Ambiguous legacy mappings are not permission to fan a private hub out
    // across servers. Setup must resolve them before any delivery resumes.
    const configs = configuredGuilds.map((config) => ({ config, channelId: discordReplayReportChannelId(config) }));
    if (configs.length !== 1 || !configs[0].channelId) {
      results.push({ hubId, status: "not-configured" });
      continue;
    }

    const configResults = await Promise.all(configs.map(async ({ config, channelId }) => {
      const shareKey = createHash("sha256").update(`${input.replayId}\0${hubId}\0${config.guildId}`).digest("hex");
      const shareRef = db.collection("replayDiscordShares").doc(shareKey);
      const hubRef = db.collection("hubs").doc(hubId);
      const configRef = db.collection("discordGuildConfigs").doc(config.guildId);
      const nonce = shareKey.slice(0, 25);
      const claim = await db.runTransaction(async (transaction) => {
        const [hubSnap, snapshot, configSnap] = await Promise.all([
          transaction.get(hubRef),
          transaction.get(shareRef),
          transaction.get(configRef),
        ]);
        if (!hubSnap.exists || String(hubSnap.data()?.lifecycle_state ?? "") === "deleting") {
          return "hub-unavailable" as const;
        }
        const current = configSnap.data();
        if (!configSnap.exists || current?.hubId !== hubId || current.reportsChannelId !== channelId ||
          Number(current.updatedAt ?? 0) !== config.updatedAt ||
          (hubSnap.data()?.discordGuildId && hubSnap.data()?.discordGuildId !== config.guildId)) {
          return "hub-unavailable" as const;
        }
        const data = snapshot.data() ?? {};
        if (data.status === "posted") return "already-shared" as const;
        if (data.status === "posting" && Date.now() - Number(data.attemptedAt ?? 0) < 60_000) {
          return "in-progress" as const;
        }
        transaction.set(shareRef, {
          replayId: input.replayId,
          ownerUid: input.ownerUid,
          hubId,
          guildId: config.guildId,
          channelId,
          status: "posting",
          attempts: FieldValue.increment(1),
          attemptedAt: Date.now(),
          updatedAt: Date.now(),
        }, { merge: true });
        return "post" as const;
      });
      if (claim !== "post") return claim;
      try {
        const response = await postDiscordGuildMessage({
          guildId: config.guildId,
          hubId,
          channelId,
          content,
          nonce,
          expectedConfigUpdatedAt: config.updatedAt,
          beforeSend: async () => {
            const member = await Promise.all(identityUids.map((uid) => (
              assertHubCapability(hubId, uid, "view").then(() => true).catch(() => false)
            ))).then((values) => values.some(Boolean));
            const liveConfigs = await getDiscordGuildConfigsForHub(hubId);
            if (!member || liveConfigs.length !== 1 || liveConfigs[0].guildId !== config.guildId ||
              liveConfigs[0].reportsChannelId !== channelId || liveConfigs[0].updatedAt !== config.updatedAt) {
              throw new Error("Replay sharing permission or the Discord destination changed.");
            }
            if (!prepared) {
              await input.beforeFirstPost?.();
              prepared = true;
            }
          },
        });
        const messageId = response && typeof response === "object" && "id" in response ? String(response.id ?? "") : "";
        await setShareStatusWhileHubActive(db, hubId, shareRef, {
          status: "posted",
          messageId,
          postedAt: Date.now(),
          updatedAt: Date.now(),
          error: FieldValue.delete(),
        });
        return "shared" as const;
      } catch (error) {
        await setShareStatusWhileHubActive(db, hubId, shareRef, {
          status: "failed",
          error: error instanceof Error ? error.message.slice(0, 300) : "Discord post failed.",
          updatedAt: Date.now(),
        });
        return "failed" as const;
      }
    }));

    const status = aggregateReplayDiscordConfigResults(configResults);
    results.push({ hubId, status });
  }
  return results;
}

async function setShareStatusWhileHubActive(
  db: NonNullable<ReturnType<typeof getFirestoreAdmin>>,
  hubId: string,
  shareRef: FirebaseFirestore.DocumentReference,
  data: Record<string, unknown>,
): Promise<void> {
  const hubRef = db.collection("hubs").doc(hubId);
  await db.runTransaction(async (transaction) => {
    const hubSnap = await transaction.get(hubRef);
    if (!hubSnap.exists || String(hubSnap.data()?.lifecycle_state ?? "") === "deleting") return;
    transaction.set(shareRef, data, { merge: true });
  });
}
