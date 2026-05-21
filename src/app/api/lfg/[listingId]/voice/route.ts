import { type NextRequest } from "next/server";

import { createDiscordLfgVoiceChannel, deleteDiscordVoiceChannel } from "@/lib/discord-lfg";
import { lfgFromDoc, requireLinkedProfile, socialJson } from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ listingId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;

  const { listingId } = await params;
  const ref = auth.db.collection("lfgListings").doc(listingId);
  const snap = await ref.get();
  if (!snap.exists) return socialJson({ error: "LFG post not found." }, 404);

  const data = snap.data() ?? {};
  const listing = lfgFromDoc(snap.id, data);
  const now = Date.now();
  if (listing.uid !== auth.decoded.uid) {
    return socialJson({ error: "Only the listing owner can create Discord voice." }, 403);
  }
  if (listing.status !== "active" || listing.expiresAt <= now) {
    return socialJson({ error: "This LFG post is no longer active." }, 409);
  }
  if (listing.discordInviteUrl && listing.discordVoiceExpiresAt > now) {
    return socialJson({ ok: true, listing });
  }

  const oldChannelId = String(data.discordVoiceChannelId ?? "");
  if (oldChannelId) await deleteDiscordVoiceChannel(oldChannelId).catch(() => undefined);

  try {
    const voice = await createDiscordLfgVoiceChannel({
      listingId,
      displayName: listing.displayName,
      handle: listing.handle,
      myLegend: listing.myLegend,
      platform: listing.platform,
      format: listing.format,
      expiresAt: listing.expiresAt
    });

    const patch = {
      discordVoiceChannelId: voice.channelId,
      discordGuildId: voice.guildId,
      discordChannelUrl: voice.channelUrl,
      discordAppUrl: voice.appUrl,
      discordInviteUrl: voice.inviteUrl,
      discordVoiceExpiresAt: voice.expiresAt,
      updatedAt: now
    };
    await ref.set(patch, { merge: true });
    return socialJson({ ok: true, listing: lfgFromDoc(listingId, { ...data, ...patch }) });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Discord voice unavailable." }, 502);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ listingId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;

  const { listingId } = await params;
  const ref = auth.db.collection("lfgListings").doc(listingId);
  const snap = await ref.get();
  if (!snap.exists) return socialJson({ error: "LFG post not found." }, 404);

  const data = snap.data() ?? {};
  const listing = lfgFromDoc(snap.id, data);
  if (listing.uid !== auth.decoded.uid) {
    return socialJson({ error: "Only the listing owner can remove Discord voice." }, 403);
  }

  const channelId = String(data.discordVoiceChannelId ?? "");
  if (channelId) await deleteDiscordVoiceChannel(channelId).catch(() => undefined);
  const patch = {
    discordVoiceChannelId: "",
    discordGuildId: "",
    discordChannelUrl: "",
    discordAppUrl: "",
    discordInviteUrl: "",
    discordVoiceExpiresAt: 0,
    updatedAt: Date.now()
  };
  await ref.set(patch, { merge: true });
  return socialJson({ ok: true, listing: lfgFromDoc(listingId, { ...data, ...patch }) });
}
