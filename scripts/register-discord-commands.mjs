import { existsSync, readFileSync } from "node:fs";
import { commandsForScope } from "./discord-commands.mjs";

const args = process.argv.slice(2);
const unknown = args.find(arg => !["--global", "--apply", "--dry-run"].includes(arg) && !arg.startsWith("--guild="));
if (unknown) throw new Error(`Unknown argument: ${unknown}`);
const scopeArgs = args.filter(arg => arg === "--global" || arg.startsWith("--guild="));
if (scopeArgs.length !== 1) throw new Error("Choose exactly one scope: --global or --guild=<server id>. Add --apply only when ready to register.");
const guildArg = scopeArgs.find(arg => arg.startsWith("--guild="));
const guildId = guildArg?.slice("--guild=".length).trim() || "";
if (guildArg && !/^\d{17,20}$/.test(guildId)) throw new Error("A valid Discord server id is required.");
if (args.includes("--apply") && args.includes("--dry-run")) throw new Error("Choose --apply or --dry-run, not both.");
const commands = commandsForScope({ guild: Boolean(guildId) });
const scope = guildId ? `guild ${guildId}` : "global";
if (!args.includes("--apply")) {
  console.log(JSON.stringify({ mode: "dry-run", scope, commands }, null, 2));
} else {
  // A dry run never needs to load credentials from disk.
  loadEnvFile(".env.local");
  loadEnvFile(".env");
  const appId = process.env.DISCORD_APPLICATION_ID?.trim();
  const botToken = process.env.DISCORD_COMMUNITY_BOT_TOKEN?.trim();
  // Never silently fall back to the separate RiftLite LFG application's credentials.
  if (!appId || !/^\d{17,20}$/.test(appId)) throw new Error("DISCORD_APPLICATION_ID is required.");
  if (!botToken) throw new Error("DISCORD_COMMUNITY_BOT_TOKEN is required.");
  const headers = { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" };
  const identityResponse = await fetch("https://discord.com/api/v10/oauth2/applications/@me", { headers, signal: AbortSignal.timeout(15000) });
  if (!identityResponse.ok) throw new Error(`Discord identity check failed (${identityResponse.status}).`);
  const identity = await identityResponse.json();
  if (identity.id !== appId) throw new Error("The token belongs to a different Discord application. No commands changed.");
  const path = guildId ? `/applications/${appId}/guilds/${guildId}/commands` : `/applications/${appId}/commands`;
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method: "PUT", headers, body: JSON.stringify(commands), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Discord command registration failed (${response.status}).`);
  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length !== commands.length) throw new Error("Discord returned an unexpected registration result; inspect before retrying.");
  console.log(JSON.stringify({ mode: "registered", applicationId: appId, scope, commandNames: payload.map(command => command.name) }));
}

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!key || process.env[key]) continue;
    process.env[key] = rest.join("=").trim().replace(/^["']|["']$/g, "");
  }
}
