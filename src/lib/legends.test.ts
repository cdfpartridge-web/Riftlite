import { describe, expect, it } from "vitest";

import { getLegendCardImageUrl, getLegendImageUrl } from "@/lib/legends";

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

describe("getLegendCardImageUrl", () => {
  it("uses full Riftbound card artwork for the presenter", () => {
    expect(getLegendCardImageUrl("Ahri")).toContain("OGN-255/full-desktop-2x.avif");
    expect(getLegendCardImageUrl("Lux")).toContain("OGS-021/full-desktop-2x.avif");
    expect(getLegendCardImageUrl("Diana")).toContain("8bd4006c34aa020211e501e3cb7ee14ab5b4c41f");
  });

  it("keeps the verified Vendetta card resolver", () => {
    expect(getLegendCardImageUrl("Akali")).toContain("VEN-139");
  });
});
