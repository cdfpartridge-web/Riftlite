import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_MATCHES } from "@/lib/fixtures/community";
import { RADIANCE_START_MS, RADIANCE_PRESEASON_START_MS } from "@/lib/stat-seasons";

const source = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/community/data", () => ({
  getCommunityMatchWindow: source.get,
  getCommunityRangeMatchWindow: source.get,
  filterCommunityMatchesByDays: (matches: unknown[]) => matches,
}));
import { GET } from "./route";

describe("desktop community season compatibility", () => {
  beforeEach(() => source.get.mockResolvedValue([
    { ...FIXTURE_MATCHES[0], id: "vendetta", date: new Date(RADIANCE_PRESEASON_START_MS - 1).toISOString() },
    { ...FIXTURE_MATCHES[0], id: "preseason", date: new Date(RADIANCE_START_MS - 1).toISOString() },
    { ...FIXTURE_MATCHES[0], id: "radiance", date: new Date(RADIANCE_START_MS).toISOString() },
  ]));

  it.each(["", "&season="])("keeps all history for old clients with omitted or empty season (%s)", async (season) => {
    const response = await GET(new Request(`http://localhost/api/community/desktop?limit=all${season}`));
    const body = await response.json();
    expect(body.matches.map((match: { id: string }) => match.id)).toEqual(["vendetta", "preseason", "radiance"]);
    expect(body.count).toBe(3);
  });

  it.each([["radiance", "radiance"], ["radiance-preseason", "preseason"], ["vendetta-launch", "vendetta"]])("supports explicit %s without merging seasons", async (season, expected) => {
    const response = await GET(new Request(`http://localhost/api/community/desktop?season=${season}`));
    const body = await response.json();
    expect(body.matches.map((match: { id: string }) => match.id)).toEqual([expected]);
    expect(body.count).toBe(1);
  });
});
