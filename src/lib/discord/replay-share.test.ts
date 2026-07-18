import { describe, expect, it } from "vitest";

import {
  discordDeckLegendFromSnapshot,
  discordReplayReportChannelId,
  formatDiscordReplayPost,
  isDiscordReplayResultResolved,
  summarizeReplayForDiscord,
  verifiedPiltoverDeckUrl,
} from "@/lib/discord/replay-share";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";

describe("Discord replay sharing", () => {
  it("routes replay links only to reports_channel", () => {
    expect(discordReplayReportChannelId({ reportsChannelId: " reports-123 " })).toBe("reports-123");
    expect(discordReplayReportChannelId({ reportsChannelId: "", feedChannelId: "feed-123" } as {
      reportsChannelId?: unknown;
    })).toBe("");
  });

  it("formats perspective-first BO3 players, legends, score, and an unlisted link", () => {
    const replay = fixture();
    const summary = summarizeReplayForDiscord(replay);
    expect(summary).toEqual({
      players: ["BMU", "Ceddidulli"],
      legends: ["Akali", "Akali"],
      format: "BO3",
      score: "2-0",
    });
    expect(formatDiscordReplayPost(summary, "https://www.riftlite.com/replays/rl2_test")).toBe([
      "**BMU vs Ceddidulli**",
      "Akali vs Akali • BO3 • Score 2\\-0",
      "Watch the unlisted replay: https://www.riftlite.com/replays/rl2_test",
    ].join("\n"));
  });

  it("suppresses user-authored mention syntax", () => {
    const message = formatDiscordReplayPost({
      players: ["@everyone", "Player_2"],
      legends: ["Akali", "Annie"],
      format: "BO1",
      score: "7-5",
    }, "https://www.riftlite.com/replays/rl2_test");
    expect(message).not.toContain("@everyone");
    expect(message).toContain("＠everyone");
  });

  it("links a verified Piltover active deck when its normalized Legend matches the captured player", () => {
    const summary = summarizeReplayForDiscord(fixture(), {
      title: "Akali [Tempo] @team",
      legend: "Rogue Assassin",
      sourceUrl: "https://www.piltoverarchive.com/decks/view/11111111-1111-4111-8111-111111111111?ref=private",
    });

    expect(summary.activeDeck).toEqual({
      title: "Akali [Tempo] @team",
      url: "https://piltoverarchive.com/decks/view/11111111-1111-4111-8111-111111111111",
    });
    const message = formatDiscordReplayPost(summary, "https://www.riftlite.com/replays/rl2_test");
    expect(message).toContain(
      "Active deck: [Akali \\[Tempo\\] ＠team](https://piltoverarchive.com/decks/view/11111111-1111-4111-8111-111111111111)",
    );
  });

  it("omits a deck link when the Legend differs or the source is not a verified Piltover deck URL", () => {
    expect(summarizeReplayForDiscord(fixture(), {
      title: "Ahri Control",
      legend: "Ahri",
      sourceUrl: "https://piltoverarchive.com/decks/view/11111111-1111-4111-8111-111111111111",
    }).activeDeck).toBeUndefined();
    expect(summarizeReplayForDiscord(fixture(), {
      title: "Akali Control",
      legend: "Akali",
      sourceUrl: "https://piltoverarchive.example/decks/view/11111111-1111-4111-8111-111111111111",
    }).activeDeck).toBeUndefined();
  });

  it("reads only the deck Legend identity from a saved snapshot and strictly validates Piltover links", () => {
    expect(discordDeckLegendFromSnapshot(JSON.stringify({ legend_key: "Akali" }))).toBe("Akali");
    expect(discordDeckLegendFromSnapshot({ legendEntry: { name: "Akali, Rogue Assassin" } })).toBe("Akali, Rogue Assassin");
    expect(discordDeckLegendFromSnapshot("not-json")).toBe("");
    expect(verifiedPiltoverDeckUrl("http://piltoverarchive.com/decks/view/11111111-1111-4111-8111-111111111111")).toBe("");
    expect(verifiedPiltoverDeckUrl("https://piltoverarchive.com.evil.example/decks/view/11111111-1111-4111-8111-111111111111")).toBe("");
    expect(verifiedPiltoverDeckUrl("https://piltoverarchive.com/decks/view/not-a-uuid")).toBe("");
  });
  it("uses the BO1 match result instead of tied board points after a concession", () => {
    const replay = fixture();
    const game = replay.series.games[0]!;
    replay.series.format = "bo1";
    replay.series.bestOf = 1;
    replay.series.games = [{
      ...game,
      result: {
        resultEventId: "r1",
        winnerPlayerId: "self",
        finalScores: { self: 4, opp: 4 },
      },
    }];

    expect(summarizeReplayForDiscord(replay).score).toBe("1-0");
  });

  it("keeps unresolved and partially scored matches out of Discord", () => {
    const replay = fixture();
    replay.series.games = [replay.series.games[0]!];

    expect(summarizeReplayForDiscord(replay).score).toBe("Pending");
    expect(isDiscordReplayResultResolved(replay)).toBe(false);
  });

  it("uses the completed desktop series score when individual game metadata is incomplete", () => {
    const replay = fixture();
    replay.series.games = [replay.series.games[0]!];
    replay.series.result = {
      resultEventId: "series-result",
      source: "desktop_match_metadata",
      outcome: "win",
      winnerPlayerId: "self",
      loserPlayerId: "opp",
      finalScores: { self: 2, opp: 0 },
    };

    expect(summarizeReplayForDiscord(replay).score).toBe("2-0");
    expect(isDiscordReplayResultResolved(replay)).toBe(true);
  });
});

function fixture(): CanonicalReplayV2 {
  const players = {
    self: { id: "self", name: "BMU", fields: {}, boardFields: {}, zones: { legend: [{ id: "l1", name: "Akali, Assassin", source: "legend", fields: {} }] } },
    opp: { id: "opp", name: "Ceddidulli", fields: {}, boardFields: {}, zones: { legend: [{ id: "l2", name: "Akali, Shadow", source: "legend", fields: {} }] } },
  };
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: "rl2_test",
    source: { schema: "riftreplay-raw-capture", version: 1, captureSessionId: "", roomCode: "", startedAt: 1, endedAt: 2, messageCount: 2 },
    series: {
      id: "series",
      perspectivePlayerId: "self",
      format: "bo3",
      bestOf: 3,
      roomCode: "",
      startedAt: 1,
      endedAt: 2,
      participants: [
        { id: "opp", name: "Ceddidulli", isPerspective: false, fields: {} },
        { id: "self", name: "BMU", isPerspective: true, fields: {} },
      ],
      games: [
        { id: "g1", ordinal: 0, gameNumber: 1, sourceIdentity: { explicitGameNumber: true, gameInstanceIds: [] }, startedAt: 1, endedAt: 1, startedAtMs: 0, endedAtMs: 1, eventStartIndex: 0, eventEndIndex: 0, phases: [], result: { resultEventId: "r1", winnerPlayerId: "self" } },
        { id: "g2", ordinal: 1, gameNumber: 2, sourceIdentity: { explicitGameNumber: true, gameInstanceIds: [] }, startedAt: 2, endedAt: 2, startedAtMs: 2, endedAtMs: 3, eventStartIndex: 1, eventEndIndex: 1, phases: [], result: { resultEventId: "r2", winnerPlayerId: "self", finalScores: { self: 5, opp: 4 } } },
      ],
    },
    events: [],
    unknownEvents: [],
    diagnostics: [],
    checkpoints: [{ id: "cp", eventIndex: -1, atMs: 0, stateHash: "hash", state: { seriesId: "series", gameId: "g2", gameOrdinal: 1, phase: "series_end", chat: [], appliedEventIndex: -1, room: { phase: "series_end", rawPhase: "", gameNumber: 2, fields: {} }, players, chain: [], log: [] } }],
  };
}
