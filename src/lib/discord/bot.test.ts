import { beforeEach, describe, expect, it, vi } from "vitest";

const { getFirestoreAdminMock } = vi.hoisted(() => ({
  getFirestoreAdminMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: getFirestoreAdminMock,
}));

import {
  buildHubStats,
  completeDiscordVerification,
  formatRecentMatches,
  formatWeeklyReport,
  type DiscordHubMatch,
} from "@/lib/discord/bot";

function hubMatch(patch: Partial<DiscordHubMatch> = {}): DiscordHubMatch {
  return {
    id: "match-1",
    uid: "user-1",
    player: "Player",
    opponent: "Opponent",
    myLegend: "Akali",
    oppLegend: "Ahri",
    format: "Bo3",
    result: "Win",
    score: "2-1",
    deckName: "Akali Tempo",
    deckUrl: "https://piltoverarchive.com/decks/view/11111111-1111-4111-8111-111111111111",
    createdAt: Date.now(),
    superseded: false,
    ...patch,
  };
}

describe("Discord hub deck reporting", () => {
  it("adds only the masked Piltover link to a recent match", () => {
    const text = formatRecentMatches([hubMatch()]);

    expect(text).toContain("Active deck: [Akali Tempo](https://piltoverarchive.com/decks/view/11111111-1111-4111-8111-111111111111)");
    expect(text).not.toContain("mainDeck");
    expect(formatRecentMatches([hubMatch({ deckUrl: "" })])).not.toContain("Active deck:");
  });

  it("keeps existing unlinked deck statistics while linking verified Piltover rows", () => {
    const linked = hubMatch();
    const stats = buildHubStats("hub-1", [
      linked,
      hubMatch({ id: "match-2", createdAt: linked.createdAt - 1_000 }),
      hubMatch({ id: "match-3", deckName: "Local testing deck", deckUrl: "", createdAt: linked.createdAt - 2_000 }),
      hubMatch({ id: "match-4", deckName: "Local testing deck", deckUrl: "", result: "Loss", createdAt: linked.createdAt - 3_000 }),
    ]);
    const report = formatWeeklyReport(stats);

    expect(stats.deckResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ deckName: "Akali Tempo", matches: 2, deckUrl: linked.deckUrl }),
      expect.objectContaining({ deckName: "Local testing deck", matches: 2, deckUrl: "" }),
    ]));
    expect(report).toContain(`[Akali Tempo](${linked.deckUrl})`);
    expect(report).toContain("Local testing deck: 2 matches");
    expect(report).not.toContain("[Local testing deck]");
  });
});

describe("Discord account verification redemption", () => {
  beforeEach(() => {
    getFirestoreAdminMock.mockReset();
  });

  it("is idempotent for the winning account and rejects a later different account", async () => {
    const fake = fakeDiscordVerificationDb({
      code: "VERIFY123",
      guildId: "guild-1",
      discordUserId: "discord-1",
      discordUsername: "Player",
      status: "pending",
      expiresAt: Date.now() + 60_000,
    });
    getFirestoreAdminMock.mockReturnValue(fake.db);

    await expect(completeDiscordVerification("VERIFY123", "account-1", {
      handle: "player-one",
      displayName: "Player One",
    })).resolves.toMatchObject({ link: { uid: "account-1", discordUserId: "discord-1" } });
    await expect(completeDiscordVerification("VERIFY123", "account-1", {
      handle: "player-one",
      displayName: "Player One",
    })).resolves.toMatchObject({ link: { uid: "account-1" } });
    await expect(completeDiscordVerification("VERIFY123", "account-2", {
      handle: "player-two",
      displayName: "Player Two",
    })).rejects.toThrow("already been used");

    expect(fake.read("discordVerificationSessions/VERIFY123")).toMatchObject({
      status: "complete",
      uid: "account-1",
    });
    expect(fake.read("discordLinks/guild-1_discord-1")).toMatchObject({
      uid: "account-1",
      handle: "player-one",
    });
    expect(fake.writePaths.filter((path) => path === "discordLinks/guild-1_discord-1")).toHaveLength(1);
  });
});

function fakeDiscordVerificationDb(session: Record<string, unknown>) {
  type Ref = {
    path: string;
    get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
    collection: (name: string) => { doc: (id: string) => Ref };
  };
  const documents = new Map<string, Record<string, unknown>>([
    ["discordVerificationSessions/VERIFY123", { ...session }],
  ]);
  const writePaths: string[] = [];
  const snapshot = (path: string) => ({
    exists: documents.has(path),
    data: () => documents.get(path) ? { ...documents.get(path)! } : undefined,
  });
  const ref = (path: string): Ref => ({
    path,
    get: async () => snapshot(path),
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async <T>(callback: (transaction: {
      get: (target: Ref) => Promise<ReturnType<typeof snapshot>>;
      set: (target: Ref, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
    }) => Promise<T>) => callback({
      get: async (target) => snapshot(target.path),
      set: (target, data, options) => {
        const previous = options?.merge ? documents.get(target.path) ?? {} : {};
        documents.set(target.path, { ...previous, ...data });
        writePaths.push(target.path);
      },
    }),
  };
  return {
    db,
    writePaths,
    read: (path: string) => documents.get(path),
  };
}
