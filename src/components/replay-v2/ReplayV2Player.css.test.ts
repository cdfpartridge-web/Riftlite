import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "src/components/replay-v2/ReplayV2Player.module.css"),
  "utf8",
);

describe("ReplayV2Player board spacing", () => {
  it("keeps overlap only in the hand and attachment layers", () => {
    expect(ruleBody(".handCards .cardMotion + .cardMotion")).toContain("margin-left: -28px");
    expect(ruleBody(".laneCards")).toContain("gap: 8px");
    expect(ruleBody(".battlefieldUnitRow")).toContain("gap: 6px");
    expect(css).not.toMatch(/\.laneCards\s*>[^{}]+\{[^{}]*margin-left:\s*-/s);
    expect(css).not.toMatch(/\.battlefieldUnitRow\s*>[^{}]+\{[^{}]*margin-left:\s*-/s);
    expect(ruleBody('.attachedCardLayer[data-card-attachment-layer="attachment"]'))
      .toContain("left: calc(");
  });

  it("keeps caster output on the existing 1920 by 1080 broadcast canvas", () => {
    expect(css).toMatch(/(?:^|\n)\.canvas\s*\{[^}]*width:\s*1920px/s);
    expect(css).toMatch(/(?:^|\n)\.canvas\s*\{[^}]*height:\s*1080px/s);
    expect(css).toMatch(/(?:^|\n)\.canvas\s*\{[^}]*grid-template-rows:\s*962px 118px/s);
    expect(ruleBody(".casterLowerThird")).toContain("grid-row: 2");
    expect(ruleBody(".casterInspectorRail")).toContain(
      "grid-template-rows: 69px 35px minmax(0, 1fr) 62px",
    );
  });

  it("reserves the sideways footprint of exhausted board cards", () => {
    expect(css).toMatch(
      /\.laneCards\s*>\s*\.cardMotion\[data-card-exhausted="true"\][^{}]*\{[^{}]*margin-inline:\s*16px/s,
    );
    expect(css).toMatch(
      /\.battlefieldUnitRow\s*>\s*\.cardMotion\[data-card-exhausted="true"\][^{}]*\{[^{}]*margin-inline:\s*16px/s,
    );
  });

  it("keeps battlefield cards in a lower, isolated paint layer than both unit rows", () => {
    expect(ruleBody(".battlefieldZone")).toContain("isolation: isolate");
    expect(ruleBody(".battlefieldCardDock")).toContain("grid-row: 2");
    expect(ruleBody(".battlefieldCardDock")).toContain("z-index: 1");
    expect(ruleBody(".battlefieldUnitRow")).toContain("z-index: 5");
    expect(ruleBody(".battlefieldUnitRowTop")).toContain("grid-row: 1");
    expect(ruleBody(".battlefieldUnitRowBottom")).toContain("grid-row: 3");
    expect(ruleBody(".battlefieldCardDock .battlefieldTile,")).toContain("height: 44px");
  });
});

function ruleBody(selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) return "";
  const openingBrace = css.indexOf("{", start + selector.length);
  const closingBrace = css.indexOf("}", openingBrace + 1);
  return openingBrace >= 0 && closingBrace >= 0
    ? css.slice(openingBrace + 1, closingBrace)
    : "";
}
