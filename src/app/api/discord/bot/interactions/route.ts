import { after, type NextRequest, NextResponse } from "next/server";

import {
  addTestingGoal,
  assertDiscordHubCapability,
  assertDiscordSetupAllowed,
  buildHubStats,
  completeTestingGoal,
  createDiscordVerificationSession,
  disconnectDiscordGuild,
  formatLeaderboard,
  formatRecentMatches,
  formatTestingGoals,
  formatWeeklyReport,
  getDiscordGuildConfig,
  getDiscordApplicationId,
  getLinkedRiftLiteUid,
  listDiscordVerifiedMembers,
  listTestingGoals,
  loadHubMatches,
  hasManageGuild,
  saveDiscordGuildConfig,
  verifyDiscordSignature,
} from "@/lib/discord/bot";
import { formatDiscordVerifiedMembers } from "@/lib/discord/verified-members";
import { DiscordCommandError } from "@/lib/discord/command-error";
import { postDiscordGuildMessage } from "@/lib/discord/destinations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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
  id?: string;
  application_id?: string;
  token?: string;
  context?: number;
  authorizing_integration_owners?: Record<string, string>;
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

  if (!interaction || typeof interaction !== "object" || Array.isArray(interaction)) {
    return reply("Discord sent an invalid payload.", true);
  }
  const applicationId = getDiscordApplicationId();
  // Endpoint verification pings can be minimal. Their Ed25519 signature
  // authenticates the application; reject an explicit conflicting id.
  if (interaction.type === INTERACTION_PING) {
    if (interaction.application_id && interaction.application_id !== applicationId) {
      return new NextResponse("Incorrect application", { status: 401 });
    }
    return NextResponse.json({ type: RESPONSE_PONG });
  }
  if (!applicationId || interaction.application_id !== applicationId) {
    return new NextResponse("Incorrect application", { status: 401 });
  }
  if (interaction.type !== INTERACTION_APPLICATION_COMMAND) {
    return reply("Unsupported Discord interaction.", true);
  }

  if (!interaction.guild_id || !interaction.member?.user?.id
    || (interaction.context !== undefined && interaction.context !== 0)
    || (interaction.authorizing_integration_owners
      && interaction.authorizing_integration_owners["0"] !== interaction.guild_id)) {
    return reply("Install RiftLite Results Bot in a Discord server and run this command there.", true);
  }
  if (!interaction.token || !/^\d{5,30}$/.test(interaction.id ?? "")) {
    return reply("Discord sent an incomplete command. Please try again.", true);
  }

  // Discord needs an initial response within three seconds. All database and
  // REST work runs after the private acknowledgement, with the final result
  // editing this same private response rather than posting another message.
  after(async () => {
    const response = await executeCommand(req, interaction);
    const payload = await response.json() as { data: Record<string, unknown> };
    try {
      const edited = await fetch(`https://discord.com/api/v10/webhooks/${encodeURIComponent(interaction.application_id!)}/${encodeURIComponent(interaction.token!)}/messages/@original`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Ephemeral visibility is fixed by the initial acknowledgement. The
        // webhook edit endpoint does not accept EPHEMERAL in its flags field.
        body: JSON.stringify({ content: payload.data.content, allowed_mentions: { parse: [] } }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!edited.ok) console.error("Discord command response could not be delivered", edited.status);
    } catch {
      console.error("Discord command response could not be delivered");
    }
  });
  return NextResponse.json({ type: 5, data: { flags: EPHEMERAL } });
}

async function executeCommand(req: NextRequest, interaction: DiscordInteraction) {
  try {
    switch (interaction.data?.name) {
      case "help":
        return reply([
          "**RiftLite Results Bot**",
          "Admins: create a private RiftLite hub, run /verify here, then /setup with its hub id. You need Manage Server and hub owner/admin access.",
          "Players: join that private hub with your RiftLite account and run /verify in this server.",
          "Use /recent, /leaderboard, /weekly-report and /testing-goals list for this hub. Results are private to you. Admins can explicitly post /weekly-report post:true to the configured channel.",
          "Replay posts are optional: enable Discord replay sharing in RiftLite and select this hub. Existing replays are not backfilled automatically.",
          "Admins can check /status or stop future sharing with /disconnect. Previously posted messages remain in Discord.",
        ].join("\n\n"), true);
      case "status":
        return await handleStatus(interaction);
      case "disconnect":
        return await handleDisconnect(interaction);
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
    return reply(error instanceof DiscordCommandError ? error.message
      : "RiftLite could not complete this command. Try again shortly; if it keeps failing, ask a server admin to check /status.", true);
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
  if (!hubId) throw new DiscordCommandError("hub_id is required. Copy it from the RiftLite private hub admin/details area.");

  const uid = await assertDiscordSetupAllowed({
    guildId,
    discordUserId: user.id,
    hubId,
    memberPermissions: String(interaction.member?.permissions ?? "0"),
  });

  const previous = await getDiscordGuildConfig(guildId);
  const preservedOption = (name: string, current = "") => options.some((option) => option.name === name)
    ? stringOption(options, name) : previous?.hubId === hubId ? current : "";
  const config = await saveDiscordGuildConfig({
    guildId,
    hubId,
    verifiedRoleId: preservedOption("verified_role", previous?.verifiedRoleId),
    feedChannelId: preservedOption("feed_channel", previous?.feedChannelId),
    reportsChannelId: preservedOption("reports_channel", previous?.reportsChannelId),
    updatedByDiscordUserId: user.id,
    updatedByUid: uid,
  });

  return reply([
    "RiftLite Discord setup saved.",
    `Hub: ${config.hubId}`,
    config.verifiedRoleId ? `Verified role: <@&${config.verifiedRoleId}>` : "Verified role: not configured",
    config.reportsChannelId ? `Reports channel: <#${config.reportsChannelId}>` : "Reports channel: not configured",
    "Players must verify here and be current private hub members to read results. One private hub can connect to one Discord server.",
  ].join("\n"), true);
}

async function handleStatus(interaction: DiscordInteraction) {
  await requireVerifiedServerManager(interaction);
  const config = await requireGuildConfig(interaction);
  await assertDiscordSetupAllowed({ guildId: config.guildId, discordUserId: requireDiscordUser(interaction).id,
    hubId: config.hubId, memberPermissions: String(interaction.member?.permissions ?? "0") });
  return reply([
    "**RiftLite Results Bot — connected**", `Private hub: ${config.hubId}`,
    config.reportsChannelId ? `Reports and opted-in replays: <#${config.reportsChannelId}>` : "Reports channel: not configured",
    config.verifiedRoleId ? `Verification role: <@&${config.verifiedRoleId}>` : "Verification role: not configured",
    "Private commands require current hub membership. Use /setup to validate or update channels and roles; /disconnect stops future delivery.",
  ].join("\n"), true);
}

async function handleDisconnect(interaction: DiscordInteraction) {
  await requireVerifiedServerManager(interaction);
  await disconnectDiscordGuild(requireGuildId(interaction));
  return reply("This server is disconnected from RiftLite. Future result access and replay posts are stopped. Hub results, goal history and messages already posted to Discord are preserved.", true);
}

async function requireVerifiedServerManager(interaction: DiscordInteraction) {
  if (!hasManageGuild(String(interaction.member?.permissions ?? "0"))) {
    throw new DiscordCommandError("Discord Manage Server permission is required for this action.");
  }
  const uid = await getLinkedRiftLiteUid(requireGuildId(interaction), requireDiscordUser(interaction).id);
  if (!uid) throw new DiscordCommandError("Run /verify in this Discord server first, then try again.");
  return uid;
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
  const config = await requireMemberConfig(interaction);
  const count = numberOption(interaction.data?.options ?? [], "count", 5);
  const matches = await loadHubMatches(config.hubId);
  return reply(formatRecentMatches(matches, count), true);
}

async function handleLeaderboard(interaction: DiscordInteraction) {
  const config = await requireMemberConfig(interaction);
  const rangeDays = numberOption(interaction.data?.options ?? [], "range_days", 7);
  const stats = buildHubStats(config.hubId, await loadHubMatches(config.hubId), rangeDays);
  return reply(formatLeaderboard(stats), true);
}

async function handleWeeklyReport(interaction: DiscordInteraction) {
  const config = await requireMemberConfig(interaction);
  const post = booleanOption(interaction.data?.options ?? [], "post", false);
  if (post) {
    await assertDiscordSetupAllowed({ guildId: config.guildId, discordUserId: requireDiscordUser(interaction).id,
      hubId: config.hubId, memberPermissions: String(interaction.member?.permissions ?? "0") });
    if (!config.reportsChannelId) throw new DiscordCommandError("Choose a reports_channel with /setup before posting a weekly report.");
  }
  const stats = buildHubStats(config.hubId, await loadHubMatches(config.hubId), 7);
  const report = formatWeeklyReport(stats);
  if (post && config.reportsChannelId) {
    await postDiscordGuildMessage({ guildId: config.guildId, hubId: config.hubId, channelId: config.reportsChannelId,
      content: report, nonce: interaction.id, expectedConfigUpdatedAt: config.updatedAt });
    return reply("Weekly report posted to the configured reports channel.", true);
  }
  return reply(report, true);
}

async function handleTestingGoals(interaction: DiscordInteraction) {
  const guildId = requireGuildId(interaction);
  const config = await requireMemberConfig(interaction);
  const user = requireDiscordUser(interaction);
  const command = subcommand(interaction.data?.options ?? []);
  if (!command.name || command.name === "list") {
    return reply(formatTestingGoals(await listTestingGoals(guildId, config.hubId)), true);
  }

  const uid = await getLinkedRiftLiteUid(guildId, user.id);
  await assertDiscordHubCapability(config.hubId, uid, "manage_testing_goals");

  if (command.name === "add") {
    const goal = await addTestingGoal(guildId, stringOption(command.options, "text"), uid, config.hubId);
    return reply(`Testing goal added: ${goal.text} \`${goal.id}\``, true);
  }
  if (command.name === "complete") {
    const goalId = stringOption(command.options, "id");
    await completeTestingGoal(guildId, goalId, uid, config.hubId);
    return reply(`Testing goal completed: \`${goalId}\``, true);
  }
  return reply("Unknown testing-goals command.", true);
}

async function requireGuildConfig(interaction: DiscordInteraction) {
  const guildId = requireGuildId(interaction);
  const config = await getDiscordGuildConfig(guildId);
  if (!config) throw new DiscordCommandError("This Discord server has no active private hub connection. A verified hub admin with Manage Server should run /setup. If the hub is connected elsewhere, use a separate hub or disconnect the old server first.");
  return config;
}

async function requireMemberConfig(interaction: DiscordInteraction) {
  const config = await requireGuildConfig(interaction);
  const uid = await getLinkedRiftLiteUid(config.guildId, requireDiscordUser(interaction).id);
  await assertDiscordHubCapability(config.hubId, uid, "view");
  return config;
}

function requireGuildId(interaction: DiscordInteraction) {
  const guildId = String(interaction.guild_id ?? "");
  if (!guildId) throw new DiscordCommandError("This command must be used inside a Discord server.");
  return guildId;
}

function requireDiscordUser(interaction: DiscordInteraction) {
  const raw = interaction.member?.user ?? interaction.user ?? {};
  const id = String(raw.id ?? "");
  if (!id) throw new DiscordCommandError("Discord user id was not included.");
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
