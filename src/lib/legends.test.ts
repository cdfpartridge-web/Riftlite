import { describe, expect, it } from "vitest";

import { getLegendImageUrl } from "@/lib/legends";

describe("getLegendImageUrl", () => {
  it("uses verified RiftAtlas card art for Vendetta legends", () => {
    expect(getLegendImageUrl("Akali")).toContain("VEN-139");
    expect(getLegendImageUrl("Shen")).toContain("VEN-147");
    expect(getLegendImageUrl("Jayce")).toContain("VEN-149");
    expect(getLegendImageUrl("Mel")).toContain("VEN-151");
    expect(getLegendImageUrl("Ambessa")).toContain("VEN-153");
    expect(getLegendImageUrl("Kennen")).toContain("VEN-155");
  });

  it("uses explicit Riftbound art for Master Yi variants", () => {
    expect(getLegendImageUrl("Master Yi")).toContain("557e41d84ac36ffa2bf805deda159f45e0a815f9");
    expect(getLegendImageUrl("Master Yi, Wuju Bladesman")).toContain("OGS-019");
    expect(getLegendImageUrl("Master Yi, Wuju Master")).toContain("557e41d84ac36ffa2bf805deda159f45e0a815f9");
    expect(getLegendImageUrl("Master Yi, Wuji Master")).toContain("557e41d84ac36ffa2bf805deda159f45e0a815f9");
  });

  it("uses a current Data Dragon fallback for standard legends", () => {
    expect(getLegendImageUrl("Diana")).toContain("/cdn/16.13.1/");
  });
});
