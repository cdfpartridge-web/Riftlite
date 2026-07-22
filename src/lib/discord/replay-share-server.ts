import "server-only";

import { createHash } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import {
  getDiscordGuildConfigsForHub,
  postDiscordChannelMessage,
} from "@/lib/discord/bot";
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

  for (const hubId of input.hubIds) {
    const isMember = await Promise.all(identityUids.map((uid) => (
      assertHubCapability(hubId, uid, "view").then(() => true).catch(() => false)
    ))).then((values) => values.some(Boolean));
    if (!isMember) {
      results.push({ hubId, status: "not-member" });
      continue;
    }
    const configs = (await getDiscordGuildConfigsForHub(hubId))
      .map((config) => ({ config, channelId: discordReplayReportChannelId(config) }))
      .filter(({ channelId }) => channelId);
    if (!configs.length) {
      results.push({ hubId, status: "not-configured" });
      continue;
    }

    const configResults = await Promise.all(configs.map(async ({ config, channelId }) => {
      const shareKey = createHash("sha256").update(`${input.replayId}\0${hubId}\0${config.guildId}`).digest("hex");
      const shareRef = db.collection("replayDiscordShares").doc(shareKey);
      const hubRef = db.collection("hubs").doc(hubId);
      const nonce = shareKey.slice(0, 25);
      const claim = await db.runTransaction(async (transaction) => {
        const [hubSnap, snapshot] = await Promise.all([
          transaction.get(hubRef),
          transaction.get(shareRef),
        ]);
        if (!hubSnap.exists || String(hubSnap.data()?.lifecycle_state ?? "") === "deleting") {
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
        const response = await postDiscordChannelMessage(channelId, content, { nonce });
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
