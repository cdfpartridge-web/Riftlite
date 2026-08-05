import { afterEach, describe, expect, it, vi } from "vitest";

import type { CanonicalReplayV2 } from "@/lib/replay-v2";

import {
  CASTER_PROJECT_STORAGE_PREFIX,
  addCasterBookmark,
  casterProjectStorageKey,
  casterYouTubeChapters,
  clearCasterProject,
  createCasterProject,
  deleteCasterBookmark,
  loadCasterProject,
  parseCasterProject,
  resolveCasterBookmarkEventIndex,
  saveCasterProject,
  updateCasterBookmark,
  type CasterBookmark,
  type CasterProjectStorage,
} from "./caster-project";

afterEach(() => {
  vi.useRealTimers();
});

describe("caster project storage schema", () => {
  it("creates a versioned replay-scoped project and encoded storage key", () => {
    expect(createCasterProject(" rl2/a ")).toEqual({
      schema: "riftlite-caster-project",
      version: 1,
      replayId: "rl2/a",
      bookmarks: [],
      updatedAt: 0,
    });
    expect(casterProjectStorageKey("rl2/a"))
      .toBe(`${CASTER_PROJECT_STORAGE_PREFIX}rl2%2Fa`);
  });

  it.each([
    null,
    "",
    "not json",
    "[]",
    JSON.stringify({ version: 2, bookmarks: [] }),
    JSON.stringify({ schema: "another-project", version: 1, bookmarks: [] }),
    JSON.stringify({ version: 1, replayId: "another-replay", bookmarks: [] }),
  ])("fails closed for malformed, incompatible, or cross-replay data", (value) => {
    expect(parseCasterProject(value, "replay-a"))
      .toEqual(createCasterProject("replay-a"));
  });

  it("sanitizes records, drops unusable rows, de-duplicates ids, and sorts stably", () => {
    const parsed = parseCasterProject(JSON.stringify({
      version: 1,
      replayId: "replay-a",
      updatedAt: 50,
      bookmarks: [
        {
          id: "same",
          eventId: " event-late ",
          eventIndex: 9.8,
          atMs: 9_000.9,
          gameId: " game-2 ",
          gameNumber: 2,
          turn: 4,
          title: "  Late   play  ",
          note: " First\r\n  second ",
          createdAt: 20,
        },
        { id: "discard-me", atMs: "not-a-number" },
        {
          id: "same",
          eventId: "event-early",
          eventIndex: 3,
          atMs: 2_000,
          gameNumber: 1,
          turn: 1,
          createdAt: 10,
        },
        {
          eventId: "event-same-time",
          eventIndex: 2,
          atMs: 2_000,
          createdAt: 8,
        },
      ],
    }), "replay-a");

    expect(parsed.bookmarks).toHaveLength(3);
    expect(parsed.bookmarks.map((bookmark) => bookmark.eventId)).toEqual([
      "event-same-time",
      "event-early",
      "event-late",
    ]);
    expect(parsed.bookmarks.map((bookmark) => bookmark.id)).toEqual([
      expect.stringMatching(/^bookmark-/),
      "same-2",
      "same",
    ]);
    expect(parsed.bookmarks[2]).toMatchObject({
      eventIndex: 9,
      atMs: 9_000,
      gameId: "game-2",
      title: "Late play",
      note: "First\n second",
    });
  });

  it("round-trips through storage and treats storage failures as recoverable", () => {
    const values = new Map<string, string>();
    const storage: CasterProjectStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    };
    const project = addCasterBookmark(createCasterProject("replay-a"), {
      id: "opening",
      atMs: 0,
      title: "Matchup",
      createdAt: 1,
    });

    expect(saveCasterProject(project, storage)).toBe(true);
    expect(loadCasterProject("replay-a", storage).bookmarks).toEqual(project.bookmarks);
    expect(clearCasterProject("replay-a", storage)).toBe(true);
    expect(loadCasterProject("replay-a", storage).bookmarks).toEqual([]);

    const brokenStorage: CasterProjectStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("full"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(loadCasterProject("replay-a", brokenStorage)).toEqual(createCasterProject("replay-a"));
    expect(saveCasterProject(project, brokenStorage)).toBe(false);
    expect(clearCasterProject("replay-a", brokenStorage)).toBe(false);
  });
});

describe("caster bookmark editing", () => {
  it("adds, reorders on update, and deletes bookmarks without changing stable ids", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00.000Z"));
    let project = createCasterProject("replay-a");
    project = addCasterBookmark(project, {
      id: "late",
      eventId: "event-8",
      eventIndex: 8,
      atMs: 8_000,
      gameId: "game-1",
      gameNumber: 1,
      turn: 2,
      title: "Late",
      createdAt: 2,
    });
    project = addCasterBookmark(project, {
      id: "early",
      eventId: "event-2",
      eventIndex: 2,
      atMs: 2_000,
      gameId: "game-1",
      gameNumber: 1,
      turn: 1,
      title: "Early",
      createdAt: 1,
    });

    expect(project.bookmarks.map((bookmark) => bookmark.id)).toEqual(["early", "late"]);
    project = updateCasterBookmark(project, "late", {
      atMs: 1_000,
      eventId: "event-1",
      eventIndex: 1,
      title: "Now first",
      note: "Casting note",
    });
    expect(project.bookmarks.map((bookmark) => bookmark.id)).toEqual(["late", "early"]);
    expect(project.bookmarks[0]).toMatchObject({
      id: "late",
      createdAt: 2,
      title: "Now first",
      note: "Casting note",
    });

    project = deleteCasterBookmark(project, "late");
    expect(project.bookmarks.map((bookmark) => bookmark.id)).toEqual(["early"]);
    expect(deleteCasterBookmark(project, "missing")).toEqual(project);
  });
});

describe("caster bookmark anchors and chapter export", () => {
  const replay = {
    events: [
      { id: "event-0", atMs: 0 },
      { id: "event-1", atMs: 1_000 },
      { id: "event-rebuilt", atMs: 4_000 },
      { id: "event-5", atMs: 5_000 },
    ],
  } as unknown as Pick<CanonicalReplayV2, "events">;

  it("resolves a stable event id first and falls back to the bookmarked time", () => {
    const bookmark = bookmarkFixture({
      eventId: "event-rebuilt",
      eventIndex: 99,
      atMs: 1_500,
    });
    expect(resolveCasterBookmarkEventIndex(bookmark, replay)).toBe(2);
    expect(resolveCasterBookmarkEventIndex(
      { ...bookmark, eventId: "event-from-old-generation", atMs: 4_500 },
      replay,
    )).toBe(2);
    expect(resolveCasterBookmarkEventIndex(
      { ...bookmark, eventId: "missing", atMs: 0 },
      { events: [] },
    )).toBe(-1);
  });

  it("always exports a 00:00 opener and deterministic YouTube timestamps", () => {
    let project = createCasterProject("replay-a");
    project = addCasterBookmark(project, {
      id: "hour",
      atMs: 3_661_900,
      title: "Final game",
      createdAt: 4,
    });
    project = addCasterBookmark(project, {
      id: "duplicate-second",
      atMs: 65_900,
      title: "Duplicate is ignored",
      createdAt: 3,
    });
    project = addCasterBookmark(project, {
      id: "main",
      atMs: 65_100,
      title: "  Key   attack  ",
      createdAt: 2,
    });
    project = addCasterBookmark(project, {
      id: "zero",
      atMs: 500,
      title: "Matchup and opening hands",
      createdAt: 1,
    });

    expect(casterYouTubeChapters(project)).toBe([
      "00:00 Matchup and opening hands",
      "01:05 Key attack",
      "1:01:01 Final game",
    ].join("\n"));
    expect(casterYouTubeChapters(createCasterProject("replay-a"), "Full replay"))
      .toBe("00:00 Full replay");
  });
});

function bookmarkFixture(overrides: Partial<CasterBookmark> = {}): CasterBookmark {
  return {
    id: "bookmark",
    eventId: "event-1",
    eventIndex: 1,
    atMs: 1_000,
    gameId: "game-1",
    gameNumber: 1,
    turn: 1,
    title: "Moment",
    note: "",
    createdAt: 1,
    ...overrides,
  };
}
