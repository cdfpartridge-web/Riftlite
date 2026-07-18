import { describe, expect, it } from "vitest";

import {
  buildHubStats,
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
