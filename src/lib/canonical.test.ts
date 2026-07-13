import { describe, expect, it } from "vitest";

import { canonicalChoice, hasInvalidChoice } from "@/lib/canonical";
import { BATTLEFIELD_ALIASES, BATTLEFIELDS, LEGEND_ALIASES, LEGENDS } from "@/lib/constants";

describe("canonical choices", () => {
  it("normalizes legends without allowing unknown values", () => {
    expect(canonicalChoice("kaisa", LEGENDS, LEGEND_ALIASES)).toBe("Kai'Sa");
    expect(canonicalChoice("Master Yi", LEGENDS, LEGEND_ALIASES)).toBe("Master Yi");
    expect(canonicalChoice("Master Yi, Wuju Bladesman", LEGENDS, LEGEND_ALIASES)).toBe("Master Yi, Wuju Bladesman");
    expect(canonicalChoice("Master Yi, Wuju Master", LEGENDS, LEGEND_ALIASES)).toBe("Master Yi, Wuju Master");
    expect(canonicalChoice("Master Yi, Wuji Master", LEGENDS, LEGEND_ALIASES)).toBe("Master Yi, Wuju Master");
    expect(canonicalChoice("Mechanized Menace", LEGENDS, LEGEND_ALIASES)).toBe("Rumble");
    expect(canonicalChoice("Master of Shadows", LEGENDS, LEGEND_ALIASES)).toBe("Zed");
    expect(canonicalChoice("Matriarch of War", LEGENDS, LEGEND_ALIASES)).toBe("Ambessa");
    expect(canonicalChoice("Mel, Newly Awakened", LEGENDS, LEGEND_ALIASES)).toBe("Mel");
    expect(canonicalChoice("Victor", LEGENDS, LEGEND_ALIASES)).toBe("Viktor");
    expect(hasInvalidChoice("Totally Not A Legend", LEGENDS, LEGEND_ALIASES)).toBe(true);
  });

  it("normalizes battlefields by exact, slug, and alias matches", () => {
    expect(canonicalChoice("targons peak", BATTLEFIELDS, BATTLEFIELD_ALIASES)).toBe("Targon's Peak");
    expect(canonicalChoice("Hall of Legend", BATTLEFIELDS, BATTLEFIELD_ALIASES)).toBe("Hall of Legends");
    expect(canonicalChoice("Piltover Forge", BATTLEFIELDS, BATTLEFIELD_ALIASES)).toBe("Piltovan Forge");
    expect(canonicalChoice("Sandswept Tomb", BATTLEFIELDS, BATTLEFIELD_ALIASES)).toBe("Sandswept Tomb");
    expect(hasInvalidChoice("Made Up Battlefield", BATTLEFIELDS, BATTLEFIELD_ALIASES)).toBe(true);
  });
});
