import type { CommunityFilterParams } from "@/lib/types";

export const APP_NAME = "RiftLite";

export const BRAND = {
  bgDark: "#0C1021",
  bgMid: "#101732",
  panel: "#141D3D",
  card: "#18244B",
  border: "#304A8A",
  gold: "#59A7FF",
  goldLight: "#84E7FF",
  goldDim: "#355AB1",
  text: "#EAF2FF",
  textDim: "#9FB3D9",
  win: "#49C187",
  loss: "#FF6B7A",
  accent: "#72D7FF",
  violet: "#A67CFF",
};

// Upper bound on how many matches the aggregate doc holds and the cron
// scans from Firestore. The desktop client now expects the website to
// return the full set (limit=all), so this is also the cap on what the
// `/api/community/desktop` endpoint can serve.
//
// Cost: cron reads this many docs every 4 hours = 6 × WINDOW per day.
// At 2000 that's 12k Firestore reads/day, well under the Spark 50k quota.
//
// Doc size: matches are gzip+base64 packed before writing to Firestore
// (see data.ts encodeMatches). Real-world ratio is ~6-8× because deck
// lists and field names repeat heavily, so 2000 matches still fits well
// under Firestore's 1 MB per-document cap. If we ever push toward
// 4-5k+ we'll need to shard the aggregate across multiple docs.
export const COMMUNITY_WINDOW_SIZE = 2000;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MATCH_CACHE_MS = 60_000;
export const TWITCH_STATUS_CACHE_MS = 60_000;

export const SITE_PATHS = {
  home: "/",
  meta: "/community/meta",
  matrix: "/community/matrix",
  matches: "/community/matches",
  decks: "/community/decks",
  news: "/news",
  guide: "/guide",
  download: "/download",
  about: "/about",
  privacy: "/privacy",
  cookies: "/cookies",
};

export const DEFAULT_FILTERS: CommunityFilterParams = {
  legend: "",
  result: "",
  seat: "",
  battlefield: "",
  flags: "",
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};

export const LEGENDS = [
  "Ahri",
  "Annie",
  "Azir",
  "Darius",
  "Diana",
  "Draven",
  "Ezreal",
  "Fiora",
  "Garen",
  "Irelia",
  "Ivern",
  "Jax",
  "Jhin",
  "Jinx",
  "Kai'Sa",
  "Kha'Zix",
  "Lee Sin",
  "LeBlanc",
  "Leona",
  "Lillia",
  "Lucian",
  "Lux",
  "Master Yi (Wuju Bladesman)",
  "Master Yi (Wuju Master)",
  "Miss Fortune",
  "Ornn",
  "Poppy",
  "Pyke",
  "Rek'Sai",
  "Renata Glasc",
  "Rengar",
  "Rumble",
  "Sett",
  "Sivir",
  "Teemo",
  "Vex",
  "Vi",
  "Viktor",
  "Volibear",
  "Yasuo",
] as const;
