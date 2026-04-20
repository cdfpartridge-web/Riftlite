import { describe, expect, it } from "vitest";

import {
  buildWeeklySnapshotFromMatches,
  isoWeek,
  isoWeekStartMs,
  previousIsoWeek,
  weekJustEnded,
  weeklySnapshotDocId,
} from "@/lib/community/weekly-snapshot";
import type { CommunityMatch } from "@/lib/types";

function makeMatch(over: Partial<CommunityMatch>): CommunityMatch {
  return {
    id: "m",
    uid: "u",
    username: "player",
    date: "",
    result: "Win",
    myChampion: "Darius",
    oppChampion: "Jinx",
    oppName: "",
    fmt: "Bo1",
    score: "",
    wentFirst: "",
    myBattlefield: "",
    oppBattlefield: "",
    flags: "",
    games: [],
    deckName: "",
    deckSourceUrl: "",
    deckSourceKey: "",
    deckSnapshot: null,
    createdAt: 0,
    ...over,
  };
}

describe("isoWeek", () => {
  it("Dec 31 2024 falls in ISO 2025-W01", () => {
    const { year, week } = isoWeek(new Date("2024-12-31T12:00:00Z"));
    expect(year).toBe(2025);
    expect(week).toBe(1);
  });

  it("Jan 1 2023 falls in ISO 2022-W52", () => {
    const { year, week } = isoWeek(new Date("2023-01-01T12:00:00Z"));
    expect(year).toBe(2022);
    expect(week).toBe(52);
  });

  it("a mid-year Wednesday returns the expected week", () => {
    const { year, week } = isoWeek(new Date("2026-04-22T12:00:00Z"));
    expect(year).toBe(2026);
    // Apr 22 2026 is a Wednesday in ISO week 17.
    expect(week).toBe(17);
  });
});

describe("isoWeekStartMs", () => {
  it("returns Monday 00:00 UTC of the containing week", () => {
    const wed = new Date("2026-04-22T15:30:00Z");
    const startMs = isoWeekStartMs(wed);
    const start = new Date(startMs);
    expect(start.getUTCDay()).toBe(1); // Monday
    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCDate()).toBe(20); // Apr 20 2026
  });
});

describe("weekJustEnded", () => {
  it("on Monday at 00:10 UTC, targets the week that just finished", () => {
    // Monday Apr 20 2026 at 00:10 UTC — we want the report to cover
    // Apr 13–19, which is ISO 2026-W16.
    const now = new Date("2026-04-20T00:10:00Z");
    const result = weekJustEnded(now);
    expect(result.year).toBe(2026);
    expect(result.week).toBe(16);
  });

  it("on Sunday at 23:50 UTC, targets the week that just finished", () => {
    const now = new Date("2026-04-19T23:50:00Z");
    const result = weekJustEnded(now);
    expect(result.year).toBe(2026);
    expect(result.week).toBe(16);
  });
});

describe("previousIsoWeek", () => {
  it("rolls back one week within a year", () => {
    expect(previousIsoWeek(2026, 17)).toEqual({ year: 2026, week: 16 });
  });

  it("rolls back across a year boundary", () => {
    expect(previousIsoWeek(2026, 1)).toEqual({ year: 2025, week: 52 });
  });
});

describe("weeklySnapshotDocId", () => {
  it("zero-pads single-digit weeks", () => {
    expect(weeklySnapshotDocId(2026, 4)).toBe("weekly-2026-W04");
    expect(weeklySnapshotDocId(2026, 17)).toBe("weekly-2026-W17");
  });
});

describe("buildWeeklySnapshotFromMatches", () => {
  const window = {
    year: 2026,
    week: 17,
    startMs: new Date("2026-04-20T00:00:00Z").getTime(),
    endMs: new Date("2026-04-27T00:00:00Z").getTime(),
  };

  it("handles an empty match list", () => {
    const snap = buildWeeklySnapshotFromMatches([], window);
    expect(snap.matchCount).toBe(0);
    expect(snap.uniquePlayers).toBe(0);
    expect(snap.legends).toEqual([]);
    expect(snap.week).toBe("2026-W17");
  });

  it("aggregates wins, losses, and draws correctly", () => {
    const matches = [
      makeMatch({ id: "1", uid: "a", myChampion: "Darius", result: "Win" }),
      makeMatch({ id: "2", uid: "a", myChampion: "Darius", result: "Win" }),
      makeMatch({ id: "3", uid: "b", myChampion: "Darius", result: "Loss" }),
      makeMatch({ id: "4", uid: "c", myChampion: "Jinx", result: "Draw" }),
    ];
    const snap = buildWeeklySnapshotFromMatches(matches, window);

    expect(snap.matchCount).toBe(4);
    expect(snap.uniquePlayers).toBe(3);

    const darius = snap.legends.find((l) => l.legend === "Darius");
    expect(darius).toBeDefined();
    expect(darius!.plays).toBe(3);
    expect(darius!.wins).toBe(2);
    expect(darius!.losses).toBe(1);
    expect(darius!.winRate).toBeCloseTo(2 / 3);

    const jinx = snap.legends.find((l) => l.legend === "Jinx");
    expect(jinx!.plays).toBe(1);
    expect(jinx!.draws).toBe(1);
    expect(jinx!.wins).toBe(0);
    expect(jinx!.losses).toBe(0);
  });

  it("groups decks by deckSourceKey when available, falls back to deckName", () => {
    const matches = [
      makeMatch({ id: "1", uid: "a", deckSourceKey: "k1", deckName: "Queens", result: "Win" }),
      makeMatch({ id: "2", uid: "b", deckSourceKey: "k1", deckName: "Queens", result: "Loss" }),
      makeMatch({ id: "3", uid: "c", deckSourceKey: "", deckName: "Homebrew", result: "Win" }),
    ];
    const snap = buildWeeklySnapshotFromMatches(matches, window);
    expect(snap.decks).toHaveLength(2);
    const queens = snap.decks.find((d) => d.deckKey === "k1");
    expect(queens!.plays).toBe(2);
    expect(queens!.wins).toBe(1);
    expect(queens!.losses).toBe(1);
  });

  it("returns legends sorted by play count", () => {
    const matches = [
      makeMatch({ id: "1", uid: "a", myChampion: "Jinx", result: "Win" }),
      makeMatch({ id: "2", uid: "b", myChampion: "Darius", result: "Win" }),
      makeMatch({ id: "3", uid: "c", myChampion: "Darius", result: "Win" }),
      makeMatch({ id: "4", uid: "d", myChampion: "Darius", result: "Win" }),
    ];
    const snap = buildWeeklySnapshotFromMatches(matches, window);
    expect(snap.legends[0].legend).toBe("Darius");
    expect(snap.legends[0].plays).toBe(3);
    expect(snap.legends[1].legend).toBe("Jinx");
  });

  it("computes per-battlefield win rate correctly", () => {
    const matches = [
      makeMatch({ id: "1", uid: "a", myBattlefield: "BF1", result: "Win" }),
      makeMatch({ id: "2", uid: "b", myBattlefield: "BF1", result: "Loss" }),
      makeMatch({ id: "3", uid: "c", myBattlefield: "BF1", result: "Loss" }),
    ];
    const snap = buildWeeklySnapshotFromMatches(matches, window);
    expect(snap.battlefields).toHaveLength(1);
    expect(snap.battlefields[0].picks).toBe(3);
    expect(snap.battlefields[0].wins).toBe(1);
    expect(snap.battlefields[0].winRate).toBeCloseTo(1 / 3);
  });

  it("ignores matches with unknown results for W/L, still counts plays", () => {
    const matches = [
      makeMatch({ id: "1", uid: "a", myChampion: "Darius", result: "???" }),
      makeMatch({ id: "2", uid: "b", myChampion: "Darius", result: "Win" }),
    ];
    const snap = buildWeeklySnapshotFromMatches(matches, window);
    const darius = snap.legends.find((l) => l.legend === "Darius")!;
    expect(darius.plays).toBe(2);
    expect(darius.wins).toBe(1);
    expect(darius.losses).toBe(0);
  });
});
