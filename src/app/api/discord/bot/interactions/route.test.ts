import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(), signature: vi.fn(), config: vi.fn(), uid: vi.fn(), capability: vi.fn(), setup: vi.fn(),
  matches: vi.fn(), post: vi.fn(), save: vi.fn(), verify: vi.fn(), disconnect: vi.fn(),
  goals: vi.fn(), addGoal: vi.fn(), completeGoal: vi.fn(), verified: vi.fn(), fetch: vi.fn(),
}));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/discord/bot", () => ({
  verifyDiscordSignature: mocks.signature, getDiscordApplicationId: () => "1524708623790510241",
  getDiscordGuildConfig: mocks.config, getLinkedRiftLiteUid: mocks.uid, assertDiscordHubCapability: mocks.capability,
  assertDiscordSetupAllowed: mocks.setup, loadHubMatches: mocks.matches, saveDiscordGuildConfig: mocks.save,
  createDiscordVerificationSession: mocks.verify, disconnectDiscordGuild: mocks.disconnect,
  hasManageGuild: (value: string) => Boolean(BigInt(value) & 40n),
  buildHubStats: (hubId: string, matches: unknown[]) => ({ hubId, matches }),
  formatRecentMatches: (matches: Array<{ player: string }>) => matches.map((match) => match.player).join(","),
  formatLeaderboard: (stats: { hubId: string }) => `Leaderboard for ${stats.hubId}`,
  formatWeeklyReport: (stats: { hubId: string }) => `Report for ${stats.hubId}`,
  listTestingGoals: mocks.goals, addTestingGoal: mocks.addGoal, completeTestingGoal: mocks.completeGoal,
  formatTestingGoals: () => "Testing goals", listDiscordVerifiedMembers: mocks.verified,
}));
vi.mock("@/lib/discord/destinations", () => ({ postDiscordGuildMessage: mocks.post }));

import { DiscordCommandError } from "@/lib/discord/command-error";
import { POST } from "./route";

const appId = "1524708623790510241";
const guildA = "111111111111111111";
const guildB = "222222222222222222";
const config = (guildId = guildA) => ({
  guildId, hubId: guildId === guildA ? "hub-a" : "hub-b", updatedByUid: "admin", updatedAt: 123,
  reportsChannelId: `channel-${guildId}`, feedChannelId: "", verifiedRoleId: "role-a",
});
const command = (name = "recent", patch: Record<string, unknown> = {}) => ({
  id: "333333333333333333", application_id: appId, token: "synthetic-test-interaction-token", type: 2,
  guild_id: guildA, channel_id: "channel-a", context: 0,
  authorizing_integration_owners: { "0": guildA }, member: { permissions: "32", user: { id: "discord-user", username: "Tester" } },
  data: { name, options: [] }, ...patch,
});
const request = (payload: Record<string, unknown>) => new NextRequest("https://www.riftlite.com/api/discord/bot/interactions", {
  method: "POST", headers: { "x-signature-timestamp": "1800000000", "x-signature-ed25519": "synthetic" }, body: JSON.stringify(payload),
});

describe("Discord interactions privacy and deferral", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
    mocks.signature.mockReturnValue(true);
    mocks.config.mockImplementation(async (guildId: string) => config(guildId));
    mocks.uid.mockResolvedValue("member-a");
    mocks.capability.mockImplementation(async (_hubId, uid) => { if (!uid) throw new DiscordCommandError("Run /verify here first."); });
    mocks.setup.mockImplementation(async (input) => {
      if (input.memberPermissions !== "32") throw new DiscordCommandError("Manage Server is required.");
      return "admin-a";
    });
    mocks.matches.mockImplementation(async (hubId) => [{ player: `Private result ${hubId}` }]);
    mocks.save.mockImplementation(async (input) => ({ ...input, updatedAt: 124 }));
    mocks.goals.mockResolvedValue([]);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function finish(payload: Record<string, unknown>) {
    const response = await POST(request(payload));
    const acknowledgement = await response.json();
    if (mocks.after.mock.calls.length) await mocks.after.mock.calls.at(-1)![0]();
    const edit = mocks.fetch.mock.calls.at(-1)?.[1] as RequestInit | undefined;
    return { response, acknowledgement, message: edit?.body ? JSON.parse(String(edit.body)) as { content: string; flags: number; allowed_mentions: unknown } : null };
  }

  it("rejects unsigned and wrong-application requests before doing work", async () => {
    mocks.signature.mockReturnValue(false);
    expect((await POST(request(command()))).status).toBe(401);
    mocks.signature.mockReturnValue(true);
    expect((await POST(request(command("recent", { application_id: "other-app" })))).status).toBe(401);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.config).not.toHaveBeenCalled();
  });

  it("answers signed pings synchronously", async () => {
    const response = await POST(request({ type: 1, application_id: appId }));
    expect(await response.json()).toEqual({ type: 1 });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("accepts minimal signed endpoint-verification pings but rejects an explicit conflicting app", async () => {
    expect(await (await POST(request({ type: 1 }))).json()).toEqual({ type: 1 });
    expect((await POST(request({ type: 1, application_id: "other-app" }))).status).toBe(401);
    expect((await POST(request(command("help", { application_id: undefined })))).status).toBe(401);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it.each([
    { guild_id: undefined, context: 1 },
    { authorizing_integration_owners: { "1": "discord-user" } },
    { authorizing_integration_owners: { "0": guildB } },
    { member: undefined },
  ])("rejects DM and user-installed contexts: %j", async (patch) => {
    const response = await POST(request(command("recent", patch)));
    expect((await response.json()).data.flags).toBe(64);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.config).not.toHaveBeenCalled();
  });

  it("acknowledges privately before reading Firestore or calling Discord", async () => {
    const response = await POST(request(command()));
    expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });
    expect(mocks.matches).not.toHaveBeenCalled();
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.matches).toHaveBeenCalledWith("hub-a");
    expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining(`/webhooks/${appId}/`), expect.objectContaining({ method: "PATCH" }));
  });

  it("uses only the signed guild binding even when a command tries supplying another hub", async () => {
    const result = await finish(command("recent", { data: { name: "recent", options: [{ name: "hub_id", value: "hub-b", type: 3 }] } }));
    expect(mocks.config).toHaveBeenCalledWith(guildA);
    expect(mocks.uid).toHaveBeenCalledWith(guildA, "discord-user");
    expect(mocks.capability).toHaveBeenCalledWith("hub-a", "member-a", "view");
    expect(result.message).toMatchObject({ content: "Private result hub-a", allowed_mentions: { parse: [] } });
    expect(result.acknowledgement).toEqual({ type: 5, data: { flags: 64 } });
    expect(result.message?.flags).toBeUndefined();
    expect(result.message?.content).not.toContain("hub-b");
  });

  it.each(["recent", "leaderboard", "weekly-report", "testing-goals"])("rejects unverified members before reading private %s data", async (name) => {
    mocks.uid.mockResolvedValue("");
    const result = await finish(command(name));
    expect(result.message?.content).toContain("verify");
    expect(mocks.matches).not.toHaveBeenCalled();
    expect(mocks.goals).not.toHaveBeenCalled();
  });

  it("rejects removed hub members and inactive integrations", async () => {
    mocks.capability.mockRejectedValue(new DiscordCommandError("Current hub membership required."));
    expect((await finish(command())).message?.content).toContain("membership");
    expect(mocks.matches).not.toHaveBeenCalled();
    mocks.config.mockResolvedValue(null);
    expect((await finish(command())).message?.content).toContain("no active private hub");
  });

  it("anchors goal reads to the hub which authorized this caller", async () => {
    await finish(command("testing-goals"));
    expect(mocks.goals).toHaveBeenCalledWith(guildA, "hub-a");
  });

  it("requires administration before reading or publicly posting weekly reports", async () => {
    const result = await finish(command("weekly-report", {
      member: { permissions: "0", user: { id: "discord-user" } },
      data: { name: "weekly-report", options: [{ name: "post", type: 5, value: true }] },
    }));
    expect(result.message?.content).toContain("Manage Server");
    expect(mocks.matches).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("posts only to this server's validated destination with retry nonce and config version", async () => {
    const result = await finish(command("weekly-report", { data: { name: "weekly-report", options: [{ name: "post", type: 5, value: true }] } }));
    expect(mocks.post).toHaveBeenCalledWith({ guildId: guildA, hubId: "hub-a", channelId: `channel-${guildA}`,
      content: "Report for hub-a", nonce: "333333333333333333", expectedConfigUpdatedAt: 123 });
    expect(result.acknowledgement.data.flags).toBe(64);
    expect(result.message?.flags).toBeUndefined();
  });

  it("preserves omitted setup destinations for the same hub", async () => {
    await finish(command("setup", { data: { name: "setup", options: [{ name: "hub_id", type: 3, value: "hub-a" }] } }));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ verifiedRoleId: "role-a", reportsChannelId: `channel-${guildA}` }));
  });

  it("clears inherited destinations when changing hubs", async () => {
    await finish(command("setup", { data: { name: "setup", options: [{ name: "hub_id", type: 3, value: "hub-new" }] } }));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ verifiedRoleId: "", reportsChannelId: "" }));
  });

  it("does not expose internal provider errors in Discord", async () => {
    mocks.matches.mockRejectedValue(new Error("Firestore private project + credentials + stack"));
    const result = await finish(command());
    expect(result.message?.content).toContain("could not complete");
    expect(result.message?.content).not.toMatch(/Firestore|credentials|stack/);
  });

  it("provides help without requiring an existing hub and restricts disconnect to verified managers", async () => {
    const help = await finish(command("help"));
    expect(help.message?.content).toContain("RiftLite Results Bot");
    expect(mocks.config).not.toHaveBeenCalled();
    const denied = await finish(command("disconnect", { member: { permissions: "0", user: { id: "discord-user" } } }));
    expect(denied.message?.content).toContain("Manage Server");
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect((await finish(command("disconnect"))).message?.content).toContain("preserved");
    expect(mocks.disconnect).toHaveBeenCalledWith(guildA);
  });
});
