import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: vi.fn(), capability: vi.fn(), destinations: vi.fn(), role: vi.fn() }));
vi.mock("@/lib/firebase/admin", () => ({ getFirestoreAdmin: mocks.db }));
vi.mock("@/lib/social/server", () => ({
  assertHubCapability: mocks.capability,
  bestProfileDisplayName: (_uid: string, value: unknown) => String(value ?? "Player"),
  cleanDisplayName: (value: unknown) => String(value ?? "Opponent"),
  normalizeAccountProfile: (_uid: string, value: unknown) => value,
}));
vi.mock("@/lib/discord/destinations", () => ({
  validateDiscordSetupDestinations: mocks.destinations,
  validateDiscordVerificationRole: mocks.role,
}));

import {
  assertDiscordSetupAllowed, completeDiscordVerification, completeTestingGoal, disconnectDiscordGuild,
  getDiscordGuildConfig, getDiscordGuildConfigsForHub, listTestingGoals,
  loadHubMatches, saveDiscordGuildConfig, verifyDiscordSignature,
} from "@/lib/discord/bot";

const config = (guildId = "guild-a", hubId = "hub-a") => ({
  guildId, hubId, verifiedRoleId: "", feedChannelId: "", reportsChannelId: "channel-a",
  updatedByUid: "admin-a", updatedByDiscordUserId: "discord-a", updatedAt: 1,
});

describe("Discord server and private hub isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capability.mockResolvedValue("admin");
    mocks.destinations.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("loads a server's own binding and fails closed for duplicate legacy bindings", async () => {
    const fake = database({ "hubs/hub-a": { role_mode: "account" }, "discordGuildConfigs/guild-a": config() });
    mocks.db.mockReturnValue(fake.db);
    expect(await getDiscordGuildConfig("guild-a")).toMatchObject({ hubId: "hub-a" });
    expect(await getDiscordGuildConfig("guild-b")).toBeNull();
    fake.docs.set("discordGuildConfigs/guild-b", config("guild-b"));
    expect(await getDiscordGuildConfig("guild-a")).toBeNull();
    expect(await getDiscordGuildConfigsForHub("hub-a")).toEqual([]);
  });

  it.each(["missing", "deleting", "revoked", "wrong-marker"])("blocks an unavailable integration: %s", async (condition) => {
    const fake = database({ "hubs/hub-a": { role_mode: "account" }, "discordGuildConfigs/guild-a": config() });
    if (condition === "missing") fake.docs.delete("hubs/hub-a");
    if (condition === "deleting") fake.docs.set("hubs/hub-a", { role_mode: "account", lifecycle_state: "deleting" });
    if (condition === "wrong-marker") fake.docs.set("hubs/hub-a", { role_mode: "account", discordGuildId: "guild-b" });
    if (condition === "revoked") mocks.capability.mockRejectedValue(new Error("No membership"));
    mocks.db.mockReturnValue(fake.db);
    expect(await getDiscordGuildConfig("guild-a")).toBeNull();
    expect(await getDiscordGuildConfigsForHub("hub-a")).toEqual([]);
  });

  it.each([{}, { role_mode: "legacy" }, { role_mode: "legacy", roleMode: "account" }, { roleMode: "account" }])("refuses publicly readable legacy hub bindings: %j", async (hub) => {
    const fake = database({ "hubs/hub-a": hub, "discordGuildConfigs/guild-a": config() });
    mocks.db.mockReturnValue(fake.db);
    expect(await getDiscordGuildConfig("guild-a")).toBeNull();
    expect(await getDiscordGuildConfigsForHub("hub-a")).toEqual([]);
    await expect(saveDiscordGuildConfig(config())).rejects.toThrow("Claim this legacy hub");
    expect(fake.writes).toEqual([]);
  });

  it("requires verification in the invoking guild as well as both administration permissions", async () => {
    const fake = database({ "discordLinks/guild-b_discord-a": { uid: "admin-a" } });
    mocks.db.mockReturnValue(fake.db);
    await expect(assertDiscordSetupAllowed({ guildId: "guild-a", discordUserId: "discord-a", hubId: "hub-a", memberPermissions: "32" })).rejects.toThrow("verify");
    fake.docs.set("discordLinks/guild-a_discord-a", { uid: "admin-a" });
    await expect(assertDiscordSetupAllowed({ guildId: "guild-a", discordUserId: "discord-a", hubId: "hub-a", memberPermissions: "0" })).rejects.toThrow("Manage Server");
    mocks.capability.mockRejectedValue(new Error("Denied"));
    await expect(assertDiscordSetupAllowed({ guildId: "guild-a", discordUserId: "discord-a", hubId: "hub-a", memberPermissions: "32" })).rejects.toThrow("owner or admin");
  });

  it("links an account but does not grant a testing role to someone outside the private hub", async () => {
    const fake = database({
      "hubs/hub-a": { role_mode: "account" }, "discordGuildConfigs/guild-a": { ...config(), verifiedRoleId: "testing-role" },
      "discordVerificationSessions/VERIFY123": { status: "pending", guildId: "guild-a", discordUserId: "discord-a", expiresAt: Date.now() + 60_000 },
    });
    mocks.db.mockReturnValue(fake.db);
    mocks.capability.mockImplementation(async (_hub, _uid, capability) => {
      if (capability === "view") throw new Error("Not a member");
      return "admin";
    });
    await expect(completeDiscordVerification("VERIFY123", "outside-account", { displayName: "Player" }))
      .resolves.toMatchObject({ roleAssigned: false, configuredRole: true, roleRequiresHubMembership: true });
    expect(mocks.role).not.toHaveBeenCalled();
    expect(fake.docs.get("discordLinks/guild-a_discord-a")?.uid).toBe("outside-account");
  });

  it("serializes concurrent first-time bindings using the shared hub document", async () => {
    const fake = database({ "hubs/hub-a": { role_mode: "account" } });
    mocks.db.mockReturnValue(fake.db);
    const attempts = await Promise.allSettled([saveDiscordGuildConfig(config()), saveDiscordGuildConfig(config("guild-b"))]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(fake.docs.get("hubs/hub-a")).toMatchObject({ discordGuildId: "guild-a" });
    expect(fake.docs.has("discordGuildConfigs/guild-b")).toBe(false);
    expect(fake.writes).toContain("hubs/hub-a");
  });

  it("validates destinations before saving and rejects existing foreign bindings", async () => {
    const fake = database({ "hubs/hub-a": { role_mode: "account" }, "discordGuildConfigs/guild-b": config("guild-b") });
    mocks.db.mockReturnValue(fake.db);
    await expect(saveDiscordGuildConfig(config())).rejects.toThrow("another Discord server");
    expect(fake.writes).toEqual([]);
    expect(mocks.destinations).toHaveBeenCalledWith(expect.objectContaining({ guildId: "guild-a" }));
    mocks.destinations.mockRejectedValue(new Error("Wrong channel"));
    await expect(saveDiscordGuildConfig(config())).rejects.toThrow("Wrong channel");
    expect(fake.writes).toEqual([]);
  });

  it("preserves goal history under its original hub when changing a server binding", async () => {
    const fake = database({
      "hubs/hub-a": { role_mode: "account", discordGuildId: "guild-a" }, "hubs/hub-b": { role_mode: "account" },
      "discordGuildConfigs/guild-a": config(),
      "discordGuildConfigs/guild-a/testingGoals/abcdef-original": { text: "Private A goal", status: "active" },
    });
    mocks.db.mockReturnValue(fake.db);
    await saveDiscordGuildConfig(config("guild-a", "hub-b"));
    expect(fake.docs.get("discordGuildConfigs/guild-a/testingGoals/abcdef-original")).toMatchObject({ text: "Private A goal", hubId: "hub-a" });
    expect(await listTestingGoals("guild-a")).toEqual([]);
    expect(fake.docs.get("hubs/hub-a")?.discordGuildId).toBe("");
  });

  it("disconnects without deleting results or goal history, and can reconnect safely", async () => {
    const fake = database({
      "hubs/hub-a": { role_mode: "account", discordGuildId: "guild-a" }, "hubs/hub-b": { role_mode: "account" },
      "hubs/hub-a/matches/private-match": { uid: "player-a" },
      "discordGuildConfigs/guild-a": config(),
      "discordGuildConfigs/guild-a/testingGoals/abcdef-original": { text: "Private A goal", status: "active" },
    });
    mocks.db.mockReturnValue(fake.db);
    await disconnectDiscordGuild("guild-a");
    expect(fake.docs.has("discordGuildConfigs/guild-a")).toBe(false);
    expect(fake.docs.has("hubs/hub-a/matches/private-match")).toBe(true);
    expect(fake.docs.get("discordGuildConfigs/guild-a/testingGoals/abcdef-original")?.hubId).toBe("hub-a");
    await saveDiscordGuildConfig(config("guild-a", "hub-b"));
    expect(await listTestingGoals("guild-a")).toEqual([]);
  });

  it("never attributes orphaned legacy goals to a newly connected hub", async () => {
    const fake = database({
      "hubs/hub-a": { role_mode: "account" },
      "discordGuildConfigs/guild-a/testingGoals/old-orphaned-goal": { text: "Unattributed private goal", status: "active" },
    });
    mocks.db.mockReturnValue(fake.db);
    await saveDiscordGuildConfig(config());
    expect(await listTestingGoals("guild-a")).toEqual([]);
    expect(fake.docs.get("discordGuildConfigs/guild-a/testingGoals/old-orphaned-goal")?.text).toBe("Unattributed private goal");
  });

  it("rejects goal reads and completions when the server changes hub after caller authorization", async () => {
    const fake = database({
      "hubs/hub-b": { role_mode: "account" }, "discordGuildConfigs/guild-a": config("guild-a", "hub-b"),
      "discordGuildConfigs/guild-a/testingGoals/private-b": { text: "Private B goal", hubId: "hub-b", status: "active" },
    });
    mocks.db.mockReturnValue(fake.db);
    await expect(listTestingGoals("guild-a", "hub-a")).rejects.toThrow("connection changed");
    await expect(completeTestingGoal("guild-a", "private-b", "admin-a", "hub-a")).rejects.toThrow("connection changed");
    expect(fake.writes).toEqual([]);
  });

  it("refuses unbounded goal history migration before changing data", async () => {
    const fake = database({ "hubs/hub-a": { role_mode: "account" }, "discordGuildConfigs/guild-a": config() });
    for (let i = 0; i < 491; i++) fake.docs.set(`discordGuildConfigs/guild-a/testingGoals/goal-${i}`, { status: "done" });
    mocks.db.mockReturnValue(fake.db);
    await expect(disconnectDiscordGuild("guild-a")).rejects.toThrow("goal history");
    expect(fake.writes).toEqual([]);
  });

  it("completes displayed short goal ids without creating phantom records or crossing hubs", async () => {
    const fake = database({
      "hubs/hub-a": { role_mode: "account" }, "discordGuildConfigs/guild-a": config(),
      "discordGuildConfigs/guild-a/testingGoals/abcdef-long-id": { hubId: "hub-a", status: "active", text: "A" },
      "discordGuildConfigs/guild-a/testingGoals/foreign-goal": { hubId: "hub-b", status: "active", text: "B" },
    });
    mocks.db.mockReturnValue(fake.db);
    await completeTestingGoal("guild-a", "abcdef", "admin-a", "hub-a");
    expect(fake.docs.get("discordGuildConfigs/guild-a/testingGoals/abcdef-long-id")?.status).toBe("done");
    expect(fake.docs.has("discordGuildConfigs/guild-a/testingGoals/abcdef")).toBe(false);
    await expect(completeTestingGoal("guild-a", "foreign-goal", "admin-a", "hub-a")).rejects.toThrow("not found");
    expect(fake.docs.get("discordGuildConfigs/guild-a/testingGoals/foreign-goal")?.status).toBe("active");
  });

  it("reads mixed timestamp schemas only from the requested hub and deduplicates rows", async () => {
    const fake = database({
      "hubs/hub-a/matches/snake": { created_at: 1_800_000_001_000, result: "Win" },
      "hubs/hub-a/matches/camel": { createdAt: 1_800_000_003_000, result: "Loss" },
      "hubs/hub-a/matches/both": { created_at: 1_800_000_002_000, createdAt: 1_800_000_002_000 },
      "hubs/hub-b/matches/foreign": { created_at: 1_900_000_000_000, result: "SECRET" },
    });
    mocks.db.mockReturnValue(fake.db);
    expect((await loadHubMatches("hub-a")).map((match) => match.id)).toEqual(["camel", "both", "snake"]);
  });

  it("accepts fresh valid signatures and rejects expired, future, or tampered requests", () => {
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
    vi.stubEnv("DISCORD_PUBLIC_KEY", publicKey);
    const body = JSON.stringify({ type: 1 });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(timestamp + body), keys.privateKey).toString("hex");
    expect(verifyDiscordSignature(body, timestamp, signature)).toBe(true);
    expect(verifyDiscordSignature(body + " ", timestamp, signature)).toBe(false);
    for (const offset of [-301, 301]) {
      const stale = String(Number(timestamp) + offset);
      expect(verifyDiscordSignature(body, stale, sign(null, Buffer.from(stale + body), keys.privateKey).toString("hex"))).toBe(false);
    }
  });
});

type Data = Record<string, unknown>;
function database(seed: Record<string, Data>) {
  const docs = new Map(Object.entries(seed));
  const writes: string[] = [];
  const snapshot = (path: string) => ({ id: path.split("/").at(-1)!, ref: ref(path), exists: docs.has(path), data: () => docs.get(path) });
  function ref(path: string) {
    return { path, get: async () => snapshot(path), collection: (name: string) => query(`${path}/${name}`) };
  }
  function query(path: string, filters: Array<[string, unknown]> = [], ordering = "", cap = Infinity) {
    return {
      path, doc: (id = "new-goal") => ref(`${path}/${id}`),
      where: (field: string, _operator: string, value: unknown) => query(path, [...filters, [field, value]], ordering, cap),
      orderBy: (field: string) => query(path, filters, field, cap),
      limit: (limit: number) => query(path, filters, ordering, limit),
      get: async () => ({ docs: [...docs.entries()]
        .filter(([key, data]) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1
          && filters.every(([field, value]) => data[field] === value) && (!ordering || data[ordering] !== undefined))
        .sort(([, a], [, b]) => ordering ? Number(b[ordering]) - Number(a[ordering]) : 0)
        .slice(0, cap).map(([key]) => snapshot(key)) }),
    };
  }
  let pending = Promise.resolve();
  const db = {
    collection: (name: string) => query(name), getAll: async (...refs: ReturnType<typeof ref>[]) => refs.map((target) => snapshot(target.path)),
    runTransaction: <T>(callback: (tx: { get: <R>(target: { get: () => Promise<R> }) => Promise<R>; set: (target: ReturnType<typeof ref>, data: Data, options?: { merge?: boolean }) => void; delete: (target: ReturnType<typeof ref>) => void }) => Promise<T>) => {
      const result = pending.then(() => callback({
        get: (target) => target.get(),
        set: (target, data, options) => { docs.set(target.path, { ...(options?.merge ? docs.get(target.path) : {}), ...data }); writes.push(target.path); },
        delete: (target) => { docs.delete(target.path); writes.push(target.path); },
      }));
      pending = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  return { db, docs, writes };
}
