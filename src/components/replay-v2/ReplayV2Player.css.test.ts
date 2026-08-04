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

  it("reserves the sideways footprint of exhausted board cards", () => {
    expect(css).toMatch(
      /\.laneCards\s*>\s*\.cardMotion\[data-card-exhausted="true"\][^{}]*\{[^{}]*margin-inline:\s*16px/s,
    );
    expect(css).toMatch(
      /\.battlefieldUnitRow\s*>\s*\.cardMotion\[data-card-exhausted="true"\][^{}]*\{[^{}]*margin-inline:\s*16px/s,
    );
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
