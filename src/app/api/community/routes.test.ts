import { describe, expect, it } from "vitest";

import { GET as getDecks } from "@/app/api/community/decks/route";
import { GET as getDeckDetail } from "@/app/api/community/decks/[deckKey]/route";
import { GET as getMatches } from "@/app/api/community/matches/route";
import { GET as getMatrix } from "@/app/api/community/matrix/route";
import { GET as getMeta } from "@/app/api/community/meta/route";
import { GET as getOverview } from "@/app/api/community/overview/route";
import { GET as getStreamStatus } from "@/app/api/stream/status/route";

describe("community api routes", () => {
  it("returns overview payload", async () => {
    const response = await getOverview();
    const payload = await response.json();
    expect(payload.totalMatches).toBeGreaterThan(0);
  });

  it("returns meta, matrix, matches, and decks payloads", async () => {
    const [meta, matrix, matches, decks] = await Promise.all([
      getMeta(new Request("http://localhost/api/community/meta")),
      getMatrix(new Request("http://localhost/api/community/matrix")),
      getMatches(new Request("http://localhost/api/community/matches?page=1&pageSize=5")),
      getDecks(new Request("http://localhost/api/community/decks")),
    ]);

    expect((await meta.json()).length).toBeGreaterThan(0);
    expect((await matrix.json()).cells.length).toBeGreaterThan(0);
    expect((await matches.json()).items.length).toBeGreaterThan(0);
    expect((await decks.json()).items.length).toBeGreaterThan(0);
  });

  it("returns deck detail and twitch status", async () => {
    const deckResponse = await getDeckDetail(new Request("http://localhost"), {
      params: Promise.resolve({ deckKey: encodeURIComponent("source:ahri-tempo-001") }),
    });
    const streamResponse = await getStreamStatus();

    expect(deckResponse.status).toBe(200);
    expect((await streamResponse.json()).channelLogin).toBe("bmucasts");
  });
});
