import { beforeEach, describe, expect, it, vi } from "vitest";
const { dbMock, aliasesMock } = vi.hoisted(() => ({ dbMock: vi.fn(), aliasesMock: vi.fn() }));
vi.mock("@/lib/firebase/admin", () => ({ getFirestoreAdmin: dbMock }));
vi.mock("@/lib/social/server", () => ({ identityUidsFor: aliasesMock }));

import { readOwnerReplayDecks, saveOwnerReplayDecks, serializeReplay } from "./service";
import { projectReplaySummaryRecord } from "./projection";
import type { ReplayRecord } from "./model";
import type { AtlasMatchHistory } from "@/lib/replay-v2/atlas-history";

const id = "rl2_" + "a".repeat(32);
function history(): AtlasMatchHistory {
  const deck = {
    availability: "available" as const,
    cards: [
      { section: "legend" as const, quantity: 1, name: "Irelia, Blade Dancer" },
      { section: "mainDeck" as const, quantity: 2, name: "Adaptatron" },
    ],
  };
  return {
    version: 1,
    updatedAt: "2026-09-11T12:00:00Z",
    games: [
      {
        gameNumber: 1,
        historyId: "history-1",
        startedAt: Date.parse("2026-09-11T11:22:48.975Z"),
        roomCode: "PRIVATE-ROOM",
        myName: "BMU",
        opponentName: "Bine",
        myPoints: 7,
        opponentPoints: 4,
        me: structuredClone(deck),
        opponent: structuredClone(deck),
      },
    ],
  };
}
function harness(patch: Partial<ReplayRecord> = {}) {
  let record: ReplayRecord = {
    schema: "riftlite-replay-record",
    version: 2,
    replayId: id,
    ownerUid: "owner",
    captureId: "capture",
    visibility: "public",
    status: "ready",
    title: "Irelia",
    platform: "atlas",
    localReplayId: "local",
    matchId: "match",
    seriesId: "",
    roomCode: "",
    messageCount: 10,
    expectedRaw: { sha256: "b".repeat(64), bytes: 100 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ownerHistoryDecks: history(),
    ...patch,
  };
  const snapshot = () => ({ exists: true, data: () => record });
  const update = vi.fn((_ref, fields) => {
    record = { ...record, ...fields };
  });
  const transaction = { get: vi.fn(async () => snapshot()), update };
  const db = {
    collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: vi.fn(async () => snapshot()) })) })),
    runTransaction: vi.fn(async (operation) => operation(transaction)),
  };
  dbMock.mockReturnValue(db);
  return { update, db, current: () => record };
}
describe("owner-only replay deck attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aliasesMock.mockResolvedValue([]);
  });
  it("rejects other accounts and hub viewers even when the replay is public", async () => {
    const h = harness();
    for (const uid of ["", "other-account", "hub-member"]) {
      await expect(readOwnerReplayDecks(uid, id)).rejects.toMatchObject({ status: 403 });
      await expect(saveOwnerReplayDecks(uid, id, "match", history())).rejects.toMatchObject({ status: 403 });
    }
    expect(h.update).not.toHaveBeenCalled();
    expect(await readOwnerReplayDecks("owner", id)).toMatchObject({
      games: [{ opponent: { availability: "available" } }],
    });
  });
  it("allows a server-verified owner alias without broadening public access", async () => {
    harness();
    aliasesMock.mockResolvedValue(["owner"]);
    await expect(readOwnerReplayDecks("canonical-owner", id)).resolves.toBeTruthy();
  });
  it("binds a write to its linked Atlas match and ready replay", async () => {
    for (const patch of [
      { platform: "tcga" },
      { status: "processing" as const },
      { matchId: "different-match" },
    ]) {
      const h = harness(patch);
      await expect(saveOwnerReplayDecks("owner", id, "match", history())).rejects.toMatchObject({
        status: 409,
      });
      expect(h.update).not.toHaveBeenCalled();
    }
  });
  it("strips private cards/room codes and only updates the deck field", async () => {
    const h = harness();
    const input = history();
    input.games[0].opponent.availability = "private";
    await saveOwnerReplayDecks("owner", id, "match", input);
    const fields = h.update.mock.calls[0][1];
    expect(Object.keys(fields)).toEqual(["ownerHistoryDecks"]);
    expect(fields.ownerHistoryDecks.games[0]).toMatchObject({
      roomCode: "",
      opponent: { availability: "private", cards: [] },
    });
    expect(h.current().visibility).toBe("public");
    expect(input.games[0].roomCode).toBe("PRIVATE-ROOM");
  });
  it("never includes the private attachment in owner/public listing or playback metadata", () => {
    const h = harness();
    for (const ownerView of [true, false]) {
      expect(projectReplaySummaryRecord(h.current(), ownerView)).not.toHaveProperty("ownerHistoryDecks");
      expect(serializeReplay(h.current(), ownerView)).not.toHaveProperty("ownerHistoryDecks");
      expect(JSON.stringify(serializeReplay(h.current(), ownerView))).not.toContain("Adaptatron");
    }
  });
  it("rejects malformed or duplicate games without any database access", async () => {
    const h = harness();
    const input = history();
    input.games.push(input.games[0]);
    await expect(saveOwnerReplayDecks("owner", id, "match", input)).rejects.toMatchObject({ status: 400 });
    expect(h.db.runTransaction).not.toHaveBeenCalled();
  });
});
