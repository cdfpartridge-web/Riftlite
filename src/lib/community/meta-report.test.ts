import { describe, expect, it } from "vitest";

import { buildMetaReport } from "@/lib/community/meta-report";
import type { WeeklySnapshot } from "@/lib/community/weekly-snapshot";

function makeSnapshot(over: Partial<WeeklySnapshot> = {}): WeeklySnapshot {
  return {
    week: "2026-W17",
    year: 2026,
    weekNumber: 17,
    startMs: new Date("2026-04-20T00:00:00Z").getTime(),
    endMs: new Date("2026-04-27T00:00:00Z").getTime(),
    matchCount: 50,
    uniquePlayers: 10,
    legends: [
      { legend: "Darius", plays: 20, wins: 12, losses: 8, draws: 0, winRate: 0.6 },
      { legend: "Jinx", plays: 15, wins: 6, losses: 9, draws: 0, winRate: 0.4 },
      { legend: "Ahri", plays: 10, wins: 5, losses: 5, draws: 0, winRate: 0.5 },
      { legend: "Viktor", plays: 3, wins: 2, losses: 1, draws: 0, winRate: 2 / 3 },
    ],
    decks: [
      {
        deckKey: "darius-queens",
        deckName: "Darius Queens",
        legend: "Darius",
        plays: 15,
        wins: 10,
        losses: 5,
        draws: 0,
        winRate: 10 / 15,
      },
      {
        deckKey: "jinx-burn",
        deckName: "Jinx Burn",
        legend: "Jinx",
        plays: 10,
        wins: 4,
        losses: 6,
        draws: 0,
        winRate: 0.4,
      },
    ],
    players: [
      { uid: "u1", username: "Alice", plays: 15, wins: 10, losses: 5, winRate: 10 / 15 },
      { uid: "u2", username: "Bob", plays: 8, wins: 6, losses: 2, winRate: 0.75 },
      { uid: "u3", username: "Cara", plays: 4, wins: 4, losses: 0, winRate: 1 },
    ],
    battlefields: [
      { name: "Piltover", picks: 25, wins: 14, winRate: 14 / 25 },
    ],
    createdAt: Date.now(),
    ...over,
  };
}

describe("buildMetaReport", () => {
  it("uses a low-data template when the week has too few matches", () => {
    const report = buildMetaReport(makeSnapshot({ matchCount: 3 }), null);
    expect(report.title).toContain("Weekly Meta Report");
    expect(report.body.some((b) => b.children[0].text.includes("Quiet week"))).toBe(true);
    expect(report.excerpt).toContain("3 matches");
  });

  it("produces a full-body report when data is sufficient", () => {
    const report = buildMetaReport(makeSnapshot(), null);
    expect(report.body.length).toBeGreaterThan(5);
    const headings = report.body.filter((b) => b.style === "h2").map((b) => b.children[0].text);
    expect(headings).toContain("Legend meta");
    expect(headings).toContain("Deck spotlight");
    expect(headings).toContain("Player spotlight");
  });

  it("includes the top legend in the excerpt", () => {
    const report = buildMetaReport(makeSnapshot(), null);
    expect(report.excerpt).toContain("Darius");
  });

  it("hides win rate for legends with fewer than 5 games", () => {
    const report = buildMetaReport(makeSnapshot(), null);
    const viktorBullet = report.body.find((b) =>
      b.children.some((c) => c.text.includes("Viktor")),
    );
    expect(viktorBullet).toBeDefined();
    const text = viktorBullet!.children.map((c) => c.text).join("");
    expect(text).toContain("sample too small");
  });

  it("surfaces a biggest-riser paragraph when weeks differ", () => {
    const last = makeSnapshot({
      legends: [
        { legend: "Darius", plays: 20, wins: 8, losses: 12, draws: 0, winRate: 0.4 },
        { legend: "Jinx", plays: 15, wins: 9, losses: 6, draws: 0, winRate: 0.6 },
      ],
    });
    const report = buildMetaReport(makeSnapshot(), last);
    const riserBlock = report.body.find((b) =>
      b.children.some((c) => c.text.toLowerCase().includes("biggest riser")),
    );
    expect(riserBlock).toBeDefined();
    const text = riserBlock!.children.map((c) => c.text).join("");
    expect(text).toContain("Darius");
  });

  it("flags a breakout deck that didn't exist last week", () => {
    const last = makeSnapshot({
      decks: [
        {
          deckKey: "jinx-burn",
          deckName: "Jinx Burn",
          legend: "Jinx",
          plays: 10,
          wins: 4,
          losses: 6,
          draws: 0,
          winRate: 0.4,
        },
      ],
    });
    const report = buildMetaReport(makeSnapshot(), last);
    const breakoutBlock = report.body.find((b) =>
      b.children.some((c) => c.text.toLowerCase().includes("breakout")),
    );
    expect(breakoutBlock).toBeDefined();
    const text = breakoutBlock!.children.map((c) => c.text).join("");
    expect(text).toContain("Darius Queens");
  });

  it("produces a stable slug derived from the ISO week", () => {
    const report = buildMetaReport(makeSnapshot(), null);
    expect(report.slug).toBe("meta-report-2026-w17");
  });

  it("tags include the week id so articles can be filtered", () => {
    const report = buildMetaReport(makeSnapshot(), null);
    expect(report.tags).toContain("meta-report");
    expect(report.tags).toContain("2026-W17");
  });

  it("handles a week with zero prior data gracefully", () => {
    const report = buildMetaReport(makeSnapshot(), null);
    // Shouldn't contain "vs last week" phrases when there's no prior.
    const hasVsLastWeek = report.body.some((b) =>
      b.children.some((c) => c.text.includes("vs last week")),
    );
    expect(hasVsLastWeek).toBe(false);
  });
});
