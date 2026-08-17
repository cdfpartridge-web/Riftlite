import { describe, expect, it } from "vitest";

import { isFullScreenAppPath, isReplayAppPath, isViewportLockedAppPath } from "./site-frame";

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
    expect(isFullScreenAppPath("/meta-studio/caster")).toBe(true);
    expect(isFullScreenAppPath("/meta-studio/present")).toBe(true);
    expect(isFullScreenAppPath("/community/meta")).toBe(false);
  });
});

describe("isViewportLockedAppPath", () => {
  it("lets the Meta Studio replay library use document scrolling", () => {
    expect(isViewportLockedAppPath("/meta-studio/caster")).toBe(false);
  });

  it("keeps canvas and replay-player experiences locked to the viewport", () => {
    expect(isViewportLockedAppPath("/meta-studio")).toBe(true);
    expect(isViewportLockedAppPath("/meta-studio/present")).toBe(true);
    expect(isViewportLockedAppPath("/meta-studio/caster/rl2_example")).toBe(true);
    expect(isViewportLockedAppPath("/replay/rl2_example")).toBe(true);
  });
});
