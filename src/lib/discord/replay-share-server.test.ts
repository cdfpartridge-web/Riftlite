import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, configsMock, postMock, capabilityMock, identityMock } = vi.hoisted(() => ({
  dbMock: vi.fn(), configsMock: vi.fn(), postMock: vi.fn(), capabilityMock: vi.fn(), identityMock: vi.fn(),
}));
vi.mock("@/lib/firebase/admin", () => ({ getFirestoreAdmin: dbMock }));
vi.mock("@/lib/discord/bot", () => ({ getDiscordGuildConfigsForHub: configsMock }));
vi.mock("@/lib/discord/destinations", () => ({ postDiscordGuildMessage: postMock }));
vi.mock("@/lib/social/server", () => ({ assertHubCapability: capabilityMock, identityUidsFor: identityMock }));
vi.mock("@/lib/discord/replay-share", () => ({
  discordReplayReportChannelId: (config: { reportsChannelId: string }) => config.reportsChannelId,
  isDiscordReplayResultResolved: () => true,
  summarizeReplayForDiscord: () => ({}),
  formatDiscordReplayPost: () => "A vs B — unlisted replay",
}));

import { shareReplayToDiscordFeeds } from "./replay-share-server";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";

const GUILD = "111111111111111111";
const OTHER_GUILD = "222222222222222222";
const CHANNEL = "333333333333333333";
let documents: Map<string, Record<string, unknown>>;
const config = () => ({ guildId: GUILD, hubId: "hub-a", reportsChannelId: CHANNEL, updatedAt: 7 });

beforeEach(() => {
  vi.clearAllMocks();
  configsMock.mockResolvedValue([config()]);
  capabilityMock.mockResolvedValue("member");
  identityMock.mockResolvedValue(["owner-a"]);
  postMock.mockImplementation(async ({ beforeSend }: { beforeSend: () => Promise<void> }) => {
    await beforeSend();
    return { id: "777777777777777777" };
  });
  documents = new Map<string, Record<string, unknown>>([
    ["hubs/hub-a", { discordGuildId: GUILD, role_mode: "account" }],
    [`discordGuildConfigs/${GUILD}`, config()],
  ]);
  const snapshot = (path: string) => ({ exists: documents.has(path), data: () => documents.get(path) });
  type Ref = { path: string };
  dbMock.mockReturnValue({
    collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
    runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
      get: async (ref: Ref) => snapshot(ref.path),
      set: (ref: Ref, data: Record<string, unknown>) => documents.set(ref.path, { ...documents.get(ref.path), ...data }),
    }),
  });
});

const share = (beforeFirstPost = vi.fn(async () => undefined), hubIds = ["hub-a"]) => shareReplayToDiscordFeeds({
  ownerUid: "owner-a", replayId: "replay-a", replay: {} as CanonicalReplayV2, hubIds,
  origin: "https://www.riftlite.com", beforeFirstPost,
});

describe("private hub replay delivery", () => {
  it("uses only the selected hub's single server and prepares visibility immediately before sending", async () => {
    const prepare = vi.fn(async () => undefined);
    await expect(share(prepare)).resolves.toEqual([{ hubId: "hub-a", status: "shared" }]);
    expect(postMock).toHaveBeenCalledWith(expect.objectContaining({ guildId: GUILD, hubId: "hub-a", channelId: CHANNEL, expectedConfigUpdatedAt: 7 }));
    expect(prepare).toHaveBeenCalledOnce();
    expect([...documents.entries()].find(([path]) => path.startsWith("replayDiscordShares/"))?.[1]).toMatchObject({ status: "posted", guildId: GUILD, channelId: CHANNEL });
  });

  it("rejects another hub without preparing visibility or trying Discord", async () => {
    capabilityMock.mockRejectedValue(new Error("not a member"));
    const prepare = vi.fn();
    await expect(share(prepare, ["hub-b"])).resolves.toEqual([{ hubId: "hub-b", status: "not-member" }]);
    expect(prepare).not.toHaveBeenCalled();
    expect(configsMock).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("fails closed instead of selecting or broadcasting across ambiguous legacy mappings", async () => {
    configsMock.mockResolvedValue([config(), { ...config(), guildId: OTHER_GUILD, reportsChannelId: "" }]);
    const prepare = vi.fn();
    await expect(share(prepare)).resolves.toEqual([{ hubId: "hub-a", status: "not-configured" }]);
    expect(postMock).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("blocks a changed binding at claim time", async () => {
    documents.set(`discordGuildConfigs/${GUILD}`, { ...config(), hubId: "hub-b" });
    const prepare = vi.fn();
    await expect(share(prepare)).resolves.toEqual([{ hubId: "hub-a", status: "not-member" }]);
    expect(postMock).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("rechecks membership just before sending after the initial eligibility check", async () => {
    capabilityMock.mockResolvedValueOnce("member").mockRejectedValue(new Error("membership revoked"));
    const prepare = vi.fn();
    await expect(share(prepare)).resolves.toEqual([{ hubId: "hub-a", status: "failed" }]);
    expect(prepare).not.toHaveBeenCalled();
    expect([...documents.values()].some((data) => data.status === "posted")).toBe(false);
  });

  it("does not unlist when the guild destination guard rejects the channel", async () => {
    postMock.mockRejectedValue(new Error("foreign channel"));
    const prepare = vi.fn();
    await expect(share(prepare)).resolves.toEqual([{ hubId: "hub-a", status: "failed" }]);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("keeps posted claims idempotent without changing visibility on a retry", async () => {
    await share();
    postMock.mockClear();
    const prepare = vi.fn();
    await expect(share(prepare)).resolves.toEqual([{ hubId: "hub-a", status: "already-shared" }]);
    expect(postMock).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("retains an in-progress claim and retries a failed post with the same nonce", async () => {
    postMock.mockRejectedValueOnce(new Error("Discord unavailable"));
    await share();
    const firstNonce = postMock.mock.calls[0][0].nonce;
    await expect(share()).resolves.toEqual([{ hubId: "hub-a", status: "shared" }]);
    expect(postMock.mock.calls[1][0].nonce).toBe(firstNonce);
    const entry = [...documents.entries()].find(([path]) => path.startsWith("replayDiscordShares/"))!;
    documents.set(entry[0], { ...entry[1], status: "posting", attemptedAt: Date.now() });
    postMock.mockClear();
    await expect(share()).resolves.toEqual([{ hubId: "hub-a", status: "in-progress" }]);
    expect(postMock).not.toHaveBeenCalled();
  });
});
