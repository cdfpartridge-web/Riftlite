import { describe, expect, it } from "vitest";

import { canonicalChoice, hasInvalidChoice } from "@/lib/canonical";
import { BATTLEFIELD_ALIASES, BATTLEFIELDS, LEGEND_ALIASES, LEGENDS } from "@/lib/constants";

describe("canonical choices", () => {
  it("normalizes legends without allowing unknown values", () => {
    expect(canonicalChoice("kaisa", LEGENDS, LEGEND_ALIASES)).toBe("Kai'Sa");
    expect(canonicalChoice("Master Yi", LEGENDS, LEGEND_ALIASES)).toBe("Master Yi (Wuju Bladesman)");
    expect(hasInvalidChoice("Totally Not A Legend", LEGENDS, LEGEND_ALIASES)).toBe(true);
  });

  it("normalizes battlefields by exact, slug, and alias matches", () => {
    expect(canonicalChoice("targons peak", BATTLEFIELDS, BATTLEFIELD_ALIASES)).toBe("Targon's Peak");
    expect(canonicalChoice("Hall of Legend", BATTLEFIELDS, BATTLEFIELD_ALIASES)).toBe("Hall of Legends");
    expect(hasInvalidChoice("Made Up Battlefield", BATTLEFIELDS, BATTLEFIELD_ALIASES)).toBe(true);
  });
});
