import { existsSync, readFileSync } from "node:fs";

loadEnvFile(".env.local");
loadEnvFile(".env");

const appId = process.env.DISCORD_APPLICATION_ID || process.env.DISCORD_CLIENT_ID;
const botToken = process.env.DISCORD_COMMUNITY_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!appId) {
  throw new Error("DISCORD_APPLICATION_ID is required.");
}
if (!botToken) {
  throw new Error("DISCORD_COMMUNITY_BOT_TOKEN is required.");
}

const commands = [
  {
    name: "verify",
    description: "Link your Discord account to your RiftLite profile.",
  },
  {
    name: "verified",
    description: "List Discord members linked to RiftLite in this server.",
    default_member_permissions: "32",
  },
  {
    name: "setup",
    description: "Connect this Discord server to a RiftLite private hub.",
    default_member_permissions: "32",
    options: [
      {
        name: "hub_id",
        description: "RiftLite private hub id.",
        type: 3,
        required: true,
      },
      {
        name: "verified_role",
        description: "Role to assign after RiftLite verification.",
        type: 8,
        required: false,
      },
      {
        name: "feed_channel",
        description: "Channel reserved for the RiftLite match feed.",
        type: 7,
        required: false,
        channel_types: [0, 5],
      },
      {
        name: "reports_channel",
        description: "Channel for reports and opted-in replay links.",
        type: 7,
        required: false,
        channel_types: [0, 5],
      },
    ],
  },
  {
    name: "recent",
    description: "Show recent matches from the connected RiftLite hub.",
    options: [
      {
        name: "count",
        description: "Number of matches to show.",
        type: 4,
        required: false,
        min_value: 1,
        max_value: 10,
      },
    ],
  },
  {
    name: "leaderboard",
    description: "Show the RiftLite testing contribution leaderboard.",
    options: [
      {
        name: "range_days",
        description: "Stats window in days.",
        type: 4,
        required: false,
        min_value: 1,
        max_value: 30,
      },
    ],
  },
  {
    name: "weekly-report",
    description: "Show or post a RiftLite weekly testing report.",
    options: [
      {
        name: "post",
        description: "Post to the configured reports channel instead of this channel.",
        type: 5,
        required: false,
      },
    ],
  },
  {
    name: "testing-goals",
    description: "Manage RiftLite hub testing goals.",
    options: [
      {
        name: "list",
        description: "List active testing goals.",
        type: 1,
      },
      {
        name: "add",
        description: "Add a testing goal.",
        type: 1,
        options: [
          {
            name: "text",
            description: "Goal text.",
            type: 3,
            required: true,
            max_length: 240,
          },
        ],
      },
      {
        name: "complete",
        description: "Mark a testing goal complete.",
        type: 1,
        options: [
          {
            name: "id",
            description: "Goal id shown by /testing-goals list.",
            type: 3,
            required: true,
          },
        ],
      },
    ],
  },
];

const path = guildId
  ? `/applications/${appId}/guilds/${guildId}/commands`
  : `/applications/${appId}/commands`;

const response = await fetch(`https://discord.com/api/v10${path}`, {
  method: "PUT",
  headers: {
    "Authorization": `Bot ${botToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

if (!response.ok) {
  const text = await response.text();
  throw new Error(`Discord command registration failed ${response.status}: ${text}`);
}

const payload = await response.json();
console.log(`Registered ${payload.length} Discord commands ${guildId ? `for guild ${guildId}` : "globally"}.`);

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!key || process.env[key]) continue;
    const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
    process.env[key] = value;
  }
}
