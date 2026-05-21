import { type NextRequest } from "next/server";

import { deleteDiscordVoiceChannel } from "@/lib/discord-lfg";
import {
  LFG_IDLE_VOICE_MS,
  LFG_TTL_MS,
  cleanLegendList,
  cleanLongText,
  cleanText,
  lfgFromDoc,
  parseBody,
  requireLinkedProfile,
  socialJson
} from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const includeMine = req.nextUrl.searchParams.get("mine") === "1";
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 60), 1), 100);
  const now = Date.now();

  const snap = await auth.db
    .collection("lfgListings")
    .where("status", "==", "active")
    .limit(Math.max(limit, 100))
    .get();

  const staleVoiceDocs = snap.docs.filter((doc) => {
    const data = doc.data();
    const channelId = String(data.discordVoiceChannelId ?? "");
    const acceptedAt = Number(data.acceptedAt ?? 0);
    const voiceCreatedAt = Number(data.discordVoiceCreatedAt ?? 0);
    return Boolean(channelId) && !acceptedAt && voiceCreatedAt > 0 && voiceCreatedAt + LFG_IDLE_VOICE_MS <= now;
  });
  if (staleVoiceDocs.length) {
    const batch = auth.db.batch();
    for (const doc of staleVoiceDocs) {
      batch.set(doc.ref, {
        discordVoiceChannelId: "",
        discordGuildId: "",
        discordChannelUrl: "",
        discordAppUrl: "",
        discordInviteUrl: "",
        discordVoiceExpiresAt: 0,
        updatedAt: now
      }, { merge: true });
    }
    await batch.commit();
    await Promise.allSettled(staleVoiceDocs.map((doc) => deleteDiscordVoiceChannel(String(doc.data().discordVoiceChannelId ?? ""))));
  }
  const staleVoiceIds = new Set(staleVoiceDocs.map((doc) => doc.id));

  const activeListings = snap.docs
    .map((doc) => {
      const data = doc.data();
      return lfgFromDoc(doc.id, staleVoiceIds.has(doc.id) ? {
        ...data,
        discordVoiceChannelId: "",
        discordGuildId: "",
        discordChannelUrl: "",
        discordAppUrl: "",
        discordInviteUrl: "",
        discordVoiceExpiresAt: 0,
        discordVoiceCreatedAt: 0
      } : data);
    })
    .filter((listing) => listing.status === "active" && listing.expiresAt > now)
    .filter((listing) => includeMine || listing.uid !== auth.decoded.uid)
    .sort((left, right) => right.expiresAt - left.expiresAt)
    .slice(0, limit);

  let ownMatchedListings: ReturnType<typeof lfgFromDoc>[] = [];
  if (includeMine) {
    const matchedSnap = await auth.db
      .collection("lfgListings")
      .where("uid", "==", auth.decoded.uid)
      .where("status", "==", "matched")
      .limit(20)
      .get();
    ownMatchedListings = matchedSnap.docs
      .map((doc) => lfgFromDoc(doc.id, doc.data()))
      .filter((listing) => listing.status === "matched" && listing.expiresAt > now)
      .sort((left, right) => right.acceptedAt - left.acceptedAt);
  }

  return socialJson({ ok: true, listings: [...ownMatchedListings, ...activeListings], now });
}

export async function POST(req: NextRequest) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const body = await parseBody(req);
  const platform = cleanText(body.platform, 20).toLowerCase();
  const format = cleanText(body.format, 8) === "Bo3" ? "Bo3" : "Bo1";
  const roomCode = cleanText(body.roomCode, 80);
  const myLegend = cleanText(body.myLegend, 40);
  const lookingForLegends = cleanLegendList(body.lookingForLegends);
  const allowAny = Boolean(body.allowAny) || lookingForLegends.some((legend) => legend.toLowerCase() === "any");
  const note = cleanLongText(body.note, 500);

  if (platform !== "tcga" && platform !== "atlas") {
    return socialJson({ error: "Choose TCGA or RiftAtlas." }, 400);
  }
  if (!roomCode) {
    return socialJson({ error: "Room code is required." }, 400);
  }
  if (!myLegend) {
    return socialJson({ error: "Your legend is required." }, 400);
  }
  if (!allowAny && !lookingForLegends.length) {
    return socialJson({ error: "Choose at least one desired legend or Any." }, 400);
  }

  const now = Date.now();
  const id = `${auth.decoded.uid}-${now}`;
  const listing = {
    id,
    uid: auth.decoded.uid,
    handle: auth.profile.handle,
    displayName: auth.displayName,
    platform,
    roomCode,
    format,
    myLegend,
    lookingForLegends: lookingForLegends.filter((legend) => legend.toLowerCase() !== "any"),
    allowAny,
    note,
    status: "active",
    acceptedByUid: "",
    acceptedByHandle: "",
    acceptedByDisplayName: "",
    acceptedAt: 0,
    createdAt: now,
    expiresAt: now + LFG_TTL_MS,
    closedAt: 0,
    discordVoiceChannelId: "",
    discordGuildId: "",
    discordChannelUrl: "",
    discordAppUrl: "",
    discordInviteUrl: "",
    discordVoiceExpiresAt: 0,
    discordVoiceCreatedAt: 0
  };

  const batch = auth.db.batch();
  const voiceChannelsToDelete: string[] = [];
  const userActive = await auth.db.collection("lfgListings")
    .where("uid", "==", auth.decoded.uid)
    .where("status", "==", "active")
    .limit(10)
    .get();
  for (const doc of userActive.docs) {
    const channelId = String(doc.data().discordVoiceChannelId ?? "");
    if (channelId) voiceChannelsToDelete.push(channelId);
    batch.set(doc.ref, {
      status: "closed",
      closedAt: now,
      updatedAt: now,
      discordVoiceChannelId: "",
      discordGuildId: "",
      discordChannelUrl: "",
      discordAppUrl: "",
      discordInviteUrl: "",
      discordVoiceExpiresAt: 0,
      discordVoiceCreatedAt: 0
    }, { merge: true });
  }
  batch.set(auth.db.collection("lfgListings").doc(id), listing);
  await batch.commit();
  await Promise.allSettled(voiceChannelsToDelete.map((channelId) => deleteDiscordVoiceChannel(channelId)));

  return socialJson({ ok: true, listing });
}
