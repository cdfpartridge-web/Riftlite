const applicationId = String(process.env.DISCORD_APPLICATION_ID || process.env.DISCORD_CLIENT_ID || "").trim();
const botToken = String(process.env.DISCORD_COMMUNITY_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN || "").trim();
const configuredGuildId = String(process.env.DISCORD_GUILD_ID || "").trim();

if (!applicationId || !botToken) {
  throw new Error("Discord application id and bot token are required.");
}

const headers = { Authorization: `Bot ${botToken}` };
const [botResponse, applicationResponse, guildsResponse, globalCommandsResponse] = await Promise.all([
  fetch("https://discord.com/api/v10/users/@me", { headers }),
  fetch("https://discord.com/api/v10/oauth2/applications/@me", { headers }),
  fetch("https://discord.com/api/v10/users/@me/guilds", { headers }),
  fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, { headers }),
]);

const bot = await readJson(botResponse);
const application = await readJson(applicationResponse);
const guilds = await readJson(guildsResponse);
const globalCommands = await readJson(globalCommandsResponse);
const guildList = Array.isArray(guilds) ? guilds : [];
const configuredGuild = guildList.find((guild) => guild && typeof guild === "object" && guild.id === configuredGuildId);

let configuredGuildCommandsStatus = null;
if (configuredGuildId) {
  const response = await fetch(
    `https://discord.com/api/v10/applications/${applicationId}/guilds/${configuredGuildId}/commands`,
    { headers },
  );
  configuredGuildCommandsStatus = response.status;
}

console.log(JSON.stringify({
  botStatus: botResponse.status,
  botId: stringValue(bot.id),
  botName: stringValue(bot.username),
  applicationStatus: applicationResponse.status,
  tokenApplicationId: stringValue(application.id),
  configuredApplicationId: applicationId,
  applicationMatchesToken: stringValue(application.id) === applicationId,
  guildsStatus: guildsResponse.status,
  guildCount: guildList.length,
  guilds: guildList.map((guild) => ({ id: stringValue(guild?.id), name: stringValue(guild?.name) })),
  configuredGuildId,
  configuredGuildPresent: Boolean(configuredGuild),
  configuredGuildCommandsStatus,
  globalCommandsStatus: globalCommandsResponse.status,
  globalCommandNames: Array.isArray(globalCommands)
    ? globalCommands.map((command) => stringValue(command?.name)).filter(Boolean)
    : [],
}));

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
