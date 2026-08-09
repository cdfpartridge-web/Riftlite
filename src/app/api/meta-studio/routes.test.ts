import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommunityMatch } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  createFirebaseSessionCookie: vi.fn(),
  getCommunityRangeMatchWindow: vi.fn(),
  getCommunityRangeStats: vi.fn(),
  requireMetaStudioBearer: vi.fn(),
  requireMetaStudioSession: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  createFirebaseSessionCookie: mocks.createFirebaseSessionCookie,
}));

vi.mock("@/lib/community/meta-studio-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/community/meta-studio-auth")>();
  return {
    ...actual,
    requireMetaStudioBearer: mocks.requireMetaStudioBearer,
    requireMetaStudioSession: mocks.requireMetaStudioSession,
  };
});

vi.mock("@/lib/community/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/community/data")>();
  return {
    ...actual,
    getCommunityRangeMatchWindow: mocks.getCommunityRangeMatchWindow,
    getCommunityRangeStats: mocks.getCommunityRangeStats,
  };
});

import {
  DELETE as deleteSession,
  POST as createSession,
} from "@/app/api/meta-studio/session/route";
import { GET as getReport } from "@/app/api/meta-studio/report/route";

const NOW = Date.now();

function sampleMatch(): CommunityMatch {
  return {
    id: "match-1",
    uid: "player-1",
    username: "Private display name",
    date: new Date(NOW).toISOString(),
    result: "Win",
    myChampion: "Akali",
    oppChampion: "Annie",
    oppName: "Private opponent",
    fmt: "Bo1",
    platform: "atlas",
    score: "1-0",
    wentFirst: "1st",
    myBattlefield: "",
    oppBattlefield: "",
    flags: "private note",
    games: [],
    deckName: "",
    deckSourceUrl: "",
    deckSourceKey: "",
    deckSnapshot: null,
    createdAt: NOW,
  };
}

describe("Meta Studio session route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMetaStudioBearer.mockResolvedValue({
      uid: "canonical-bmu",
      authenticatedUid: "canonical-bmu",
      decoded: { uid: "canonical-bmu" },
      db: {},
      token: "firebase-id-token",
    });
    mocks.createFirebaseSessionCookie.mockResolvedValue("signed-session-cookie");
  });

  it("creates a private HttpOnly same-site session after exact UID authorization", async () => {
    const response = await createSession(new NextRequest("https://www.riftlite.com/api/meta-studio/session", {
      method: "POST",
      headers: { Authorization: "Bearer firebase-id-token" },
    }));

    expect(response.status).toBe(200);
    expect(mocks.createFirebaseSessionCookie).toHaveBeenCalledWith(
      "firebase-id-token",
      8 * 60 * 60 * 1000,
    );
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toContain("Authorization");
    expect(response.headers.get("set-cookie")).toContain("riftlite_meta_studio=signed-session-cookie");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=strict");
  });

  it("returns an authorized route error without attempting session creation", async () => {
    mocks.requireMetaStudioBearer.mockResolvedValue({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });

    const response = await createSession(new NextRequest("https://www.riftlite.com/api/meta-studio/session", {
      method: "POST",
    }));

    expect(response.status).toBe(403);
    expect(mocks.createFirebaseSessionCookie).not.toHaveBeenCalled();
  });

  it("clears the private session cookie", async () => {
    const response = await deleteSession();
    expect(response.headers.get("set-cookie")).toContain("riftlite_meta_studio=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("Meta Studio report route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMetaStudioSession.mockResolvedValue({
      uid: "canonical-bmu",
      decoded: { uid: "canonical-bmu" },
      db: {},
    });
    mocks.getCommunityRangeMatchWindow.mockResolvedValue([sampleMatch()]);
    mocks.getCommunityRangeStats.mockResolvedValue({
      matchCount: 1,
      detailMatchCount: 1,
      firstCreatedAt: NOW,
      lastCreatedAt: NOW,
      updatedAt: NOW,
      rangeDays: 7,
      legendMeta: [],
      matrix: { rows: [], columns: [], cells: [] },
    });
  });

  it("returns a compact non-cacheable report without raw player or note fields", async () => {
    const response = await getReport(new NextRequest(
      "https://www.riftlite.com/api/meta-studio/report?range=7d&season=&format=all&platform=all",
      { headers: { Cookie: "riftlite_meta_studio=signed" } },
    ));
    const text = await response.text();
    const payload = JSON.parse(text) as {
      report: {
        schemaVersion: number;
        aggregationMethod: string;
        coverage: {
          detailedRecords: number;
          rankedRecords: number;
          legendAppearances: number;
          uniquePlayers: number;
        };
        leaders: unknown[];
      };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(payload.report).toMatchObject({
      schemaVersion: 2,
      aggregationMethod: "symmetric-v1",
      coverage: {
        detailedRecords: 1,
        rankedRecords: 1,
        legendAppearances: 2,
        uniquePlayers: 1,
      },
    });
    expect(payload.report.leaders).toHaveLength(2);
    expect(text).not.toContain("Private display name");
    expect(text).not.toContain("Private opponent");
    expect(text).not.toContain("private note");
  });

  it("anchors the report to the aggregate refresh and hides incomplete rank movement", async () => {
    const priorMatch = sampleMatch();
    priorMatch.id = "prior-match";
    priorMatch.createdAt = NOW - 8 * 24 * 60 * 60 * 1000;
    const currentMatch = sampleMatch();
    currentMatch.createdAt = NOW - 24 * 60 * 60 * 1000;
    mocks.getCommunityRangeMatchWindow.mockResolvedValue([currentMatch, priorMatch]);
    mocks.getCommunityRangeStats
      .mockReset()
      .mockResolvedValueOnce({
        matchCount: 100,
        detailMatchCount: 2,
        firstCreatedAt: priorMatch.createdAt,
        lastCreatedAt: currentMatch.createdAt,
        updatedAt: NOW,
        rangeDays: 14,
        legendMeta: [],
        matrix: { rows: [], columns: [], cells: [] },
      })
      .mockResolvedValueOnce({
        matchCount: 1,
        detailMatchCount: 1,
        firstCreatedAt: currentMatch.createdAt,
        lastCreatedAt: currentMatch.createdAt,
        updatedAt: NOW,
        rangeDays: 7,
        legendMeta: [],
        matrix: { rows: [], columns: [], cells: [] },
      });

    const response = await getReport(new NextRequest(
      "https://www.riftlite.com/api/meta-studio/report?range=7d&season=&format=all&platform=all",
      { headers: { Cookie: "riftlite_meta_studio=signed" } },
    ));
    const payload = await response.json() as {
      report: {
        window: { end: number };
        coverage: {
          comparisonAvailable: boolean;
          comparisonWindowComplete: boolean;
          detailWindowTruncated: boolean;
          sourceAsOf: number;
        };
        leaders: Array<{ previousRank: number | null }>;
      };
    };

    expect(payload.report.window.end).toBe(NOW);
    expect(payload.report.coverage).toMatchObject({
      comparisonAvailable: false,
      comparisonWindowComplete: false,
      detailWindowTruncated: false,
      sourceAsOf: NOW,
    });
    expect(payload.report.leaders[0]?.previousRank).toBeNull();
  });

  it("does not read community data when the session is unauthorized", async () => {
    mocks.requireMetaStudioSession.mockResolvedValue({
      error: NextResponse.json({ error: "Sign in" }, { status: 401 }),
    });

    const response = await getReport(new NextRequest(
      "https://www.riftlite.com/api/meta-studio/report",
    ));

    expect(response.status).toBe(401);
    expect(mocks.getCommunityRangeMatchWindow).not.toHaveBeenCalled();
    expect(mocks.getCommunityRangeStats).not.toHaveBeenCalled();
  });
});
