import { describe, expect, it } from "vitest";

import {
  isCasterReplayId,
  parseCasterReplayReference,
} from "./caster-replay-reference";

const REPLAY_ID = `rl2_${"a".repeat(32)}`;

describe("caster replay references", () => {
  it("accepts a canonical replay id and normalizes casing", () => {
    expect(parseCasterReplayReference(REPLAY_ID.toUpperCase())).toBe(REPLAY_ID);
    expect(isCasterReplayId(REPLAY_ID)).toBe(true);
  });

  it("extracts a replay id from public and caster links", () => {
    expect(parseCasterReplayReference(`https://www.riftlite.com/replays/${REPLAY_ID}?t=42`))
      .toBe(REPLAY_ID);
    expect(parseCasterReplayReference(`/meta-studio/caster/${REPLAY_ID}`)).toBe(REPLAY_ID);
    expect(parseCasterReplayReference(`https%3A%2F%2Fwww.riftlite.com%2Freplays%2F${REPLAY_ID}`))
      .toBe(REPLAY_ID);
  });

  it("rejects partial, malformed, and unrelated references", () => {
    expect(parseCasterReplayReference("")).toBeNull();
    expect(parseCasterReplayReference("rl2_short")).toBeNull();
    expect(parseCasterReplayReference(`prefix${REPLAY_ID}suffix`)).toBeNull();
    expect(parseCasterReplayReference("https://www.riftlite.com/replays/not-a-replay"))
      .toBeNull();
  });
});
