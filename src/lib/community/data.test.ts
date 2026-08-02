import { describe, expect, it } from "vitest";

import {
  latestCommunityWindowFromThirtyDayRange,
  normalizeMatch,
} from "@/lib/community/data";
import { COMMUNITY_WINDOW_SIZE } from "@/lib/constants";
import type { CommunityMatch } from "@/lib/types";

describe("normalizeMatch", () => {
  it("preserves desktop camelCase per-game scores", () => {
    const match = normalizeMatch("m1", {
      uid: "u1",
      username: "BMU",
      platform: "Atlas",
      result: "Win",
      my_champion: "Pyke",
      opp_champion: "Fiora",
      fmt: "Bo1",
      score: "1-0",
      games_json: JSON.stringify([
        {
          gameNumber: 1,
          result: "Win",
          myPoints: 7,
          oppPoints: 3,
          myBattlefield: "Ripper's Bay",
          opponentBattlefield: "Sunken Temple",
          wentFirst: "1st",
        },
      ]),
    });

    expect(match.games).toEqual([
      {
        myBf: "Ripper's Bay",
        oppBf: "Sunken Temple",
        wentFirst: "1st",
        result: "Win",
        myPoints: 7,
        oppPoints: 3,
      },
    ]);
    expect(match.platform).toBe("atlas");
  });

  it("keeps legacy snake_case per-game scores", () => {
    const match = normalizeMatch("m2", {
      uid: "u2",
      username: "Crit",
      result: "Loss",
      games_json: JSON.stringify([
        {
          result: "Loss",
          my_points: 4,
          opp_points: 8,
          my_bf: "The Papertree",
          opp_bf: "Valley of Idols",
          went_first: "2nd",
        },
      ]),
    });

    expect(match.games[0]).toMatchObject({
      myBf: "The Papertree",
      oppBf: "Valley of Idols",
      wentFirst: "2nd",
      result: "Loss",
      myPoints: 4,
      oppPoints: 8,
    });
  });

  it("backfills stale single-game rows from match-level battlefield and seat fields", () => {
    const match = normalizeMatch("m3", {
      uid: "u3",
      username: "BMU",
      result: "Win",
      score: "1-0",
      my_battlefield: "Ripper's Bay",
      opp_battlefield: "Sunken Temple",
      went_first: "1st",
      games_json: JSON.stringify([{ result: "Win", myPoints: 0, oppPoints: 0 }]),
    });

    expect(match.games[0]).toMatchObject({
      myBf: "Ripper's Bay",
      oppBf: "Sunken Temple",
      wentFirst: "1st",
      result: "Win",
      myPoints: 0,
      oppPoints: 0,
    });
  });

  it("repairs cached camelCase aggregate rows without losing match-level fields", () => {
    const match = normalizeMatch("m4", {
      uid: "u4",
      username: "BMU",
      result: "Loss",
      myChampion: "Pyke",
      oppChampion: "Lillia",
      oppName: "Theodore",
      fmt: "Bo1",
      score: "0-1",
      myBattlefield: "Ripper's Bay",
      oppBattlefield: "Seat of Power",
      wentFirst: "1st",
      games: [{ result: "Loss", myPoints: 0, oppPoints: 0, myBf: "", oppBf: "" }],
      deckName: "pyke v2",
      createdAt: 1778054556,
    });

    expect(match.myChampion).toBe("Pyke");
    expect(match.oppName).toBe("Theodore");
    expect(match.games[0]).toMatchObject({
      myBf: "Ripper's Bay",
      oppBf: "Seat of Power",
      wentFirst: "1st",
    });
  });

  it("normalizes manual combine repair metadata", () => {
    const match = normalizeMatch("m5", {
      uid: "u5",
      username: "BMU",
      result: "Win",
      manual_repair: true,
      combined_from_match_ids: ["g1", "g2"],
      merged_into_match_id: "bo3",
      superseded: "true",
      superseded_at: "2026-05-31T12:00:00.000Z",
    });

    expect(match.manualRepair).toBe(true);
    expect(match.combinedFromMatchIds).toEqual(["g1", "g2"]);
    expect(match.mergedIntoMatchId).toBe("bo3");
    expect(match.superseded).toBe(true);
    expect(match.supersededAt).toBe("2026-05-31T12:00:00.000Z");
  });

  it("never copies private-hub Web Replay pointers into public aggregates", () => {
    const match = normalizeMatch("public-match", {
      uid: "public-player",
      username: "Public Player",
      result: "Win",
      web_replay_id: `rl2_${"f".repeat(32)}`,
      webReplayId: `rl2_${"e".repeat(32)}`,
    });

    expect(match).not.toHaveProperty("web_replay_id");
    expect(match).not.toHaveProperty("webReplayId");
  });
});

describe("latestCommunityWindowFromThirtyDayRange", () => {
  it("reuses a complete busy 30-day range in newest-first order", () => {
    const matches = Array.from({ length: COMMUNITY_WINDOW_SIZE + 1 }, (_, index) => ({
      id: `match-${index}`,
      createdAt: 1_000_000 + index,
    })) as CommunityMatch[];

    const latest = latestCommunityWindowFromThirtyDayRange(matches);

    expect(latest).toHaveLength(COMMUNITY_WINDOW_SIZE);
    expect(latest?.[0]?.id).toBe(`match-${COMMUNITY_WINDOW_SIZE}`);
    expect(latest?.at(-1)?.id).toBe("match-1");
  });

  it("keeps the separate latest query for quieter 30-day ranges", () => {
    const matches = Array.from({ length: COMMUNITY_WINDOW_SIZE - 1 }, (_, index) => ({
      id: `match-${index}`,
      createdAt: index,
    })) as CommunityMatch[];

    expect(latestCommunityWindowFromThirtyDayRange(matches)).toBeNull();
  });
});
