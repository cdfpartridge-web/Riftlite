import { describe, expect, it } from "vitest";

import {
  buildSearchPrefixes,
  buildUserAggregate,
  cleanDisplayName,
  cleanHandle,
  decodeMatches,
  encodeMatches,
  handleLower,
  normalizeAccountProfile,
  publicProfileFromAccount,
  validHandle,
} from "@/lib/social/server";
import type { CommunityMatch } from "@/lib/types";

function match(id: string, result: CommunityMatch["result"], myChampion: string, createdAt: number): CommunityMatch {
  return {
    id,
    uid: "uid-1",
    username: "BMU",
    date: "",
    result,
    myChampion,
    oppChampion: "Jinx",
    oppName: "Tester",
    fmt: "Bo1",
    score: "1-0",
    wentFirst: "Went 1st",
    myBattlefield: "The Papertree",
    oppBattlefield: "Sunken Temple",
    flags: "",
    games: [],
    deckName: "",
    deckSourceUrl: "",
    deckSourceKey: "",
    deckSnapshot: null,
    createdAt,
  };
}

describe("social profile helpers", () => {
  it("cleans and validates public handles without accepting unsafe characters", () => {
    expect(cleanHandle("@BMU Casts!!")).toBe("BMUCasts");
    expect(cleanHandle("abcdefghijklmnopqrstuvwxyzzz")).toHaveLength(24);
    expect(handleLower("BMU_Casts")).toBe("bmu_casts");
    expect(validHandle("BMU")).toBe(true);
    expect(validHandle("bmu-casts_01")).toBe(true);
    expect(validHandle("ab")).toBe(false);
    expect(validHandle("-bad")).toBe(false);
    expect(cleanDisplayName("  BMU    Casts  ")).toBe("BMU Casts");
  });

  it("builds searchable public profile docs only from opted-in account data", () => {
    const profile = normalizeAccountProfile("uid-1", {
      handle: "BMUCasts",
      displayName: "BMU Casts",
      publicProfile: true,
      searchable: true,
      showStats: true,
      showMatches: false,
      showDecks: false,
      showHubBadges: true,
      createdAt: 10,
      updatedAt: 20,
    });
    const publicProfile = publicProfileFromAccount(profile);

    expect(publicProfile.uid).toBe("uid-1");
    expect(publicProfile.handleLower).toBe("bmucasts");
    expect(publicProfile.searchable).toBe(true);
    expect(publicProfile.showMatches).toBe(false);
    expect(publicProfile.showHubBadges).toBe(true);
    expect(publicProfile.searchPrefixes).toEqual(expect.arrayContaining(["b", "bmu", "cas", "casts"]));
  });

  it("compresses public match windows and builds user aggregates without raw scans", () => {
    const profile = normalizeAccountProfile("uid-1", {
      handle: "BMUCasts",
      displayName: "BMU Casts",
    });
    const matches = [
      match("m1", "Win", "Vex", 3),
      match("m2", "Loss", "Vex", 2),
      match("m3", "Draw", "Annie", 1),
    ];
    const encoded = encodeMatches(matches);

    expect(decodeMatches(encoded)).toEqual(matches);
    expect(decodeMatches("not valid")).toEqual([]);

    const aggregate = buildUserAggregate(profile, matches);
    expect(aggregate.totalMatches).toBe(3);
    expect(aggregate.wins).toBe(1);
    expect(aggregate.losses).toBe(1);
    expect(aggregate.draws).toBe(1);
    expect(aggregate.winRate).toBe(50);
    expect(aggregate.topLegend).toBe("Vex");
    expect(aggregate.recentMatches).toHaveLength(3);
  });

  it("limits profile search prefixes so profile search stays cheap", () => {
    const prefixes = buildSearchPrefixes("NoVeggies Coaching", "Riftbound Coach");
    expect(prefixes).toEqual(expect.arrayContaining(["n", "no", "noveggies", "coach"]));
    expect(prefixes.length).toBeLessThanOrEqual(80);
  });
});
