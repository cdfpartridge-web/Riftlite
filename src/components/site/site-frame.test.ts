import { describe, expect, it } from "vitest";

import { isReplayAppPath } from "./site-frame";

describe("isReplayAppPath", () => {
  it("uses the full-screen replay shell for local TCGA previews", () => {
    expect(isReplayAppPath("/replays/tcga/akali-vs-irelia")).toBe(true);
  });

  it("keeps normal site pages inside the public site frame", () => {
    expect(isReplayAppPath("/replays")).toBe(false);
    expect(isReplayAppPath("/community/matches")).toBe(false);
  });
});
