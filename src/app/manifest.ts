import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RiftLite",
    short_name: "RiftLite",
    description:
      "Fully automatic Riftbound match tracking on TCGA and RiftAtlas. Study your matchups, replay key turns, browse the community meta, and stream with a live overlay.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c1021",
    theme_color: "#0c1021",
    icons: [
      { src: "/icon.png", sizes: "any", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
