import { describe, expect, it } from "vitest";

import { buildCommunityMetaAlerts } from "@/lib/community/meta-alerts";
import type { CommunityMatch } from "@/lib/types";

// Build a synthetic window of matches designed to exercise each of the three
// alert types ported from community_panel.py::build_community_meta_alerts.

type SeedMatch = Partial<CommunityMatch> & {
  myChampion: string;
  oppChampion: string;
  result: "Win" | "Loss" | "Draw";
};

function makeMatch(index: number, createdAt: number, seed: SeedMatch): CommunityMatch {
  return {
    id: `m${index}`,
    uid: `u${index}`,
    username: `player${index}`,
    date: "",
    result: seed.result,
    myChampion: seed.myChampion,
    oppChampion: seed.oppChampion,
    oppName: "",
    fmt: "",
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
    createdAt,
  };
}

function repeat<T>(count: number, fn: (i: number) => T): T[] {
  return Array.from({ length: count }, (_, i) => fn(i));
}

describe("buildCommunityMetaAlerts", () => {
  it("returns no alerts when the window is too small", () => {
    const matches = repeat(40, (i) =>
      makeMatch(i, i, { myChampion: "Ahri", oppChampion: "Jinx", result: "Win" }),
    );
    expect(buildCommunityMetaAlerts(matches)).toEqual([]);
  });

  it("flags a legend rising in usage and a legend cooling off", () => {
    // Window size = floor(160/2) = 80, which is >= META_ALERT_MIN_WINDOW (40).
    // Recent half (createdAt 80..159): Ahri appears 24x, Jinx 8x.
    // Previous half (createdAt 0..79): Ahri appears 4x, Jinx 40x.
    // That's usage +25% for Ahri (rising) and -40% for Jinx (slipping).
    const matches: CommunityMatch[] = [];
    let idx = 0;

    // --- PREVIOUS WINDOW (earlier timestamps) ---
    for (let i = 0; i < 40; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Jinx", oppChampion: "Garen", result: "Win" }),
      );
    }
    for (let i = 0; i < 4; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Ahri", oppChampion: "Garen", result: "Win" }),
      );
    }
    for (let i = 0; i < 36; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Garen", oppChampion: "Darius", result: "Win" }),
      );
    }

    // --- RECENT WINDOW (later timestamps) ---
    for (let i = 0; i < 24; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Ahri", oppChampion: "Garen", result: "Win" }),
      );
    }
    for (let i = 0; i < 8; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Jinx", oppChampion: "Garen", result: "Win" }),
      );
    }
    for (let i = 0; i < 48; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Garen", oppChampion: "Darius", result: "Win" }),
      );
    }

    const alerts = buildCommunityMetaAlerts(matches);
    const ahriAlert = alerts.find((a) => a.dedupe === "legend:Ahri");
    const jinxAlert = alerts.find((a) => a.dedupe === "legend:Jinx");

    expect(ahriAlert).toBeDefined();
    expect(ahriAlert?.tone).toBe("up");
    expect(ahriAlert?.title).toContain("rising");

    expect(jinxAlert).toBeDefined();
    expect(jinxAlert?.tone).toBe("down");
    expect(jinxAlert?.title).toContain("slipping");
  });

  it("caps the result at four alerts and sorts by score", () => {
    const matches: CommunityMatch[] = [];
    let idx = 0;

    const risers = ["Ahri", "Darius", "Ezreal", "Fiora", "Garen"];

    // Previous window: heavy Jinx usage so every riser has a clean delta.
    for (let i = 0; i < 80; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Jinx", oppChampion: "Teemo", result: "Win" }),
      );
    }

    // Recent window: five risers share usage, plus filler so the window fills.
    for (const champ of risers) {
      for (let i = 0; i < 14; i += 1) {
        matches.push(
          makeMatch(idx++, idx, { myChampion: champ, oppChampion: "Teemo", result: "Win" }),
        );
      }
    }
    for (let i = 0; i < 10; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Jinx", oppChampion: "Teemo", result: "Win" }),
      );
    }

    const alerts = buildCommunityMetaAlerts(matches);
    expect(alerts.length).toBeLessThanOrEqual(4);
    for (let i = 0; i < alerts.length - 1; i += 1) {
      expect(alerts[i].score).toBeGreaterThanOrEqual(alerts[i + 1].score);
    }
  });

  it("dedupes by legend so usage and win-rate alerts don't both fire for the same champ", () => {
    const matches: CommunityMatch[] = [];
    let idx = 0;

    // Previous: Ahri 4x all losses, plus filler.
    for (let i = 0; i < 4; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Ahri", oppChampion: "Jinx", result: "Loss" }),
      );
    }
    for (let i = 0; i < 76; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Garen", oppChampion: "Darius", result: "Win" }),
      );
    }

    // Recent: Ahri 24x, all wins -> huge usage AND win-rate swing.
    for (let i = 0; i < 24; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Ahri", oppChampion: "Jinx", result: "Win" }),
      );
    }
    for (let i = 0; i < 56; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Garen", oppChampion: "Darius", result: "Win" }),
      );
    }

    const alerts = buildCommunityMetaAlerts(matches);
    const ahriAlerts = alerts.filter((a) => a.dedupe === "legend:Ahri");
    expect(ahriAlerts).toHaveLength(1);
  });

  it("flags a matchup trending up when pairing win rate shifts far enough", () => {
    const matches: CommunityMatch[] = [];
    let idx = 0;

    // Previous: Ahri vs Jinx goes 2-10.
    for (let i = 0; i < 2; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Ahri", oppChampion: "Jinx", result: "Win" }),
      );
    }
    for (let i = 0; i < 10; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Ahri", oppChampion: "Jinx", result: "Loss" }),
      );
    }
    for (let i = 0; i < 68; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Garen", oppChampion: "Darius", result: "Win" }),
      );
    }

    // Recent: Ahri vs Jinx goes 10-2.
    for (let i = 0; i < 10; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Ahri", oppChampion: "Jinx", result: "Win" }),
      );
    }
    for (let i = 0; i < 2; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Ahri", oppChampion: "Jinx", result: "Loss" }),
      );
    }
    for (let i = 0; i < 68; i += 1) {
      matches.push(
        makeMatch(idx++, idx, { myChampion: "Garen", oppChampion: "Darius", result: "Win" }),
      );
    }

    const alerts = buildCommunityMetaAlerts(matches);
    const matchupAlert = alerts.find((a) => a.dedupe === "matchup:Ahri:Jinx");
    expect(matchupAlert).toBeDefined();
    expect(matchupAlert?.tone).toBe("up");
    expect(matchupAlert?.title).toContain("Ahri into Jinx");
    expect(matchupAlert?.metric).toContain("Matchup");
  });
});
