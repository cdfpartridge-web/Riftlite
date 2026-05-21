import "server-only";

const DISCORD_API_BASE = "https://discord.com/api/v10";

type DiscordConfig = {
  token: string;
  guildId: string;
  categoryId: string;
};

type CreateVoiceInput = {
  listingId: string;
  displayName: string;
  handle: string;
  myLegend: string;
  platform: string;
  format: string;
  expiresAt: number;
};

type DiscordChannel = {
  id: string;
};

type DiscordInvite = {
  code: string;
};

function getDiscordConfig(): DiscordConfig {
  const token = process.env.DISCORD_BOT_TOKEN?.trim() ?? "";
  const guildId = process.env.DISCORD_GUILD_ID?.trim() ?? "";
  const categoryId = process.env.DISCORD_LFG_CATEGORY_ID?.trim() ?? "";

  if (!token || !guildId || !categoryId) {
    throw new Error("Discord voice is not configured yet.");
  }

  return { token, guildId, categoryId };
}

function discordHeaders(token: string) {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json"
  };
}

function safeChannelName(input: CreateVoiceInput): string {
  const owner = input.handle || input.displayName || "player";
  const raw = `rl-${input.format}-${input.platform}-${input.myLegend}-${owner}`;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
  return cleaned || `riftlite-lfg-${input.listingId.slice(0, 8)}`;
}

async function discordRequest<T>(config: DiscordConfig, path: string, init: RequestInit, okStatuses = [200, 201, 204]) {
  const headers = new Headers(discordHeaders(config.token));
  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  const response = await fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers
  });

  if (!okStatuses.includes(response.status)) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord API ${response.status}: ${text.slice(0, 240)}`);
  }

  if (response.status === 204) return null as T;
  return await response.json() as T;
}

function isInvalidParentCategoryError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.message.includes("CHANNEL_PARENT_INVALID_TYPE") || error.message.includes("Not a category");
}

async function createVoiceChannel(config: DiscordConfig, input: CreateVoiceInput, withCategory: boolean) {
  return await discordRequest<DiscordChannel>(config, `/guilds/${config.guildId}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name: safeChannelName(input),
      type: 2,
      ...(withCategory ? { parent_id: config.categoryId } : {}),
      user_limit: input.format === "Bo3" ? 4 : 2
    })
  });
}

export async function createDiscordLfgVoiceChannel(input: CreateVoiceInput) {
  const config = getDiscordConfig();
  const inviteTtlSeconds = Math.max(60, Math.ceil((input.expiresAt - Date.now()) / 1000));

  let channel: DiscordChannel;
  try {
    channel = await createVoiceChannel(config, input, true);
  } catch (error) {
    if (!isInvalidParentCategoryError(error)) throw error;
    channel = await createVoiceChannel(config, input, false);
  }

  try {
    const invite = await discordRequest<DiscordInvite>(config, `/channels/${channel.id}/invites`, {
      method: "POST",
      body: JSON.stringify({
        max_age: inviteTtlSeconds,
        max_uses: 0,
        temporary: false,
        unique: true
      })
    });

    return {
      channelId: channel.id,
      guildId: config.guildId,
      channelUrl: `https://discord.com/channels/${config.guildId}/${channel.id}`,
      appUrl: `discord://discord.com/channels/${config.guildId}/${channel.id}`,
      inviteUrl: `https://discord.gg/${invite.code}`,
      expiresAt: Date.now() + inviteTtlSeconds * 1000
    };
  } catch (error) {
    await deleteDiscordVoiceChannel(channel.id).catch(() => undefined);
    throw error;
  }
}

export async function deleteDiscordVoiceChannel(channelId: string) {
  const id = channelId.trim();
  if (!id) return;

  const config = getDiscordConfig();
  try {
    await discordRequest(config, `/channels/${encodeURIComponent(id)}`, { method: "DELETE" }, [200, 204]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Discord API 404")) return;
    throw error;
  }
}
