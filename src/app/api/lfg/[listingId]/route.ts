import { type NextRequest } from "next/server";

import { deleteDiscordVoiceChannel } from "@/lib/discord-lfg";
import { lfgFromDoc, requireLinkedProfile, socialJson } from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ listingId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { listingId } = await params;
  const ref = auth.db.collection("lfgListings").doc(listingId);
  const snap = await ref.get();
  if (!snap.exists) return socialJson({ error: "LFG post not found." }, 404);
  const data = snap.data() ?? {};
  const listing = lfgFromDoc(snap.id, data);
  if (listing.uid !== auth.decoded.uid) {
    return socialJson({ error: "You can only close your own LFG posts." }, 403);
  }
  const now = Date.now();
  const channelId = String(data.discordVoiceChannelId ?? "");
  if (channelId) await deleteDiscordVoiceChannel(channelId).catch(() => undefined);
  const patch = {
    status: "closed",
    closedAt: now,
    updatedAt: now,
    discordVoiceChannelId: "",
    discordGuildId: "",
    discordChannelUrl: "",
    discordAppUrl: "",
    discordInviteUrl: "",
    discordVoiceExpiresAt: 0
  };
  await ref.set(patch, { merge: true });
  return socialJson({ ok: true, listing: { ...listing, ...patch } });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ listingId: string }> }) {
  return PATCH(req, context);
}
