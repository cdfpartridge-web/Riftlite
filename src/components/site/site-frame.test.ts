import { describe, expect, it } from "vitest";

import { isFullScreenAppPath, isReplayAppPath } from "./site-frame";

describe("isReplayAppPath", () => {
  it("uses the full-screen replay shell for local TCGA previews", () => {
    expect(isReplayAppPath("/replays/tcga/akali-vs-irelia")).toBe(true);
  });

  it("keeps normal site pages inside the public site frame", () => {
    expect(isReplayAppPath("/replays")).toBe(false);
    expect(isReplayAppPath("/community/matches")).toBe(false);
  });

  it("keeps the private Meta Studio inside the full-screen application shell", () => {
    expect(isFullScreenAppPath("/meta-studio")).toBe(true);
    expect(isFullScreenAppPath("/meta-studio/present")).toBe(true);
    expect(isFullScreenAppPath("/community/meta")).toBe(false);
  });
});
