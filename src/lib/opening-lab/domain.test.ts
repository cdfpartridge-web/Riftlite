import { describe, expect, it } from "vitest";
import { projectReplayState } from "@/lib/replay-v2";
import {
  anonymousOpeningReplay,
  extractOpeningLines,
  isOpeningSource,
} from "./domain";
import { openingTestReplay } from "./fixture";

describe("opening practice source selection", () => {
  it.each(["public", "unlisted"])("accepts ready %s sources", (visibility) =>
    expect(isOpeningSource({ status: "ready", visibility })).toBe(true),
  );
  it.each(["private", "deleted", undefined])(
    "excludes %s sources",
    (visibility) =>
      expect(isOpeningSource({ status: "ready", visibility })).toBe(false),
  );
  it("rejects unfinished uploads", () =>
    expect(
      isOpeningSource({ status: "processing", visibility: "unlisted" }),
    ).toBe(false));
});
describe("recorded five-turn openings", () => {
  it.each([false, true])(
    "finds five of your turns when going second=%s",
    (second) => {
      const replay = openingTestReplay(second),
        [line] = extractOpeningLines(replay);
      expect(line.initiative).toBe(second ? "second" : "first");
      expect(line.moments.map((m) => m.turn)).toEqual([1, 2, 3, 4, 5]);
      for (const moment of line.moments) {
        const before = projectReplayState(replay, moment.before);
        expect(before.room.activeTurnPlayerId).toBe(line.playerId);
        expect(before.players[line.playerId].zones.base).toHaveLength(0);
      }
    },
  );
  it("does not treat an interrupted fifth turn as complete", () => {
    const replay = openingTestReplay();
    replay.events = replay.events.slice(0, 14);
    expect(extractOpeningLines(replay)).toEqual([]);
  });
  it("does not label a mid-game capture as the first opening", () => {
    const replay = openingTestReplay();
    replay.events = replay.events.slice(3).map((e, index) => ({ ...e, index }));
    expect(extractOpeningLines(replay)).toEqual([]);
  });
  it("rejects missing own-hand identities", () => {
    const replay = openingTestReplay();
    for (const event of replay.events)
      if (event.kind === "snapshot")
        event.snapshot.players["secret-owner"].zones.hand[0].isPlaceholder =
          true;
    expect(extractOpeningLines(replay)).toEqual([]);
  });
  it("rejects a missing first own turn even if capture begins on global turn two", () => {
    const replay = openingTestReplay();
    replay.events = replay.events
      .slice(2)
      .map((event, index) => ({ ...event, index }));
    expect(extractOpeningLines(replay)).toEqual([]);
  });
  it("anchors before resource payment rather than after it", () => {
    const replay = openingTestReplay();
    const action = replay.events.find((e) => e.kind === "action")!;
    if (action.kind === "action") action.actionType = "payment_batch";
    const [line] = extractOpeningLines(replay);
    expect(line.moments[0].before).toBe(action.index - 1);
  });
});
describe("anonymous training payloads", () => {
  it.each([false, true])(
    "allowlists data and removes identifiers, links and future knowledge (reveal=%s)",
    (reveal) => {
      const source = openingTestReplay(),
        unchanged = JSON.stringify(source),
        [line] = extractOpeningLines(source);
      const replay = anonymousOpeningReplay(
        source,
        line,
        line.moments[0],
        reveal,
      );
      const serialized = JSON.stringify(replay);
      expect(serialized).not.toContain("secret-");
      expect(serialized).not.toContain("private.invalid");
      expect(serialized).not.toContain("1720000000000");
      expect(replay.series.result).toBeUndefined();
      expect(replay.checkpoints).toEqual([]);
      const state = projectReplayState(replay);
      expect(
        state.players.opponent.zones.hand.every(
          (c) => c.isPlaceholder && !c.cardCode,
        ),
      ).toBe(true);
      expect(
        state.players.learner.zones.deck.every(
          (c) => c.isPlaceholder && !c.cardCode,
        ),
      ).toBe(true);
      expect(
        state.players.learner.zones.hand.every(
          (c) => !c.isPlaceholder && Boolean(c.cardCode),
        ),
      ).toBe(true);
      expect(JSON.stringify(source)).toBe(unchanged);
    },
  );
  it("sends only the pre-decision snapshot before lock", () => {
    const source = openingTestReplay(),
      [line] = extractOpeningLines(source);
    const prompt = anonymousOpeningReplay(source, line, line.moments[0], false);
    expect(prompt.events).toHaveLength(1);
    expect(projectReplayState(prompt).players.learner.zones.base).toHaveLength(
      0,
    );
    const reveal = anonymousOpeningReplay(source, line, line.moments[0], true);
    expect(reveal.events.length).toBeGreaterThan(1);
  });
  it("conceals opponent face-down cards even if the paired source knows their identity", () => {
    const source = openingTestReplay(),
      [line] = extractOpeningLines(source);
    const event = source.events[0];
    if (event.kind !== "snapshot") throw Error("fixture");
    const card = {
      ...event.snapshot.players["secret-opponent"].zones.deck[0],
      ownerPlayerId: "secret-opponent",
      fields: { hidden: true },
    };
    event.snapshot.players["secret-opponent"].zones.battlefieldA = [card];
    const prompt = anonymousOpeningReplay(source, line, line.moments[0], false);
    expect(
      projectReplayState(prompt).players.opponent.zones.battlefieldA[0],
    ).toMatchObject({ name: "Hidden card", isPlaceholder: true });
    expect(JSON.stringify(prompt)).not.toContain(card.cardCode);
  });
});
