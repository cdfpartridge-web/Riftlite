import { describe, expect, it } from "vitest";

import { deckGroupKey } from "@/lib/community/aggregate";
import {
  buildDeckComparison,
  buildLegendProfile,
  buildPlayerProfile,
  buildWeeklyTrend,
  listPlayerNames,
} from "@/lib/community/profiles";
import type { CommunityMatch, DeckSnapshot } from "@/lib/types";

type SeedMatch = Partial<CommunityMatch> & {
  myChampion: string;
  oppChampion: string;
  result: "Win" | "Loss" | "Draw";
};

function makeMatch(
  index: number,
  createdAt: number,
  seed: SeedMatch,
): CommunityMatch {
  return {
    id: `m${index}`,
    uid: `u${index}`,
    username: seed.username ?? `player${index}`,
    date: seed.date ?? "",
    result: seed.result,
    myChampion: seed.myChampion,
    oppChampion: seed.oppChampion,
    oppName: seed.oppName ?? "",
    fmt: seed.fmt ?? "",
    score: seed.score ?? "",
    wentFirst: seed.wentFirst ?? "",
    myBattlefield: seed.myBattlefield ?? "",
    oppBattlefield: seed.oppBattlefield ?? "",
    flags: seed.flags ?? "",
    games: seed.games ?? [],
    deckName: seed.deckName ?? "",
    deckSourceUrl: seed.deckSourceUrl ?? "",
    deckSourceKey: seed.deckSourceKey ?? "",
    deckSnapshot: seed.deckSnapshot ?? null,
    createdAt,
  };
}

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

describe("buildWeeklyTrend", () => {
  it("bucket count always matches requested weeks and oldest bucket comes first", () => {
    const now = new Date("2026-04-01T00:00:00Z").getTime();
    const buckets = buildWeeklyTrend([], 8, now);
    expect(buckets).toHaveLength(8);
    for (let i = 0; i < buckets.length - 1; i += 1) {
      expect(buckets[i].startMs).toBeLessThan(buckets[i + 1].startMs);
    }
    for (const b of buckets) {
      expect(b.games).toBe(0);
      expect(b.winRate).toBe(0);
    }
  });

  it("drops matches older than the window and keeps recent ones in the right bucket", () => {
    const now = new Date("2026-04-01T00:00:00Z").getTime();
    const matches: CommunityMatch[] = [
      // 0.5 weeks old → last bucket
      makeMatch(1, now - 0.5 * WEEK, {
        myChampion: "Ahri",
        oppChampion: "Jinx",
        result: "Win",
      }),
      // 2.5 weeks old → 6th bucket (index 5)
      makeMatch(2, now - 2.5 * WEEK, {
        myChampion: "Ahri",
        oppChampion: "Jinx",
        result: "Loss",
      }),
      // 9 weeks old → beyond window, ignored
      makeMatch(3, now - 9 * WEEK, {
        myChampion: "Ahri",
        oppChampion: "Jinx",
        result: "Win",
      }),
    ];

    const buckets = buildWeeklyTrend(matches, 8, now);
    const totalGames = buckets.reduce((acc, b) => acc + b.games, 0);
    expect(totalGames).toBe(2);
    expect(buckets[7].wins).toBe(1);
    expect(buckets[5].losses).toBe(1);
  });
});

describe("listPlayerNames", () => {
  it("returns unique names sorted case-insensitively", () => {
    const matches: CommunityMatch[] = [
      makeMatch(1, 1, {
        myChampion: "Ahri",
        oppChampion: "Jinx",
        result: "Win",
        username: "zelda",
      }),
      makeMatch(2, 2, {
        myChampion: "Ahri",
        oppChampion: "Jinx",
        result: "Win",
        username: "Ada",
      }),
      makeMatch(3, 3, {
        myChampion: "Ahri",
        oppChampion: "Jinx",
        result: "Win",
        username: "zelda",
      }),
      makeMatch(4, 4, {
        myChampion: "Ahri",
        oppChampion: "Jinx",
        result: "Win",
        username: "   ",
      }),
    ];
    const names = listPlayerNames(matches);
    expect(names).toEqual(["Ada", "zelda"]);
  });
});

describe("buildPlayerProfile", () => {
  it("returns null when the username is blank or unknown", () => {
    const matches: CommunityMatch[] = [
      makeMatch(1, 1, {
        myChampion: "Ahri",
        oppChampion: "Jinx",
        result: "Win",
        username: "alice",
      }),
    ];
    expect(buildPlayerProfile(matches, "")).toBeNull();
    expect(buildPlayerProfile(matches, "ghost")).toBeNull();
  });

  it("aggregates favourites, matchups, and streak with case-insensitive matching", () => {
    const now = new Date("2026-04-01T00:00:00Z").getTime();
    const matches: CommunityMatch[] = [];

    // ALICE — 4 Ahri vs Jinx wins (creates a best matchup once >=3 games)
    for (let i = 0; i < 4; i += 1) {
      matches.push(
        makeMatch(i, now - (10 - i) * DAY, {
          myChampion: "Ahri",
          oppChampion: "Jinx",
          result: "Win",
          username: i === 0 ? "Alice" : "alice",
        }),
      );
    }
    // ALICE — 4 Ahri vs Garen losses (worst matchup)
    for (let i = 0; i < 4; i += 1) {
      matches.push(
        makeMatch(100 + i, now - (5 - i) * DAY, {
          myChampion: "Ahri",
          oppChampion: "Garen",
          result: "Loss",
          username: "alice",
        }),
      );
    }
    // ALICE — 2 Darius games (favourite #2)
    for (let i = 0; i < 2; i += 1) {
      matches.push(
        makeMatch(200 + i, now - (2 - i) * DAY, {
          myChampion: "Darius",
          oppChampion: "Jinx",
          result: "Win",
          username: "alice",
        }),
      );
    }

    // Unrelated player
    matches.push(
      makeMatch(999, now, {
        myChampion: "Teemo",
        oppChampion: "Fiora",
        result: "Win",
        username: "bob",
      }),
    );

    const profile = buildPlayerProfile(matches, "alice", now);
    expect(profile).not.toBeNull();
    expect(profile!.player).toBe("alice");
    expect(profile!.games).toBe(10);
    expect(profile!.wins).toBe(6);
    expect(profile!.losses).toBe(4);

    // Favourites: Ahri (8 games) should lead Darius (2 games).
    expect(profile!.favouriteLegends[0].legend).toBe("Ahri");
    expect(profile!.favouriteLegends[0].games).toBe(8);

    // Best matchup: Ahri vs Jinx (100%), Worst: Ahri vs Garen (0%).
    expect(profile!.bestMatchups[0]).toMatchObject({
      myLegend: "Ahri",
      oppLegend: "Jinx",
      winRate: 100,
    });
    expect(profile!.worstMatchups[0]).toMatchObject({
      myLegend: "Ahri",
      oppLegend: "Garen",
      winRate: 0,
    });

    // Most recent Alice match is a Darius win, so the streak should be W and >= 1.
    expect(profile!.currentStreak.type).toBe("W");
    expect(profile!.currentStreak.length).toBeGreaterThanOrEqual(1);

    // Recent matches are capped and sorted newest-first.
    expect(profile!.recentMatches.length).toBeLessThanOrEqual(20);
    for (let i = 0; i < profile!.recentMatches.length - 1; i += 1) {
      expect(profile!.recentMatches[i].createdAt).toBeGreaterThanOrEqual(
        profile!.recentMatches[i + 1].createdAt,
      );
    }
  });
});

describe("buildLegendProfile", () => {
  it("returns null for a legend not in the LEGENDS constant", () => {
    expect(buildLegendProfile([], "Not-A-Real-Legend")).toBeNull();
    expect(buildLegendProfile([], "")).toBeNull();
  });

  it("returns a sparse profile with zero games when no matches feature the legend", () => {
    const now = new Date("2026-04-01T00:00:00Z").getTime();
    const matches: CommunityMatch[] = [
      makeMatch(1, now - DAY, {
        myChampion: "Teemo",
        oppChampion: "Fiora",
        result: "Win",
      }),
    ];
    const profile = buildLegendProfile(matches, "Ahri", now);
    expect(profile).not.toBeNull();
    expect(profile!.games).toBe(0);
    expect(profile!.totalMatches).toBe(1);
    expect(profile!.playRate).toBe(0);
    expect(profile!.playRateTrend).toHaveLength(8);
  });

  it("aggregates matchups, battlefields, and play rate for a real legend", () => {
    const now = new Date("2026-04-01T00:00:00Z").getTime();
    const matches: CommunityMatch[] = [];

    // 5 Ahri vs Jinx (3W/2L) — qualifies for matchup table
    for (let i = 0; i < 3; i += 1) {
      matches.push(
        makeMatch(i, now - (10 - i) * DAY, {
          myChampion: "Ahri",
          oppChampion: "Jinx",
          result: "Win",
          myBattlefield: "Summoner's Rift",
          oppBattlefield: "Howling Abyss",
        }),
      );
    }
    for (let i = 0; i < 2; i += 1) {
      matches.push(
        makeMatch(10 + i, now - (6 - i) * DAY, {
          myChampion: "Ahri",
          oppChampion: "Jinx",
          result: "Loss",
          myBattlefield: "Summoner's Rift",
          oppBattlefield: "Howling Abyss",
        }),
      );
    }

    // 3 Ahri vs Garen (all wins) — best matchup
    for (let i = 0; i < 3; i += 1) {
      matches.push(
        makeMatch(20 + i, now - (4 - i) * DAY, {
          myChampion: "Ahri",
          oppChampion: "Garen",
          result: "Win",
          myBattlefield: "Summoner's Rift",
        }),
      );
    }

    // Filler from other legends so play rate < 100%
    for (let i = 0; i < 11; i += 1) {
      matches.push(
        makeMatch(100 + i, now - (11 - i) * DAY, {
          myChampion: "Teemo",
          oppChampion: "Fiora",
          result: "Win",
        }),
      );
    }

    const profile = buildLegendProfile(matches, "Ahri", now);
    expect(profile).not.toBeNull();
    expect(profile!.games).toBe(8);
    expect(profile!.wins).toBe(6);
    expect(profile!.losses).toBe(2);
    expect(profile!.totalMatches).toBe(19);
    expect(profile!.playRate).toBeCloseTo(Number(((8 / 19) * 100).toFixed(1)));

    // Best matchup = Garen (100%), worst = Jinx (60%)
    expect(profile!.bestMatchups[0]?.oppLegend).toBe("Garen");
    expect(profile!.worstMatchups[0]?.oppLegend).toBe("Jinx");

    // Battlefield rows need >=3 games — Summoner's Rift has 8, Howling Abyss 5.
    const myBfs = profile!.myBattlefields.map((b) => b.battlefield);
    expect(myBfs).toContain("Summoner's Rift");
    const oppBfs = profile!.oppBattlefields.map((b) => b.battlefield);
    expect(oppBfs).toContain("Howling Abyss");

    // Play rate trend has 8 buckets and entries are percentages (0..100).
    expect(profile!.playRateTrend).toHaveLength(8);
    for (const b of profile!.playRateTrend) {
      expect(b.winRate).toBeGreaterThanOrEqual(0);
      expect(b.winRate).toBeLessThanOrEqual(100);
    }
  });
});

describe("buildDeckComparison", () => {
  function snapshot(
    legend: string,
    main: Array<{ name: string; qty: number; cardId?: string }>,
  ): DeckSnapshot {
    return {
      legend,
      legendKey: legend.toLowerCase(),
      runes: [],
      battlefields: [],
      sideboard: [],
      mainDeck: main.map((e) => ({ ...e })),
      legendEntry: { name: legend, qty: 1, cardId: `legend:${legend}` },
    };
  }

  function seed(
    count: number,
    start: number,
    seedData: {
      myChampion: string;
      oppChampion: string;
      result: "Win" | "Loss" | "Draw";
      deckSourceKey: string;
      deckSnapshot: DeckSnapshot;
      username: string;
    },
  ): CommunityMatch[] {
    return Array.from({ length: count }, (_, i) =>
      makeMatch(start + i, start + i, seedData),
    );
  }

  it("returns null when the two keys are blank, equal, or unknown", () => {
    expect(buildDeckComparison([], "", "x")).toBeNull();
    expect(buildDeckComparison([], "x", "x")).toBeNull();
    expect(buildDeckComparison([], "unknown-a", "unknown-b")).toBeNull();
  });

  it("diffs snapshots and surfaces shared matchups with per-side win rates", () => {
    const snapA = snapshot("Ahri", [
      { name: "Spellthief", qty: 3, cardId: "st" },
      { name: "Mana Gem", qty: 2, cardId: "mg" },
    ]);
    const snapB = snapshot("Ahri", [
      { name: "Spellthief", qty: 2, cardId: "st" },
      { name: "Sword", qty: 3, cardId: "sw" },
    ]);

    const matches: CommunityMatch[] = [];
    // Deck A (vs Jinx: 3W/1L)
    matches.push(
      ...seed(3, 0, {
        myChampion: "Ahri",
        oppChampion: "Jinx",
        result: "Win",
        deckSourceKey: "deck-a",
        deckSnapshot: snapA,
        username: "alice",
      }),
    );
    matches.push(
      ...seed(1, 100, {
        myChampion: "Ahri",
        oppChampion: "Jinx",
        result: "Loss",
        deckSourceKey: "deck-a",
        deckSnapshot: snapA,
        username: "alice",
      }),
    );
    // Deck B (vs Jinx: 1W/3L)
    matches.push(
      ...seed(1, 200, {
        myChampion: "Ahri",
        oppChampion: "Jinx",
        result: "Win",
        deckSourceKey: "deck-b",
        deckSnapshot: snapB,
        username: "bob",
      }),
    );
    matches.push(
      ...seed(3, 300, {
        myChampion: "Ahri",
        oppChampion: "Jinx",
        result: "Loss",
        deckSourceKey: "deck-b",
        deckSnapshot: snapB,
        username: "bob",
      }),
    );

    const keyA = deckGroupKey(matches[0]);
    const keyB = deckGroupKey(matches[matches.length - 1]);
    expect(keyA).not.toBe(keyB);

    const comparison = buildDeckComparison(matches, keyA, keyB);
    expect(comparison).not.toBeNull();
    const { cardDiff, sharedMatchups, aMatches, bMatches } = comparison!;

    expect(aMatches).toHaveLength(4);
    expect(bMatches).toHaveLength(4);

    // Card diff: Mana Gem only in A, Sword only in B, Spellthief shared.
    expect(cardDiff).not.toBeNull();
    const onlyANames = cardDiff!.onlyA.map((e) => e.name);
    const onlyBNames = cardDiff!.onlyB.map((e) => e.name);
    const sharedNames = cardDiff!.shared.map((s) => s.name);
    expect(onlyANames).toContain("Mana Gem");
    expect(onlyBNames).toContain("Sword");
    expect(sharedNames).toContain("Spellthief");

    const sharedSpell = cardDiff!.shared.find((s) => s.name === "Spellthief")!;
    expect(sharedSpell.qtyA).toBe(3);
    expect(sharedSpell.qtyB).toBe(2);

    // Shared matchup vs Jinx has 8 combined games → passes >=3 threshold.
    const jinxRow = sharedMatchups.find((r) => r.oppLegend === "Jinx");
    expect(jinxRow).toBeDefined();
    expect(jinxRow!.aGames).toBe(4);
    expect(jinxRow!.bGames).toBe(4);
    expect(jinxRow!.aWinRate).toBe(75);
    expect(jinxRow!.bWinRate).toBe(25);
  });
});
