import { type NextRequest, NextResponse } from "next/server";

import {
  addTestingGoal,
  assertDiscordSetupAllowed,
  buildHubStats,
  completeTestingGoal,
  createDiscordVerificationSession,
  formatLeaderboard,
  formatRecentMatches,
  formatTestingGoals,
  formatWeeklyReport,
  getDiscordGuildConfig,
  getLinkedRiftLiteUid,
  listDiscordVerifiedMembers,
  listTestingGoals,
  loadHubMatches,
  postDiscordChannelMessage,
  saveDiscordGuildConfig,
  verifyDiscordSignature,
} from "@/lib/discord/bot";
import { formatDiscordVerifiedMembers } from "@/lib/discord/verified-members";
import { assertHubCapability } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INTERACTION_PING = 1;
const INTERACTION_APPLICATION_COMMAND = 2;
const RESPONSE_PONG = 1;
const RESPONSE_CHANNEL_MESSAGE = 4;
const EPHEMERAL = 64;

type DiscordCommandOption = {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordCommandOption[];
};

type DiscordInteraction = {
  type?: number;
  guild_id?: string;
  channel_id?: string;
  member?: {
    permissions?: string;
    user?: {
      id?: string;
      username?: string;
      global_name?: string;
    };
  };
  user?: {
    id?: string;
    username?: string;
    global_name?: string;
  };
  data?: {
    name?: string;
    options?: DiscordCommandOption[];
  };
};

export async function POST(req: NextRequest) {
  const timestamp = req.headers.get("x-signature-timestamp") ?? "";
  const signature = req.headers.get("x-signature-ed25519") ?? "";
  const rawBody = await req.text();

  if (!verifyDiscordSignature(rawBody, timestamp, signature)) {
    return new NextResponse("Bad request signature", { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return reply("Discord sent an invalid payload.", true);
  }

  if (interaction.type === INTERACTION_PING) {
    return NextResponse.json({ type: RESPONSE_PONG });
  }
  if (interaction.type !== INTERACTION_APPLICATION_COMMAND) {
    return reply("Unsupported Discord interaction.", true);
  }

  try {
    switch (interaction.data?.name) {
      case "verify":
        return await handleVerify(req, interaction);
      case "verified":
        return await handleVerified(interaction);
      case "setup":
        return await handleSetup(interaction);
      case "recent":
        return await handleRecent(interaction);
      case "leaderboard":
        return await handleLeaderboard(interaction);
      case "weekly-report":
        return await handleWeeklyReport(interaction);
      case "testing-goals":
        return await handleTestingGoals(interaction);
      default:
        return reply("Unknown RiftLite command.", true);
    }
  } catch (error) {
    return reply(error instanceof Error ? error.message : "RiftLite Discord command failed.", true);
  }
}

async function handleVerify(req: NextRequest, interaction: DiscordInteraction) {
  const guildId = requireGuildId(interaction);
  const channelId = String(interaction.channel_id ?? "");
  const user = requireDiscordUser(interaction);
  const session = await createDiscordVerificationSession({
    guildId,
    channelId,
    discordUserId: user.id,
    discordUsername: user.name,
    origin: req.nextUrl.origin,
  });
  return reply([
    "Open this private verification link, sign in with your RiftLite account, then press Verify Discord:",
    session.url,
    "",
    "The link expires in 15 minutes.",
  ].join("\n"), true);
}

async function handleSetup(interaction: DiscordInteraction) {
  const guildId = requireGuildId(interaction);
  const user = requireDiscordUser(interaction);
  const options = interaction.data?.options ?? [];
  const hubId = stringOption(options, "hub_id");
  if (!hubId) throw new Error("hub_id is required. Copy it from the RiftLite private hub admin/details area.");

  const uid = await assertDiscordSetupAllowed({
    guildId,
    discordUserId: user.id,
    hubId,
    memberPermissions: String(interaction.member?.permissions ?? "0"),
  });

  const config = await saveDiscordGuildConfig({
    guildId,
    hubId,
    verifiedRoleId: stringOption(options, "verified_role"),
    feedChannelId: stringOption(options, "feed_channel"),
    reportsChannelId: stringOption(options, "reports_channel"),
    updatedByDiscordUserId: user.id,
    updatedByUid: uid,
  });

  return reply([
    "RiftLite Discord setup saved.",
    `Hub: ${config.hubId}`,
    config.verifiedRoleId ? `Verified role: <@&${config.verifiedRoleId}>` : "Verified role: not configured",
    config.feedChannelId ? `Match feed channel: <#${config.feedChannelId}>` : "Match feed channel: not configured",
    config.reportsChannelId ? `Reports channel: <#${config.reportsChannelId}>` : "Reports channel: not configured",
  ].join("\n"), true);
}

async function handleVerified(interaction: DiscordInteraction) {
  const guildId = requireGuildId(interaction);
  const config = await requireGuildConfig(interaction);
  const user = requireDiscordUser(interaction);
  await assertDiscordSetupAllowed({
    guildId,
    discordUserId: user.id,
    hubId: config.hubId,
    memberPermissions: String(interaction.member?.permissions ?? "0"),
  });
  return reply(formatDiscordVerifiedMembers(await listDiscordVerifiedMembers(guildId)), true);
}

async function handleRecent(interaction: DiscordInteraction) {
  const config = await requireGuildConfig(interaction);
  const count = numberOption(interaction.data?.options ?? [], "count", 5);
  const matches = await loadHubMatches(config.hubId);
  return reply(formatRecentMatches(matches, count), false);
}

async function handleLeaderboard(interaction: DiscordInteraction) {
  const config = await requireGuildConfig(interaction);
  const rangeDays = numberOption(interaction.data?.options ?? [], "range_days", 7);
  const stats = buildHubStats(config.hubId, await loadHubMatches(config.hubId), rangeDays);
  return reply(formatLeaderboard(stats), false);
}

async function handleWeeklyReport(interaction: DiscordInteraction) {
  const config = await requireGuildConfig(interaction);
  const post = booleanOption(interaction.data?.options ?? [], "post", false);
  const stats = buildHubStats(config.hubId, await loadHubMatches(config.hubId), 7);
  const report = formatWeeklyReport(stats);
  if (post && config.reportsChannelId) {
    await postDiscordChannelMessage(config.reportsChannelId, report);
    return reply("Weekly report posted to the configured reports channel.", true);
  }
  return reply(report, false);
}

async function handleTestingGoals(interaction: DiscordInteraction) {
  const guildId = requireGuildId(interaction);
  const config = await requireGuildConfig(interaction);
  const user = requireDiscordUser(interaction);
  const command = subcommand(interaction.data?.options ?? []);
  if (!command.name || command.name === "list") {
    return reply(formatTestingGoals(await listTestingGoals(guildId)), false);
  }

  const uid = await getLinkedRiftLiteUid(guildId, user.id);
  if (!uid) throw new Error("Run /verify first, then try testing-goals again.");
  await assertHubCapability(config.hubId, uid, "manage_testing_goals");

  if (command.name === "add") {
    const goal = await addTestingGoal(guildId, stringOption(command.options, "text"), uid, config.hubId);
    return reply(`Testing goal added: ${goal.text} \`${goal.id.slice(0, 6)}\``, false);
  }
  if (command.name === "complete") {
    const goalId = stringOption(command.options, "id");
    await completeTestingGoal(guildId, goalId, uid, config.hubId);
    return reply(`Testing goal completed: \`${goalId.slice(0, 6)}\``, false);
  }
  return reply("Unknown testing-goals command.", true);
}

async function requireGuildConfig(interaction: DiscordInteraction) {
  const guildId = requireGuildId(interaction);
  const config = await getDiscordGuildConfig(guildId);
  if (!config) throw new Error("This Discord server is not connected to a RiftLite hub yet. Run /verify, then /setup.");
  return config;
}

function requireGuildId(interaction: DiscordInteraction) {
  const guildId = String(interaction.guild_id ?? "");
  if (!guildId) throw new Error("This command must be used inside a Discord server.");
  return guildId;
}

function requireDiscordUser(interaction: DiscordInteraction) {
  const raw = interaction.member?.user ?? interaction.user ?? {};
  const id = String(raw.id ?? "");
  if (!id) throw new Error("Discord user id was not included.");
  return {
    id,
    name: String(raw.global_name ?? raw.username ?? id),
  };
}

function stringOption(options: DiscordCommandOption[], name: string) {
  const value = options.find((option) => option.name === name)?.value;
  return String(value ?? "").trim();
}

function numberOption(options: DiscordCommandOption[], name: string, fallback: number) {
  const value = Number(options.find((option) => option.name === name)?.value ?? fallback);
  return Number.isFinite(value) ? Math.max(1, Math.min(30, Math.round(value))) : fallback;
}

function booleanOption(options: DiscordCommandOption[], name: string, fallback: boolean) {
  const value = options.find((option) => option.name === name)?.value;
  return typeof value === "boolean" ? value : fallback;
}

function subcommand(options: DiscordCommandOption[]) {
  const command = options.find((option) => option.type === 1 || option.type === 2) ?? options[0];
  return {
    name: command?.name ?? "",
    options: command?.options ?? [],
  };
}

function reply(content: string, ephemeral: boolean) {
  const clean = content.trim().slice(0, 1900) || "Done.";
  return NextResponse.json({
    type: RESPONSE_CHANNEL_MESSAGE,
    data: {
      content: clean,
      flags: ephemeral ? EPHEMERAL : undefined,
      allowed_mentions: { parse: [] },
    },
  });
}
