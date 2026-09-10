import "server-only";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { DiscordCommandError } from "@/lib/discord/command-error";
import { assertHubCapability } from "@/lib/social/server";

const API = "https://discord.com/api/v10";
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const MANAGE_ROLES = 1n << 28n;
const ADMINISTRATOR = 1n << 3n;
// A verification role is for ordinary member access, not staff powers or
// access to private moderation/analytics data. Discord permission bit table:
// https://docs.discord.com/developers/topics/permissions
const PRIVILEGED_ROLE_PERMISSIONS = [
  1, 2, 3, 4, 5, 7, 13, 17, 19, 22, 23, 24, 27, 28, 29, 30, 33, 34, 40, 41, 51, 52,
].reduce((mask, bit) => mask | (1n << BigInt(bit)), 0n);

type DiscordRole = { id: string; position: number; permissions: string; managed?: boolean };
type DiscordChannel = {
  id: string;
  guild_id?: string;
  type: number;
  permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }>;
};
type BotMember = { user: { id: string }; roles: string[] };

export async function validateDiscordSetupDestinations(input: {
  guildId: string;
  verifiedRoleId: string;
  feedChannelId: string;
  reportsChannelId: string;
}): Promise<void> {
  requireSnowflake(input.guildId);
  const channelIds = [...new Set([input.feedChannelId, input.reportsChannelId].filter(Boolean))];
  if (!channelIds.length && !input.verifiedRoleId) return;
  const [roles, member] = await loadBotPermissions(input.guildId);
  if (input.verifiedRoleId) validateRole(input.guildId, input.verifiedRoleId, roles, member);
  for (const channelId of channelIds) {
    const channel = await readGuildChannel(input.guildId, channelId);
    assertCanPost(input.guildId, roles, member, channel);
  }
}

export async function validateDiscordVerificationRole(input: {
  guildId: string;
  verifiedRoleId: string;
}): Promise<void> {
  requireSnowflake(input.guildId);
  const [roles, member] = await loadBotPermissions(input.guildId);
  validateRole(input.guildId, input.verifiedRoleId, roles, member);
}

export async function postDiscordGuildMessage(input: {
  guildId: string;
  hubId: string;
  channelId: string;
  content: string;
  nonce?: string;
  expectedConfigUpdatedAt?: number;
  beforeSend?: () => Promise<void>;
}): Promise<unknown> {
  requireSnowflake(input.guildId);
  requireSnowflake(input.channelId);
  await assertCurrentBinding(input);
  const channel = await readGuildChannel(input.guildId, input.channelId);
  const [roles, member] = await loadBotPermissions(input.guildId);
  assertCanPost(input.guildId, roles, member, channel);
  // Resolve the external channel before preparing any unlisted replay. A
  // stale or foreign destination must never cause a visibility change.
  await assertCurrentBinding(input);
  await input.beforeSend?.();
  await assertCurrentBinding(input);
  return discordRequest(`/channels/${input.channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: input.content.slice(0, 2_000),
      allowed_mentions: { parse: [] },
      ...(input.nonce ? { nonce: input.nonce.slice(0, 25), enforce_nonce: true } : {}),
    }),
  });
}

async function assertCurrentBinding(input: {
  guildId: string;
  hubId: string;
  channelId: string;
  expectedConfigUpdatedAt?: number;
}) {
  const db = getFirestoreAdmin();
  if (!db) throw new DiscordCommandError("Firebase admin is not configured.");
  const [configSnapshot, hubSnapshot, mappings] = await Promise.all([
    db.collection("discordGuildConfigs").doc(input.guildId).get(),
    db.collection("hubs").doc(input.hubId).get(),
    db.collection("discordGuildConfigs").where("hubId", "==", input.hubId).limit(2).get(),
  ]);
  const config = configSnapshot.data();
  const hub = hubSnapshot.data();
  if (!configSnapshot.exists || !hubSnapshot.exists || hub?.lifecycle_state === "deleting" ||
    hub?.role_mode !== "account" ||
    config?.hubId !== input.hubId || config?.reportsChannelId !== input.channelId ||
    (hub?.discordGuildId && hub.discordGuildId !== input.guildId) ||
    mappings.docs.length !== 1 || mappings.docs[0].id !== input.guildId ||
    (input.expectedConfigUpdatedAt !== undefined && Number(config?.updatedAt ?? 0) !== input.expectedConfigUpdatedAt)) {
    throw new DiscordCommandError("The Discord destination changed or is unavailable. Ask a server admin to run /setup again.");
  }
  const configuredBy = String(config.updatedByUid ?? "");
  const allowed = configuredBy && await assertHubCapability(input.hubId, configuredBy, "manage_discord")
    .then(() => true).catch(() => false);
  if (!allowed) {
    throw new DiscordCommandError("The hub admin who configured Discord no longer has access. Ask a current admin to run /setup again.");
  }
}

async function readGuildChannel(guildId: string, channelId: string): Promise<DiscordChannel> {
  requireSnowflake(channelId);
  const channel = await discordRequest(`/channels/${channelId}`) as DiscordChannel;
  if (channel?.id !== channelId || channel.guild_id !== guildId || ![0, 5].includes(channel.type)) {
    throw new DiscordCommandError("Choose a text or announcement channel in this Discord server.");
  }
  return channel;
}

async function loadBotPermissions(guildId: string): Promise<[DiscordRole[], BotMember]> {
  const user = await discordRequest("/users/@me") as { id?: string };
  requireSnowflake(user?.id ?? "");
  const [roles, member] = await Promise.all([
    discordRequest(`/guilds/${guildId}/roles`),
    discordRequest(`/guilds/${guildId}/members/${user.id}`),
  ]);
  if (!Array.isArray(roles) || !member || typeof member !== "object" || !("roles" in member) || !Array.isArray(member.roles)) {
    throw new DiscordCommandError("Could not check the bot's role permissions in this server.");
  }
  return [roles as DiscordRole[], member as BotMember];
}

function validateRole(guildId: string, roleId: string, roles: DiscordRole[], member: BotMember) {
  requireSnowflake(roleId);
  const role = roles.find((candidate) => candidate.id === roleId);
  const permissions = guildPermissions(guildId, roles, member);
  const highest = Math.max(0, ...roles.filter((candidate) => member.roles.includes(candidate.id)).map((candidate) => candidate.position));
  if (!role || role.id === guildId || role.managed || role.position >= highest) {
    throw new DiscordCommandError("Choose a normal role below the bot's highest role. Managed roles and @everyone cannot be used for verification.");
  }
  if (permissionBits(role.permissions) & PRIVILEGED_ROLE_PERMISSIONS) {
    throw new DiscordCommandError("The verification role must not grant administrator or moderation permissions. Choose a basic member role.");
  }
  if (!(permissions & (ADMINISTRATOR | MANAGE_ROLES))) {
    throw new DiscordCommandError("Grant the bot Manage Roles only if you want it to assign a verification role.");
  }
}

function guildPermissions(guildId: string, roles: DiscordRole[], member: BotMember): bigint {
  return roles.filter((role) => role.id === guildId || member.roles.includes(role.id))
    .reduce((permissions, role) => permissions | permissionBits(role.permissions), 0n);
}

function channelPermissions(guildId: string, roles: DiscordRole[], member: BotMember, channel: DiscordChannel): bigint {
  let permissions = guildPermissions(guildId, roles, member);
  if (permissions & ADMINISTRATOR) return permissions;
  const overwrites = channel.permission_overwrites ?? [];
  const everyone = overwrites.find((overwrite) => overwrite.id === guildId && overwrite.type === 0);
  if (everyone) permissions = (permissions & ~permissionBits(everyone.deny)) | permissionBits(everyone.allow);
  const roleOverwrites = overwrites.filter((overwrite) => overwrite.type === 0 && member.roles.includes(overwrite.id));
  const deny = roleOverwrites.reduce((bits, overwrite) => bits | permissionBits(overwrite.deny), 0n);
  const allow = roleOverwrites.reduce((bits, overwrite) => bits | permissionBits(overwrite.allow), 0n);
  permissions = (permissions & ~deny) | allow;
  const personal = overwrites.find((overwrite) => overwrite.type === 1 && overwrite.id === member.user.id);
  if (personal) permissions = (permissions & ~permissionBits(personal.deny)) | permissionBits(personal.allow);
  return permissions;
}

function assertCanPost(guildId: string, roles: DiscordRole[], member: BotMember, channel: DiscordChannel) {
  const permissions = channelPermissions(guildId, roles, member, channel);
  if (!(permissions & ADMINISTRATOR) && (permissions & (VIEW_CHANNEL | SEND_MESSAGES)) !== (VIEW_CHANNEL | SEND_MESSAGES)) {
    throw new DiscordCommandError("RiftLite Results Bot needs View Channel and Send Messages in the selected channel.");
  }
}

function permissionBits(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new DiscordCommandError("Could not check Discord permissions.");
  return BigInt(value);
}

function requireSnowflake(value: string) {
  if (!/^\d{17,20}$/.test(value)) throw new DiscordCommandError("A valid Discord server, channel or role is required.");
}

async function discordRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  // DISCORD_BOT_TOKEN belongs to the separate LFG bot. Never fall back to it.
  const token = process.env.DISCORD_COMMUNITY_BOT_TOKEN?.trim();
  if (!token) throw new DiscordCommandError("The Discord bot is not configured.");
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    if (response.status === 429) throw new DiscordCommandError("Discord is busy. Please retry shortly.");
    throw new DiscordCommandError(`Discord could not access the configured server, role or channel (${response.status}). Check the bot's permissions.`);
  }
  if (response.status === 204) return null;
  return response.json();
}
