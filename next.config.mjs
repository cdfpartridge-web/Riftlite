import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  images: {
    // Vercel's free tier caps image-optimisation transformations at 5k/mo.
    // Our LegendChip is rendered hundreds of times per page (every match
    // row, every matchup row, every player profile) at multiple sizes,
    // and each (source × width × format) is a separate transformation.
    // That budget gets eaten in days under real traffic, so we disable
    // optimisation entirely and serve originals. Means slightly larger
    // payloads (no WebP/AVIF conversion, no responsive resizing) but
    // bandwidth is the cheaper resource here — Vercel free tier gives
    // 100 GB/mo bandwidth vs. 5k transformations.
    //
    // If we ever need optimisation back, the right move is to pre-bake
    // optimised variants at build time (e.g. via `sharp` in a script)
    // and ship them as static files rather than going through next/image.
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "static-cdn.jtvnw.net" },
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "cdn.sanity.io" },
      { protocol: "https", hostname: "www.piltoverarchive.com" },
      { protocol: "https", hostname: "piltoverarchive.com" },
      { protocol: "https", hostname: "tcg-arena.fr" },
      { protocol: "https", hostname: "ddragon.leagueoflegends.com" },
    ],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
