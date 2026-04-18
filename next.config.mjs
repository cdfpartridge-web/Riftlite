import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  images: {
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
