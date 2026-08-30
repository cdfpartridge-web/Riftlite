import { describe, expect, it } from "vitest";

import {
  addReplayNote,
  createReplayNotesProject,
  deleteReplayNote,
  loadReplayNotesProject,
  parseReplayNotesProject,
  replayNoteLabel,
  replayNotesStorageKey,
  saveReplayNotesProject,
  updateReplayNote,
} from "./replay-notes";

describe("replay notes", () => {
  it("adds, sorts, edits, and deletes notes without losing exact timestamps", () => {
    let project = createReplayNotesProject("rp_notes");
    project = addReplayNote(project, {
      id: "later",
      atMs: 45_550,
      title: "Lethal check",
      body: "Count available runes.",
      createdAt: 2,
    });
    project = addReplayNote(project, {
      id: "earlier",
      atMs: 12_345,
      body: "Pause before committing.",
      createdAt: 1,
    });

    expect(project.notes.map((note) => note.id)).toEqual(["earlier", "later"]);
    expect(project.notes[0]?.atMs).toBe(12_345);
    expect(replayNoteLabel(project.notes[0]!)).toBe("Pause before committing.");

    project = updateReplayNote(project, "earlier", {
      atMs: 13_050,
      title: "Coach note",
      body: "Hold the action.",
      updatedAt: 3,
    });
    expect(project.notes[0]).toMatchObject({ atMs: 13_050, title: "Coach note", body: "Hold the action." });

    project = deleteReplayNote(project, "later");
    expect(project.notes.map((note) => note.id)).toEqual(["earlier"]);
  });

  it("round-trips through replay-scoped storage and ignores corrupt data", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const project = addReplayNote(createReplayNotesProject("rp/storage"), {
      atMs: 9_999,
      body: "Stored locally",
      createdAt: 4,
    });
    expect(saveReplayNotesProject(project, storage)).toBe(true);
    expect(loadReplayNotesProject("rp/storage", storage)).toEqual(project);
    expect(replayNotesStorageKey("rp/storage")).toContain("rp%2Fstorage");

    values.set(replayNotesStorageKey("rp/storage"), "not-json");
    expect(loadReplayNotesProject("rp/storage", storage).notes).toEqual([]);
    expect(parseReplayNotesProject({ version: 99, notes: project.notes }, "rp/storage").notes).toEqual([]);
  });
});
