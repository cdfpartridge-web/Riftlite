import { type NextRequest } from "next/server";

import { deleteDiscordVoiceChannel } from "@/lib/discord-lfg";
import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { LFG_IDLE_VOICE_MS, socialJson } from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return socialJson({ error: "Unauthorized." }, 401);
  }

  const db = getFirestoreAdmin();
  if (!db) return socialJson({ error: "Firebase admin is not configured." }, 500);
  const now = Date.now();
  const snap = await db.collection("lfgListings")
    .where("status", "in", ["active", "matched"])
    .limit(200)
    .get();

  const batch = db.batch();
  const channelIds: string[] = [];
  let closed = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const expiresAt = Number(data.expiresAt ?? 0);
    const voiceExpiresAt = Number(data.discordVoiceExpiresAt ?? 0);
    const acceptedAt = Number(data.acceptedAt ?? 0);
    const voiceCreatedAt = Number(data.discordVoiceCreatedAt ?? 0);
    const shouldClose = expiresAt > 0 && expiresAt <= now;
    const shouldClearVoice = voiceExpiresAt > 0 && voiceExpiresAt <= now;
    const shouldClearIdleVoice = Boolean(data.discordVoiceChannelId) && !acceptedAt && voiceCreatedAt > 0 && voiceCreatedAt + LFG_IDLE_VOICE_MS <= now;
    if (!shouldClose && !shouldClearVoice && !shouldClearIdleVoice) continue;

    const channelId = String(data.discordVoiceChannelId ?? "");
    if (channelId) channelIds.push(channelId);
    batch.set(doc.ref, {
      ...(shouldClose ? { status: "expired", closedAt: now } : {}),
      discordVoiceChannelId: "",
      discordGuildId: "",
      discordChannelUrl: "",
      discordAppUrl: "",
      discordInviteUrl: "",
      discordVoiceExpiresAt: 0,
      discordVoiceCreatedAt: 0,
      updatedAt: now
    }, { merge: true });
    closed += shouldClose ? 1 : 0;
  }

  await batch.commit();
  await Promise.allSettled(channelIds.map((channelId) => deleteDiscordVoiceChannel(channelId)));
  return socialJson({ ok: true, scanned: snap.size, closed, voiceDeleted: channelIds.length });
}
