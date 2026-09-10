// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type Command = {
  name: string;
  default_member_permissions?: string;
  integration_types?: number[];
  contexts?: number[];
  options?: Array<{ name: string; required?: boolean; channel_types?: number[] }>;
};
type Manifest = {
  discordCommands: Command[];
  commandsForScope: (scope?: { guild?: boolean }) => Command[];
};
type Request = { url: string; method: string; commands?: Command[] };

const projectRoot = path.resolve(import.meta.dirname, "../../..");
const scriptPath = path.join(projectRoot, "scripts/register-discord-commands.mjs");
const manifestPath = path.join(projectRoot, "scripts/discord-commands.mjs");
const manifest = await import(pathToFileURL(manifestPath).href) as Manifest;
const appId = "1524708623790510241";
const guildId = "1524708623790510242";
const otherAppId = "1524708623790510243";
const temporaryDirectories: string[] = [];

// Every subprocess is isolated from real .env files and credentials. Even the
// explicit --apply tests only use this mocked Discord transport. Reject native
// network calls and filesystem writes so a dry-run regression cannot reach out.
const harness = `
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
const forbidden = () => { throw new Error("TEST: unexpected filesystem write or native network request"); };
for (const method of ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "mkdir", "mkdirSync", "rename", "renameSync", "unlink", "unlinkSync", "rm", "rmSync", "createWriteStream"]) {
  if (method in fs) fs[method] = forbidden;
  if (method in fsPromises) fsPromises[method] = forbidden;
}
http.request = http.get = https.request = https.get = forbidden;
net.connect = net.createConnection = tls.connect = forbidden;
syncBuiltinESMExports();
globalThis.fetch = async (url, options = {}) => {
  const request = { url: String(url), method: options.method || "GET" };
  if (options.body) request.commands = JSON.parse(options.body);
  console.error("MOCK_DISCORD_REQUEST:" + JSON.stringify(request));
  if (request.url === "https://discord.com/api/v10/oauth2/applications/@me") {
    return Response.json({ id: process.env.TEST_IDENTITY_ID }, { status: Number(process.env.TEST_IDENTITY_STATUS || "200") });
  }
  if (request.method === "PUT" && /^https:\\/\\/discord\\.com\\/api\\/v10\\/applications\\/\\d+(?:\\/guilds\\/\\d+)?\\/commands$/.test(request.url)) {
    return Response.json(request.commands, { status: Number(process.env.TEST_REGISTRATION_STATUS || "200") });
  }
  throw new Error("TEST: unexpected mocked request");
};
process.argv = [process.execPath, process.argv[1], ...process.argv.slice(2)];
await import(pathToFileURL(process.argv[1]).href);
`;

function runCli(args: string[], options: {
  env?: Record<string, string>;
  files?: Record<string, string>;
} = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "riftlite-discord-cli-test-"));
  temporaryDirectories.push(cwd);
  for (const [name, content] of Object.entries(options.files ?? {})) {
    writeFileSync(path.join(cwd, name), content, "utf8");
  }
  const baseline = Object.fromEntries(readdirSync(cwd).map(name => [name, readFileSync(path.join(cwd, name), "utf8")]));
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", harness, scriptPath, ...args], {
    cwd,
    env: {
      NODE_ENV: "test",
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      TEMP: tmpdir(),
      TMP: tmpdir(),
      TEST_IDENTITY_ID: appId,
      ...options.env,
    },
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  expect(Object.fromEntries(readdirSync(cwd).map(name => [name, readFileSync(path.join(cwd, name), "utf8")]))).toEqual(baseline);
  const requests = result.stderr.split(/\r?\n/)
    .filter(line => line.startsWith("MOCK_DISCORD_REQUEST:"))
    .map(line => JSON.parse(line.slice("MOCK_DISCORD_REQUEST:".length)) as Request);
  return { ...result, requests };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("riftlite-discord-cli-test-")) {
      throw new Error("Refusing to remove an unexpected temporary directory");
    }
    rmSync(resolved, { recursive: true, force: true });
  }
});

describe("Results Bot command manifest", () => {
  it("limits every global command to server installations and guild contexts", () => {
    const commands = manifest.commandsForScope();
    expect(commands.map(command => command.name)).toEqual([
      "help", "status", "disconnect", "verify", "verified", "setup", "recent", "leaderboard", "weekly-report", "testing-goals",
    ]);
    for (const command of commands) {
      expect(command.integration_types).toEqual([0]);
      expect(command.contexts).toEqual([0]);
    }
  });

  it("keeps administrative commands restricted while members can use results commands", () => {
    for (const name of ["setup", "verified", "status", "disconnect"]) {
      expect(manifest.discordCommands.find(command => command.name === name)?.default_member_permissions).toBe("32");
    }
    for (const name of ["verify", "help", "recent", "leaderboard", "weekly-report", "testing-goals"]) {
      expect(manifest.discordCommands.find(command => command.name === name)?.default_member_permissions).toBeUndefined();
    }
  });

  it("omits global-only fields for a guild registration without mutating global definitions", () => {
    const global = manifest.commandsForScope();
    const guild = manifest.commandsForScope({ guild: true });
    expect(guild.map(command => command.name)).toEqual(global.map(command => command.name));
    for (const command of guild) {
      expect(command).not.toHaveProperty("integration_types");
      expect(command).not.toHaveProperty("contexts");
    }
    guild.find(command => command.name === "setup")!.options![0].name = "modified-copy";
    global[0].contexts!.push(1);
    expect(manifest.commandsForScope({ guild: true }).find(command => command.name === "setup")?.options?.[0].name).toBe("hub_id");
    expect(manifest.discordCommands[0].contexts).toEqual([0]);
  });

  it("offers only implemented setup destinations and restricts report channel types", () => {
    const setup = manifest.commandsForScope().find(command => command.name === "setup")!;
    expect(setup.options?.map(option => option.name)).toEqual(["hub_id", "verified_role", "reports_channel"]);
    expect(setup.options?.find(option => option.name === "hub_id")?.required).toBe(true);
    expect(setup.options?.find(option => option.name === "reports_channel")?.channel_types).toEqual([0, 5]);
    expect(JSON.stringify(manifest.commandsForScope())).not.toContain("feed_channel");
  });
});

describe("Results Bot registration CLI", () => {
  it.each([["--global"], ["--global", "--dry-run"], [`--guild=${guildId}`]])("dry-runs %j without credentials, network or writes", (...args) => {
    const result = runCli(args);
    expect(result.status).toBe(0);
    expect(result.requests).toEqual([]);
    const output = JSON.parse(result.stdout);
    expect(output.mode).toBe("dry-run");
    expect(output.commands).toHaveLength(10);
    expect(output.scope).toBe(args.includes("--global") ? "global" : `guild ${guildId}`);
  });

  it("does not register when credentials and an old guild environment value are present without --apply", () => {
    const result = runCli(["--global"], {
      env: { DISCORD_APPLICATION_ID: appId, DISCORD_COMMUNITY_BOT_TOKEN: "synthetic-token", DISCORD_GUILD_ID: guildId },
      files: { ".env.local": "DISCORD_APPLICATION_ID=synthetic-file-value\nDISCORD_COMMUNITY_BOT_TOKEN=synthetic-file-token\n" },
    });
    expect(result.status).toBe(0);
    expect(result.requests).toEqual([]);
    expect(JSON.parse(result.stdout).scope).toBe("global");
    expect(result.stdout).not.toContain("synthetic-");
  });

  it.each([
    [], ["--apply"], ["--global", `--guild=${guildId}`],
    [`--guild=${guildId}`, `--guild=${otherAppId}`], ["--global", "--global"],
    ["--guild="], ["--guild=../commands"], ["--guild=123"],
    ["--global", "--apply", "--dry-run"], ["--global", "--unknown"],
  ])("rejects ambiguous or invalid invocation %j before network access", (...args) => {
    const result = runCli(args, { env: { DISCORD_APPLICATION_ID: appId, DISCORD_COMMUNITY_BOT_TOKEN: "synthetic-token" } });
    expect(result.status).not.toBe(0);
    expect(result.requests).toEqual([]);
  });

  it("does not accept the separate LFG credential aliases", () => {
    const result = runCli(["--global", "--apply"], {
      env: { DISCORD_CLIENT_ID: otherAppId, DISCORD_BOT_TOKEN: "synthetic-lfg-token" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("DISCORD_APPLICATION_ID is required");
    expect(result.requests).toEqual([]);
  });

  it("requires the Results Bot token even when the LFG token is present", () => {
    const result = runCli(["--global", "--apply"], {
      env: { DISCORD_APPLICATION_ID: appId, DISCORD_BOT_TOKEN: "synthetic-lfg-token" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("DISCORD_COMMUNITY_BOT_TOKEN is required");
    expect(result.requests).toEqual([]);
  });

  it("checks token identity and refuses a different application before any command PUT", () => {
    const result = runCli(["--global", "--apply"], {
      env: { DISCORD_APPLICATION_ID: appId, DISCORD_COMMUNITY_BOT_TOKEN: "synthetic-lfg-token", TEST_IDENTITY_ID: otherAppId },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("different Discord application");
    expect(result.requests).toEqual([{ method: "GET", url: "https://discord.com/api/v10/oauth2/applications/@me" }]);
    expect(result.stderr).not.toContain("synthetic-lfg-token");
  });

  it("stops after an unsuccessful identity check", () => {
    const result = runCli(["--global", "--apply"], {
      env: { DISCORD_APPLICATION_ID: appId, DISCORD_COMMUNITY_BOT_TOKEN: "synthetic-token", TEST_IDENTITY_STATUS: "401" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("identity check failed (401)");
    expect(result.requests.map(request => request.method)).toEqual(["GET"]);
  });

  it.each(["--global", `--guild=${guildId}`])("writes only the explicitly selected %s target after successful identity verification", scope => {
    const result = runCli([scope, "--apply"], {
      env: { DISCORD_APPLICATION_ID: appId, DISCORD_COMMUNITY_BOT_TOKEN: "synthetic-token", DISCORD_GUILD_ID: otherAppId },
    });
    expect(result.status).toBe(0);
    expect(result.requests.map(request => request.method)).toEqual(["GET", "PUT"]);
    const request = result.requests[1];
    const guild = scope !== "--global";
    expect(request.url).toBe(`https://discord.com/api/v10/applications/${appId}${guild ? `/guilds/${guildId}` : ""}/commands`);
    expect(request.commands).toEqual(manifest.commandsForScope({ guild }));
    expect(JSON.parse(result.stdout)).toEqual({
      mode: "registered", applicationId: appId, scope: guild ? `guild ${guildId}` : "global",
      commandNames: manifest.discordCommands.map(command => command.name),
    });
  });

  it("reports an unsuccessful write without automatically retrying it", () => {
    const result = runCli(["--global", "--apply"], {
      env: { DISCORD_APPLICATION_ID: appId, DISCORD_COMMUNITY_BOT_TOKEN: "synthetic-token", TEST_REGISTRATION_STATUS: "429" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("registration failed (429)");
    expect(result.requests.map(request => request.method)).toEqual(["GET", "PUT"]);
  });
});
