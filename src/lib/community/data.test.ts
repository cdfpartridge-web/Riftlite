import { describe, expect, it } from "vitest";

import { normalizeMatch } from "@/lib/community/data";

describe("normalizeMatch", () => {
  it("preserves desktop camelCase per-game scores", () => {
    const match = normalizeMatch("m1", {
      uid: "u1",
      username: "BMU",
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
});
