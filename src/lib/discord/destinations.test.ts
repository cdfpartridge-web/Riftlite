import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, capabilityMock } = vi.hoisted(() => ({ dbMock: vi.fn(), capabilityMock: vi.fn() }));
vi.mock("@/lib/firebase/admin", () => ({ getFirestoreAdmin: dbMock }));
vi.mock("@/lib/social/server", () => ({ assertHubCapability: capabilityMock }));

import { postDiscordGuildMessage, validateDiscordSetupDestinations, validateDiscordVerificationRole } from "./destinations";

const GUILD = "111111111111111111";
const OTHER_GUILD = "222222222222222222";
const CHANNEL = "333333333333333333";
const BOT = "444444444444444444";
const BOT_ROLE = "555555555555555555";
const VERIFIED_ROLE = "666666666666666666";
let channel: Record<string, unknown>;
let roles: Array<Record<string, unknown>>;
let config: Record<string, unknown>;
let mappings: Array<{ id: string }>;
let hub: Record<string, unknown>;
let requestMock: ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DISCORD_COMMUNITY_BOT_TOKEN", "local-test-token");
  capabilityMock.mockResolvedValue("owner");
  channel = { id: CHANNEL, guild_id: GUILD, type: 0, permission_overwrites: [] };
  roles = [
    { id: GUILD, position: 0, permissions: "0" },
    { id: BOT_ROLE, position: 10, permissions: String((1n << 28n) | 3_072n) },
    { id: VERIFIED_ROLE, position: 1, permissions: "1024" },
  ];
  config = { hubId: "hub-a", reportsChannelId: CHANNEL, updatedAt: 7, updatedByUid: "admin-a" };
  mappings = [{ id: GUILD }];
  hub = { discordGuildId: GUILD, role_mode: "account" };
  dbMock.mockReturnValue({
    collection: (name: string) => ({
      doc: () => ({ get: async () => ({ exists: true, data: () => name === "hubs" ? hub : config }) }),
      where: () => ({ limit: () => ({ get: async () => ({ docs: mappings }) }) }),
    }),
  });
  requestMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace("/api/v10", "");
    if (path === "/users/@me") return Response.json({ id: BOT });
    if (path === `/guilds/${GUILD}/roles`) return Response.json(roles);
    if (path === `/guilds/${GUILD}/members/${BOT}`) return Response.json({ user: { id: BOT }, roles: [BOT_ROLE] });
    if (path === `/channels/${CHANNEL}`) return Response.json(channel);
    if (path === `/channels/${CHANNEL}/messages` && init?.method === "POST") return Response.json({ id: "777777777777777777" });
    throw new Error(`Unexpected test request ${path}`);
  });
  vi.stubGlobal("fetch", requestMock);
});

const destination = () => ({ guildId: GUILD, hubId: "hub-a", channelId: CHANNEL, content: "Result", expectedConfigUpdatedAt: 7 });
const setup = () => ({ guildId: GUILD, reportsChannelId: CHANNEL, feedChannelId: "", verifiedRoleId: "" });
const posts = () => requestMock.mock.calls.filter(([, init]) => init?.method === "POST");

describe("Discord result destination isolation", () => {
  it("posts only to the bound same-server channel with mentions disabled and retry nonce", async () => {
    const beforeSend = vi.fn(async () => undefined);
    await postDiscordGuildMessage({ ...destination(), nonce: "replay-claim", beforeSend });
    expect(beforeSend).toHaveBeenCalledOnce();
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(String(posts()[0][1]?.body))).toMatchObject({ allowed_mentions: { parse: [] }, nonce: "replay-claim", enforce_nonce: true });
    expect(capabilityMock).toHaveBeenCalledWith("hub-a", "admin-a", "manage_discord");
  });

  it("blocks a foreign server channel before preparing an unlisted replay", async () => {
    channel.guild_id = OTHER_GUILD;
    const beforeSend = vi.fn();
    await expect(postDiscordGuildMessage({ ...destination(), beforeSend })).rejects.toThrow("in this Discord server");
    expect(beforeSend).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(0);
  });

  it("does not prepare an unlisted replay when channel permissions deny sending", async () => {
    channel.permission_overwrites = [{ id: BOT_ROLE, type: 0, allow: "0", deny: "2048" }];
    const beforeSend = vi.fn();
    await expect(postDiscordGuildMessage({ ...destination(), beforeSend })).rejects.toThrow("View Channel and Send Messages");
    expect(beforeSend).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(0);
  });

  it("never falls back to the separate LFG bot token", async () => {
    vi.stubEnv("DISCORD_COMMUNITY_BOT_TOKEN", "");
    vi.stubEnv("DISCORD_BOT_TOKEN", "other-bot-local-token");
    const beforeSend = vi.fn();
    await expect(postDiscordGuildMessage({ ...destination(), beforeSend })).rejects.toThrow("not configured");
    expect(beforeSend).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each([1, 2, 4, 10, 11, 12, 15])("rejects unsupported channel type %i", async (type) => {
    channel.type = type;
    await expect(postDiscordGuildMessage(destination())).rejects.toThrow("text or announcement");
    expect(posts()).toHaveLength(0);
  });

  it("fails closed for duplicate legacy server mappings", async () => {
    mappings.push({ id: OTHER_GUILD });
    await expect(postDiscordGuildMessage(destination())).rejects.toThrow("destination changed");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each([undefined, "password", "legacy", "public"])("rejects non-account-managed hub mode %s before preparing or posting", async (mode) => {
    hub.role_mode = mode;
    const beforeSend = vi.fn();
    await expect(postDiscordGuildMessage({ ...destination(), beforeSend })).rejects.toThrow("destination changed");
    expect(beforeSend).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("rejects a camelCase-only mode that the Firestore privacy rules do not recognize", async () => {
    delete hub.role_mode;
    hub.roleMode = "account";
    const beforeSend = vi.fn();
    await expect(postDiscordGuildMessage({ ...destination(), beforeSend })).rejects.toThrow("destination changed");
    expect(beforeSend).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("blocks reconfigured hubs and channels and deleted hubs", async () => {
    config.hubId = "hub-b";
    await expect(postDiscordGuildMessage(destination())).rejects.toThrow("destination changed");
    config.hubId = "hub-a";
    config.updatedAt = 8;
    await expect(postDiscordGuildMessage(destination())).rejects.toThrow("destination changed");
    config.updatedAt = 7;
    hub.lifecycle_state = "deleting";
    await expect(postDiscordGuildMessage(destination())).rejects.toThrow("destination changed");
    expect(posts()).toHaveLength(0);
  });

  it("checks binding and configuring-admin access again after preparation", async () => {
    await expect(postDiscordGuildMessage({ ...destination(), beforeSend: async () => { capabilityMock.mockRejectedValue(new Error("revoked")); } }))
      .rejects.toThrow("no longer has access");
    expect(posts()).toHaveLength(0);
  });

  it("does not expose raw Discord API error bodies", async () => {
    requestMock.mockResolvedValue(new Response("private diagnostic secret", { status: 403 }));
    await expect(postDiscordGuildMessage(destination())).rejects.toThrow("(403)");
    await expect(postDiscordGuildMessage(destination())).rejects.not.toThrow("private diagnostic");
  });
});

describe("Discord setup and optional verification permissions", () => {
  it("requires only View Channel and Send Messages without a verification role", async () => {
    roles[1].permissions = "3072";
    await expect(validateDiscordSetupDestinations(setup())).resolves.toBeUndefined();
  });

  it("rejects channels in other servers and channel-level send denial", async () => {
    channel.guild_id = OTHER_GUILD;
    await expect(validateDiscordSetupDestinations(setup())).rejects.toThrow("in this Discord server");
    channel.guild_id = GUILD;
    channel.permission_overwrites = [{ id: BOT_ROLE, type: 0, allow: "0", deny: "2048" }];
    await expect(validateDiscordSetupDestinations(setup())).rejects.toThrow("View Channel and Send Messages");
  });

  it("honours an explicit bot member permission override", async () => {
    channel.permission_overwrites = [
      { id: BOT_ROLE, type: 0, allow: "0", deny: "2048" },
      { id: BOT, type: 1, allow: "2048", deny: "0" },
    ];
    await expect(validateDiscordSetupDestinations(setup())).resolves.toBeUndefined();
  });

  it("accepts only an assignable basic member role", async () => {
    await expect(validateDiscordVerificationRole({ guildId: GUILD, verifiedRoleId: VERIFIED_ROLE })).resolves.toBeUndefined();
    roles[2].permissions = "8";
    await expect(validateDiscordVerificationRole({ guildId: GUILD, verifiedRoleId: VERIFIED_ROLE })).rejects.toThrow("administrator or moderation");
    roles[2].permissions = "1024";
    roles[2].position = 10;
    await expect(validateDiscordVerificationRole({ guildId: GUILD, verifiedRoleId: VERIFIED_ROLE })).rejects.toThrow("below");
    roles[2].position = 1;
    roles[2].managed = true;
    await expect(validateDiscordVerificationRole({ guildId: GUILD, verifiedRoleId: VERIFIED_ROLE })).rejects.toThrow("Managed roles");
    await expect(validateDiscordVerificationRole({ guildId: GUILD, verifiedRoleId: GUILD })).rejects.toThrow("@everyone");
  });

  it("requires Manage Roles only when the optional role is used", async () => {
    roles[1].permissions = "3072";
    await expect(validateDiscordSetupDestinations({ ...setup(), verifiedRoleId: VERIFIED_ROLE })).rejects.toThrow("Manage Roles");
  });

  it.each([7, 17, 22, 27, 30, 33, 34, 41, 51, 52])("rejects moderation or private-data permission bit %i on a verification role", async (bit) => {
    roles[2].permissions = String(1n << BigInt(bit));
    await expect(validateDiscordVerificationRole({ guildId: GUILD, verifiedRoleId: VERIFIED_ROLE })).rejects.toThrow("administrator or moderation");
  });

  it("accepts the existing results server's ordinary messaging role permissions", async () => {
    roles[2].permissions = "633834093987904";
    await expect(validateDiscordVerificationRole({ guildId: GUILD, verifiedRoleId: VERIFIED_ROLE })).resolves.toBeUndefined();
  });
});
