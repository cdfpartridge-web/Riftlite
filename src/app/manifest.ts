import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RiftLite",
    short_name: "RiftLite",
    description:
      "Auto-track every Legends of Runeterra match, study your matchups, and stream with a live overlay.",
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
