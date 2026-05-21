import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RiftLite Scorepad",
    short_name: "Scorepad",
    description:
      "Touch-first Riftbound scoring for table games, with offline saves and private RiftLite Desktop sync.",
    start_url: "/scorepad",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c1021",
    theme_color: "#101936",
    categories: ["games", "sports", "utilities"],
    icons: [
      { src: "/brand/riftlite-logo-ui.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/riftlite-logo-ui.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/brand/riftlite-logo-transparent.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
