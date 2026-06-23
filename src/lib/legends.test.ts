import { describe, expect, it } from "vitest";

import { getLegendImageUrl } from "@/lib/legends";

describe("getLegendImageUrl", () => {
  it("uses explicit Riftbound art for Master Yi variants", () => {
    expect(getLegendImageUrl("Master Yi, Wuju Bladesman")).toContain("OGS-019");
    expect(getLegendImageUrl("Master Yi, Wuju Master")).toContain("557e41d84ac36ffa2bf805deda159f45e0a815f9");
    expect(getLegendImageUrl("Master Yi, Wuji Master")).toContain("557e41d84ac36ffa2bf805deda159f45e0a815f9");
  });
});
