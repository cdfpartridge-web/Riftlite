import "server-only";

import { gzipSync, gunzipSync } from "node:zlib";

import { unstable_cache } from "next/cache";

import { canonicalChoice } from "@/lib/canonical";
import { buildLegendMeta, buildMatrix } from "@/lib/community/aggregate";
import {
  BATTLEFIELD_ALIASES,
  BATTLEFIELDS,
  COMMUNITY_CHUNK_SIZE,
  COMMUNITY_WINDOW_SIZE,
  LEGEND_ALIASES,
  LEGENDS,
} from "@/lib/constants";
import { FIXTURE_MATCHES } from "@/lib/fixtures/community";
import { getFirestoreAdmin } from "@/lib/firebase/admin";
import type {
  CommunityMatch,
  DeckSnapshot,
  LegendMetaRow,
  MatchGame,
  MatrixView,
} from "@/lib/types";

// Firestore caps a single doc at ~1 MB. Once the community started
// hitting 500+ matches with full deck snapshots (cards, image URLs,
// runes, battlefields), the raw JSON crossed that line and the cron's
// `set()` started 500ing. Gzipping the matches blob shrinks it ~6-8x
// because deck lists and field names repeat heavily. We base64 the
// result so it can live in a Firestore string field.
function encodeMatches(matches: CommunityMatch[]): string {
  return encodeJson(matches);
}
function encodeJson(value: unknown): string {
  const json = JSON.stringify(value);
  return gzipSync(json).toString("base64");
}
function decodeMatches(encoded: string): CommunityMatch[] | null {
  const parsed = decodeJson<unknown>(encoded);
  return Array.isArray(parsed) ? (parsed as CommunityMatch[]) : null;
}

function decodeJson<T>(encoded: string): T | null {
  try {
    const buf = Buffer.from(encoded, "base64");
    const json = gunzipSync(buf).toString("utf8");
    return JSON.parse(json) as T;
  } catch (error) {
    console.error("[community/data] decodeJson failed", error);
    return null;
  }
}

// 30 minutes. Community stats are intentionally not real-time, and the
// aggregate refresh path keeps public data fresh enough for app/site use.
// Longer TTLs directly reduce Vercel function work and Firestore reads.
const COMMUNITY_CACHE_TTL_SECONDS = 1800;

// Precomputed aggregate docs. A scheduled repair job writes the normalized
// match window into chunks so page/API renders avoid raw match scans. See:
//   src/app/api/community/aggregate/refresh/route.ts
//   .github/workflows/refresh-aggregates.yml
const AGGREGATE_COLLECTION = "aggregates";
const AGGREGATE_DOC_ID = "community-v1";
const AGGREGATE_CHUNK_PREFIX = `${AGGREGATE_DOC_ID}-chunk-`;
const PRIVATE_COUNTER_DOC_ID = "community-private-counters";
const PRIVATE_MATCH_INDEX_COLLECTION = "privateHubMatchIndex";
const PRIVATE_PLAYER_INDEX_COLLECTION = "privateHubPlayers";
const PUBLIC_PLAYERS_COLLECTION = "publicPlayers";
const COMMUNITY_RANGE_DAYS = [7, 14, 30] as const;
type CommunityRangeDays = (typeof COMMUNITY_RANGE_DAYS)[number];
type CommunityRangeWindow = {
  detailMatches: CommunityMatch[];
  statsMatches: CommunityMatch[];
};
type CommunityRangeWindows = Partial<Record<CommunityRangeDays, CommunityRangeWindow>>;
type CommunityRangeStats = {
  matchCount: number;
  detailMatchCount: number;
  firstCreatedAt: number;
  lastCreatedAt: number;
  rangeDays: CommunityRangeDays;
  legendMeta: LegendMetaRow[];
  matrix: MatrixView;
};

// If the aggregate docs haven't been updated in this long, treat them as
// unreliable. Keep this generous so a missed repair job serves the last
// cached window instead of forcing expensive live scans on hot paths.
const AGGREGATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const GENERIC_DISPLAY_NAMES = new Set([
  "riftlite player",
  "riftlite user",
  "a riftlite player",
  "player",
  "member",
  "owner",
]);
const GENERIC_DECK_NAMES = new Set([
  "riftbound",
  "tcga deck",
  "deck pending",
  "no deck",
  "no deck logged",
  "unknown",
]);

export type CommunityAggregateCounts = {
  privateMatchCount: number;
  privatePlayerCount: number;
  publicLifetimeMatchCount?: number;
  publicLifetimePlayerCount?: number;
  publicPlayerIndexReady?: boolean;
};

function toNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") {
    return undefined;
  }

  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return undefined;
  }

  return Math.floor(n);
}

function publicPlayerDocId(uid: string): string {
  return encodeURIComponent(uid.trim());
}

function countWindowPlayers(matches: CommunityMatch[]): number {
  const players = new Set(
    matches
      .map((match) => match.uid || match.username)
      .filter((player) => player.trim().length > 0),
  );
  return players.size;
}

// Hard daily ceiling on the live-collection fallback. If aggregate reads
// break, repeated cache misses could otherwise trigger WINDOW_SIZE-doc
// scans and blow past the Spark quota. We allow at most this many live
// scans per process before falling back to fixtures.
//
// Module-level state — Vercel function instances each carry their own
// counter, but each instance handles many requests so this still
// flattens fallback storms within an instance. For belt-and-braces
// across instances we'd need a shared store; this guard is "good
// enough" given the cron is reliable post-gzip-fix.
const FALLBACK_DAILY_CAP = 1;
let fallbackCount = 0;
let fallbackWindowStart = 0;
const FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function chunkMatches<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function aggregateChunkDocId(index: number): string {
  return `${AGGREGATE_CHUNK_PREFIX}${index}`;
}

function rangeDocId(days: CommunityRangeDays): string {
  return `community-range-${days}d`;
}

function rangeChunkDocId(days: CommunityRangeDays, index: number): string {
  return `${rangeDocId(days)}-chunk-${index}`;
}

function matchCreatedAtMs(match: CommunityMatch): number {
  const raw = Number(match.createdAt ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

function sortedByCreatedAtDesc(matches: CommunityMatch[]): CommunityMatch[] {
  return [...matches].sort((a, b) => matchCreatedAtMs(b) - matchCreatedAtMs(a));
}

function buildRangeStats(
  days: CommunityRangeDays,
  statsMatches: CommunityMatch[],
  detailMatchCount: number,
): CommunityRangeStats {
  const sorted = sortedByCreatedAtDesc(statsMatches);
  const times = sorted
    .map((match) => matchCreatedAtMs(match))
    .filter((time) => Number.isFinite(time) && time > 0);
  const firstCreatedAt = times.length ? Math.min(...times) : 0;
  const lastCreatedAt = times.length ? Math.max(...times) : 0;
  const matrix = buildMatrix(sorted);
  return {
    matchCount: sorted.length,
    detailMatchCount,
    firstCreatedAt,
    lastCreatedAt,
    rangeDays: days,
    legendMeta: buildLegendMeta(sorted),
    matrix: {
      ...matrix,
      sourceMatchCount: sorted.length,
      detailMatchCount,
      sourceFirstCreatedAt: firstCreatedAt,
      sourceLastCreatedAt: lastCreatedAt,
      sourceRangeDays: days,
    },
  };
}

export function filterCommunityMatchesByDays(matches: CommunityMatch[], days: number, now = Date.now()) {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return matches.filter((match) => matchCreatedAtMs(match) >= cutoff);
}

function firstString(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function bestDisplayName(source: Record<string, unknown>, uid: string): string {
  for (const key of ["username", "owner_display_name", "ownerDisplayName", "displayName", "owner_handle", "ownerHandle"]) {
    const value = firstString(source, key);
    if (value && !isGenericDisplayName(value)) return value;
  }
  return uid ? `Player#${uid.slice(0, 6)}` : "Unknown player";
}

function isGenericDisplayName(value: string): boolean {
  const cleaned = value.trim().toLowerCase().replace(/\s+/g, " ");
  return !cleaned || GENERIC_DISPLAY_NAMES.has(cleaned) || /^player(?:[ #_-]|$)/i.test(cleaned);
}

function isGenericDeckValue(value: string): boolean {
  const cleaned = value.trim().toLowerCase().replace(/^tcga:/, "").replace(/\s+/g, " ");
  return !cleaned || GENERIC_DECK_NAMES.has(cleaned);
}

function cleanDeckName(value: string): string {
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned && !isGenericDeckValue(cleaned) ? cleaned : "";
}

function cleanDeckSource(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) return "";
  const tcgaDeckKey = cleaned.match(/^tcga:\/\/deck\/(.+)$/i)?.[1] ?? cleaned;
  return isGenericDeckValue(tcgaDeckKey) ? "" : cleaned;
}

function cleanLegendName(value: string): string {
  return canonicalChoice(value, LEGENDS, LEGEND_ALIASES) || value.trim();
}

function cleanBattlefieldName(value: string): string {
  return canonicalChoice(value, BATTLEFIELDS, BATTLEFIELD_ALIASES) || value.trim();
}

function firstNumber(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function firstBoolean(source: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const text = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(text)) return true;
    if (["false", "0", "no", "n"].includes(text)) return false;
  }
  return false;
}

function firstStringArray(source: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }
    const text = String(value).trim();
    if (!text) continue;
    const parsed = text.startsWith("[") ? safeJsonParse(text) : null;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
    return text.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeGames(value: unknown, match: Record<string, unknown>): MatchGame[] {
  const source =
    typeof value === "string" && value
      ? safeJsonParse(value)
      : Array.isArray(value)
        ? value
        : [];

  if (Array.isArray(source) && source.length > 0) {
    return source.map((rawGame) => {
      const game = rawGame as Record<string, unknown>;
      const myBf = cleanBattlefieldName(firstString(game, "my_bf", "myBf", "myBattlefield", "my_battlefield"));
      const oppBf = cleanBattlefieldName(firstString(game, "opp_bf", "oppBf", "opponentBattlefield", "opp_battlefield"));
      const shouldUseMatchBattlefields = source.length === 1 || (!myBf && !oppBf);
      return {
        myBf: myBf || (shouldUseMatchBattlefields ? firstString(match, "my_battlefield", "myBattlefield") : ""),
        oppBf: oppBf || (shouldUseMatchBattlefields ? firstString(match, "opp_battlefield", "oppBattlefield", "opponentBattlefield") : ""),
        wentFirst: firstString(game, "went_first", "wentFirst") || firstString(match, "went_first", "wentFirst"),
        result: firstString(game, "result"),
        myPoints: firstNumber(game, "my_points", "myPoints", "myScore", "my_score"),
        oppPoints: firstNumber(game, "opp_points", "oppPoints", "oppScore", "opponentScore", "opp_score"),
      };
    });
  }

  const fallbackMyBf = cleanBattlefieldName(firstString(match, "my_battlefield", "myBattlefield"));
  const fallbackOppBf = cleanBattlefieldName(firstString(match, "opp_battlefield", "oppBattlefield", "opponentBattlefield"));
  const fallbackSeat = firstString(match, "went_first", "wentFirst");
  if (fallbackMyBf || fallbackOppBf || fallbackSeat) {
    return [
      {
        myBf: fallbackMyBf,
        oppBf: fallbackOppBf,
        wentFirst: fallbackSeat,
        result: String(match.result ?? "").trim(),
        myPoints: 0,
        oppPoints: 0,
      },
    ];
  }

  return [];
}

function normalizeSnapshot(value: unknown): DeckSnapshot | null {
  if (!value) {
    return null;
  }

  const parsed =
    typeof value === "string" ? safeJsonParse(value) : (value as DeckSnapshot);

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const s = parsed as Record<string, unknown>;

  function getArr(...keys: string[]): DeckSnapshot["mainDeck"] {
    for (const k of keys) {
      const v = s[k];
      if (Array.isArray(v) && v.length > 0) return v as DeckSnapshot["mainDeck"];
    }
    return [];
  }

  function getEntry(...keys: string[]): DeckSnapshot["legendEntry"] {
    for (const k of keys) {
      const v = s[k];
      if (Array.isArray(v) && v.length > 0) return (v as DeckSnapshot["mainDeck"])[0];
      if (v && typeof v === "object" && !Array.isArray(v)) return v as DeckSnapshot["legendEntry"];
    }
    return null;
  }

  return {
    title: (s.title as string | undefined),
    legend: (s.legend as string) ?? "",
    legendKey: (s.legendKey ?? s.legend_key ?? s.legend) as string ?? "",
    sourceUrl: (s.sourceUrl ?? s.source_url ?? "") as string,
    sourceKey: (s.sourceKey ?? s.source_key ?? "") as string,
    legendEntry: getEntry("legendEntry", "legend_entry", "Legend"),
    champion: getArr("champion", "Champion"),
    runes: getArr("runes", "Runes"),
    battlefields: getArr("battlefields", "Battlefields"),
    mainDeck: getArr("mainDeck", "main_deck", "MainDeck", "mainboard", "Mainboard", "cards", "Cards"),
    sideboard: getArr("sideboard", "Sideboard"),
  };
}

export function normalizeMatch(id: string, raw: Record<string, unknown>): CommunityMatch {
  const uid = String(raw.uid ?? "").trim();
  const username = bestDisplayName(raw, uid);
  const deckSnapshot = normalizeSnapshot(raw.my_deck_snapshot_json ?? raw.deckSnapshot);
  const myChampion = cleanLegendName(
    firstString(raw, "my_champion", "myChampion") ||
      deckSnapshot?.legend ||
      deckSnapshot?.legendEntry?.name ||
      "",
  );
  return {
    id,
    uid,
    username,
    date: firstString(raw, "date"),
    result: firstString(raw, "result"),
    myChampion,
    oppChampion: cleanLegendName(firstString(raw, "opp_champion", "oppChampion")),
    oppName: firstString(raw, "opp_name", "oppName"),
    fmt: firstString(raw, "fmt", "format") || "Bo1",
    score: firstString(raw, "score"),
    wentFirst: firstString(raw, "went_first", "wentFirst"),
    myBattlefield: cleanBattlefieldName(firstString(raw, "my_battlefield", "myBattlefield")),
    oppBattlefield: cleanBattlefieldName(firstString(raw, "opp_battlefield", "oppBattlefield", "opponentBattlefield")),
    flags: firstString(raw, "flags"),
    games: normalizeGames(raw.games_json ?? raw.games, raw),
    deckName: cleanDeckName(firstString(raw, "my_deck_name", "deckName", "myDeckName")),
    deckSourceUrl: cleanDeckSource(firstString(raw, "my_deck_source_url", "deckSourceUrl")),
    deckSourceKey: cleanDeckSource(firstString(raw, "my_deck_source_key", "deckSourceKey")),
    deckSnapshot,
    createdAt: Number(raw.created_at ?? raw.createdAt ?? Date.now()),
    manualRepair: firstBoolean(raw, "manual_repair", "manualRepair"),
    combinedFromMatchIds: firstStringArray(raw, "combined_from_match_ids", "combinedFromMatchIds"),
    mergedIntoMatchId: firstString(raw, "merged_into_match_id", "mergedIntoMatchId"),
    superseded: firstBoolean(raw, "superseded"),
    supersededAt: firstString(raw, "superseded_at", "supersededAt"),
  };
}

function repairCachedCommunityMatch(match: CommunityMatch): CommunityMatch {
  return normalizeMatch(match.id, match as unknown as Record<string, unknown>);
}

function repairCachedCommunityMatches(matches: CommunityMatch[]): CommunityMatch[] {
  return matches
    .map((match) => repairCachedCommunityMatch(match))
    .filter((match) => !match.superseded);
}

/**
 * Read cached private-hub aggregate-only counts.
 *
 * Private hubs live at `hubs/{id}/matches/{doc}` in Firestore — a
 * completely separate tree from the public `matches` collection. We
 * deliberately only extract COUNTS and unique UIDs here; the actual
 * match bodies, deck lists, matchup results, etc. never leave this
 * function. That keeps private hub data private while still letting
 * the homepage reflect that those games happened.
 */
async function fetchPrivateHubStats(): Promise<{
  privateMatchCount: number;
  privatePlayerCount: number;
}> {
  const db = getFirestoreAdmin();
  if (!db) {
    return { privateMatchCount: 0, privatePlayerCount: 0 };
  }

  const counters = await db
    .collection(AGGREGATE_COLLECTION)
    .doc(PRIVATE_COUNTER_DOC_ID)
    .get();
  if (counters.exists) {
    const data = counters.data() ?? {};
    return {
      privateMatchCount: toNonNegativeInteger(data.privateMatchCount) ?? 0,
      privatePlayerCount: toNonNegativeInteger(data.privatePlayerCount) ?? 0,
    };
  }

  const aggregate = await db
    .collection(AGGREGATE_COLLECTION)
    .doc(AGGREGATE_DOC_ID)
    .get();
  if (aggregate.exists) {
    const data = aggregate.data() ?? {};
    return {
      privateMatchCount: toNonNegativeInteger(data.privateMatchCount) ?? 0,
      privatePlayerCount: toNonNegativeInteger(data.privatePlayerCount) ?? 0,
    };
  }

  return { privateMatchCount: 0, privatePlayerCount: 0 };
}

/**
 * Read the raw match window straight from the `matches` collection.
 * Costs COMMUNITY_WINDOW_SIZE reads per call — avoid on hot user paths.
 * Used by (a) the cron refresh route, (b) the fallback path when the
 * aggregate doc is missing or stale.
 */
async function fetchMatchesFromCollection(): Promise<CommunityMatch[] | null> {
  const db = getFirestoreAdmin();
  if (!db) {
    return null;
  }

  const [modernSnapshot, legacySnapshot] = await Promise.all([
    db
      .collection("matches")
      .orderBy("created_at", "desc")
      .limit(COMMUNITY_WINDOW_SIZE)
      .get(),
    db
      .collection("matches")
      .orderBy("createdAt", "desc")
      .limit(COMMUNITY_WINDOW_SIZE)
      .get()
      .catch((error) => {
        console.error("[community/data] Legacy createdAt latest query failed", error);
        return null;
      }),
  ]);

  return mergeCommunityMatches(
    docsToCommunityMatches(modernSnapshot.docs),
    legacySnapshot ? docsToCommunityMatches(legacySnapshot.docs) : [],
  ).slice(0, COMMUNITY_WINDOW_SIZE);
}

/**
 * Count every public match without downloading the match documents.
 * Firestore answers this from indexes, so the scheduled refresh can
 * initialise/repair the lifetime counter cheaply. It is also used as
 * a temporary cached fallback if production has deployed the code but
 * the aggregate doc has not yet been refreshed with the new field.
 */
async function fetchPublicLifetimeMatchCount(): Promise<number | null> {
  const db = getFirestoreAdmin();
  if (!db) {
    return null;
  }

  try {
    const [totalSnapshot, supersededSnapshot] = await Promise.all([
      db.collection("matches").count().get(),
      db.collection("matches").where("superseded", "==", true).count().get(),
    ]);
    const total = toNonNegativeInteger(totalSnapshot.data().count) ?? 0;
    const superseded = toNonNegativeInteger(supersededSnapshot.data().count) ?? 0;
    return Math.max(0, total - superseded);
  } catch (error) {
    console.error("[community/data] Public match count failed", error);
    return null;
  }
}

async function fetchPublicLifetimePlayerCount(): Promise<number | null> {
  const db = getFirestoreAdmin();
  if (!db) {
    return null;
  }

  try {
    const snapshot = await db.collection(PUBLIC_PLAYERS_COLLECTION).count().get();
    return toNonNegativeInteger(snapshot.data().count) ?? 0;
  } catch (error) {
    console.error("[community/data] Public player count failed", error);
    return null;
  }
}

async function fetchRangeMatchesFromCollection(
  days: CommunityRangeDays,
  options: { limitToDetailWindow?: boolean } = { limitToDetailWindow: true },
): Promise<CommunityMatch[] | null> {
  const db = getFirestoreAdmin();
  if (!db) {
    return null;
  }

  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  // Public match docs have historically stored created_at as Unix seconds.
  // Query with seconds, then post-filter through matchCreatedAtMs so mixed
  // second/ms docs still produce an exact range.
  const cutoffSeconds = Math.floor(cutoffMs / 1000);
  const buildQuery = (field: "created_at" | "createdAt") => {
    let query = db
      .collection("matches")
      .where(field, ">=", cutoffSeconds)
      .orderBy(field, "desc");
    if (options.limitToDetailWindow !== false) {
      query = query.limit(COMMUNITY_WINDOW_SIZE);
    }
    return query;
  };

  const [modernSnapshot, legacySnapshot] = await Promise.all([
    buildQuery("created_at").get(),
    buildQuery("createdAt")
      .get()
      .catch((error) => {
        console.error(`[community/data] Legacy createdAt ${days}d query failed`, error);
        return null;
      }),
  ]);

  const matches = filterCommunityMatchesByDays(
    mergeCommunityMatches(
      docsToCommunityMatches(modernSnapshot.docs),
      legacySnapshot ? docsToCommunityMatches(legacySnapshot.docs) : [],
    ),
    days,
  );

  return options.limitToDetailWindow === false
    ? matches
    : matches.slice(0, COMMUNITY_WINDOW_SIZE);
}

function docsToCommunityMatches(
  docs: Array<{ id: string; data(): Record<string, unknown> }>,
): CommunityMatch[] {
  return docs
    .map((doc) => normalizeMatch(doc.id, doc.data()))
    .filter((match) => !match.superseded);
}

function mergeCommunityMatches(...batches: CommunityMatch[][]): CommunityMatch[] {
  const byId = new Map<string, CommunityMatch>();
  for (const batch of batches) {
    for (const match of batch) {
      if (!match.id || match.superseded || byId.has(match.id)) continue;
      byId.set(match.id, match);
    }
  }
  return sortedByCreatedAtDesc([...byId.values()]);
}

function decodeMatchesFromAggregateData(data: Record<string, unknown>): CommunityMatch[] | null {
  const matchesGz = typeof data.matchesGz === "string" ? data.matchesGz : "";
  const matchesJson = typeof data.matchesJson === "string" ? data.matchesJson : "";

  if (matchesGz) {
    const decoded = decodeMatches(matchesGz);
    if (decoded) return repairCachedCommunityMatches(decoded);
  }

  if (matchesJson) {
    const parsed = safeJsonParse(matchesJson);
    if (Array.isArray(parsed)) return repairCachedCommunityMatches(parsed as CommunityMatch[]);
  }

  return null;
}

function buildRangeAggregateManifest(
  days: CommunityRangeDays,
  detailMatchCount: number,
  chunkCount: number,
  updatedAt: number,
  rangeSource: "collection" | "latest-window",
  stats: CommunityRangeStats,
) {
  return {
    updatedAt,
    rangeDays: days,
    rangeSource,
    windowSize: COMMUNITY_WINDOW_SIZE,
    matchCount: detailMatchCount,
    detailMatchCount,
    statsMatchCount: stats.matchCount,
    statsFirstCreatedAt: stats.firstCreatedAt,
    statsLastCreatedAt: stats.lastCreatedAt,
    chunkSize: COMMUNITY_CHUNK_SIZE,
    chunkCount,
    statsGz: encodeJson(stats),
    matchesGz: null,
    matchesJson: null,
  };
}

/**
 * One-time repair path for the player index. It scans the public match
 * collection once, writes one tiny doc per unique uid, then future
 * appends keep the index current with one extra read per match.
 */
async function rebuildPublicPlayerIndexFromMatches(): Promise<{
  publicLifetimePlayerCount: number;
  publicPlayerIndexReady: boolean;
} | null> {
  const db = getFirestoreAdmin();
  if (!db) {
    return null;
  }

  try {
    const snapshot = await db
      .collection("matches")
      .select("uid", "username", "created_at")
      .get();
    const players = new Map<
      string,
      { username: string; firstSeenAt: number; lastSeenAt: number }
    >();

    for (const doc of snapshot.docs) {
      const uid = String(doc.get("uid") ?? "").trim();
      if (!uid) {
        continue;
      }

      const username =
        String(doc.get("username") ?? "").trim() || `Player#${uid.slice(0, 6)}`;
      const createdAt = toNonNegativeInteger(doc.get("created_at")) ?? 0;
      const existing = players.get(uid);
      players.set(uid, {
        username: username || existing?.username || `Player#${uid.slice(0, 6)}`,
        firstSeenAt: existing
          ? Math.min(existing.firstSeenAt || createdAt, createdAt)
          : createdAt,
        lastSeenAt: existing ? Math.max(existing.lastSeenAt, createdAt) : createdAt,
      });
    }

    const now = Date.now();
    let batch = db.batch();
    let ops = 0;

    for (const [uid, player] of players) {
      batch.set(
        db.collection(PUBLIC_PLAYERS_COLLECTION).doc(publicPlayerDocId(uid)),
        {
          uid,
          username: player.username,
          firstSeenAt: player.firstSeenAt,
          lastSeenAt: player.lastSeenAt,
          updatedAt: now,
        },
        { merge: true },
      );
      ops += 1;

      if (ops >= 450) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }

    if (ops > 0) {
      await batch.commit();
    }

    return {
      publicLifetimePlayerCount: players.size,
      publicPlayerIndexReady: true,
    };
  } catch (error) {
    console.error("[community/data] Public player index rebuild failed", error);
    return null;
  }
}

/**
 * Read the precomputed aggregate manifest plus match chunks.
 * Costs a small fixed number of reads instead of scanning raw matches.
 * Returns null if the doc doesn't exist, can't be parsed, or is older
 * than AGGREGATE_MAX_AGE_MS. The stale window is deliberately generous:
 * serving a slightly stale cache is safer than scanning thousands of raw
 * match docs during normal page/API requests.
 */
async function fetchMatchesFromAggregate(): Promise<CommunityMatch[] | null> {
  const db = getFirestoreAdmin();
  if (!db) {
    return null;
  }

  const snap = await db.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOC_ID).get();
  if (!snap.exists) {
    return null;
  }

  const data = snap.data() ?? {};
  const updatedAt = Number(data.updatedAt ?? 0);

  if (updatedAt > 0 && Date.now() - updatedAt > AGGREGATE_MAX_AGE_MS) {
    console.warn(
      "[community/data] Aggregate doc is stale (>7d old), falling back to live read",
    );
    return null;
  }

  const chunkCount = toNonNegativeInteger(data.chunkCount) ?? 0;
  if (chunkCount > 0) {
    const chunkSnaps = await Promise.all(
      Array.from({ length: chunkCount }, (_, index) =>
        db.collection(AGGREGATE_COLLECTION).doc(aggregateChunkDocId(index)).get(),
      ),
    );
    const chunks: CommunityMatch[] = [];
    let missingChunk = false;
    for (const chunkSnap of chunkSnaps) {
      if (!chunkSnap.exists) {
        missingChunk = true;
        break;
      }
      const decoded = decodeMatchesFromAggregateData(chunkSnap.data() ?? {});
      if (!decoded) {
        missingChunk = true;
        break;
      }
      chunks.push(...decoded);
    }
    if (!missingChunk) {
      return chunks.slice(0, COMMUNITY_WINDOW_SIZE);
    }
    console.warn("[community/data] Aggregate chunk missing or unreadable, trying legacy aggregate blob");
  }

  // Fall back to the legacy single-doc blob during rollout or if a
  // chunked write was interrupted.
  return decodeMatchesFromAggregateData(data);
}

async function fetchRangeAggregatePayload(
  days: CommunityRangeDays,
): Promise<{
  matches: CommunityMatch[];
  collectionBacked: boolean;
  stats: CommunityRangeStats | null;
} | null> {
  const db = getFirestoreAdmin();
  if (!db) {
    return null;
  }

  const snap = await db.collection(AGGREGATE_COLLECTION).doc(rangeDocId(days)).get();
  if (!snap.exists) {
    return null;
  }

  const data = snap.data() ?? {};
  const updatedAt = Number(data.updatedAt ?? 0);
  if (updatedAt > 0 && Date.now() - updatedAt > AGGREGATE_MAX_AGE_MS) {
    return null;
  }
  const collectionBacked =
    data.rangeSource === "collection" &&
    (toNonNegativeInteger(data.windowSize) ?? 0) >= COMMUNITY_WINDOW_SIZE;
  const stats =
    typeof data.statsGz === "string"
      ? decodeJson<CommunityRangeStats>(data.statsGz)
      : null;

  const chunkCount = toNonNegativeInteger(data.chunkCount) ?? 0;
  if (chunkCount > 0) {
    const chunkSnaps = await Promise.all(
      Array.from({ length: chunkCount }, (_, index) =>
        db.collection(AGGREGATE_COLLECTION).doc(rangeChunkDocId(days, index)).get(),
      ),
    );
    const matches: CommunityMatch[] = [];
    for (const chunkSnap of chunkSnaps) {
      if (!chunkSnap.exists) return null;
      const decoded = decodeMatchesFromAggregateData(chunkSnap.data() ?? {});
      if (!decoded) return null;
      matches.push(...decoded);
    }
    return { matches, collectionBacked, stats };
  }

  const matches = decodeMatchesFromAggregateData(data);
  return matches ? { matches, collectionBacked, stats } : null;
}

async function fetchMatchesFromRangeAggregate(
  days: CommunityRangeDays,
): Promise<CommunityMatch[] | null> {
  const payload = await fetchRangeAggregatePayload(days);
  return payload?.matches ?? null;
}

async function fetchStatsFromRangeAggregate(
  days: CommunityRangeDays,
): Promise<CommunityRangeStats | null> {
  const payload = await fetchRangeAggregatePayload(days);
  if (!payload) {
    return null;
  }
  return payload.stats ?? buildRangeStats(days, payload.matches, payload.matches.length);
}

async function fetchRangeMatchesForRefresh(
  days: CommunityRangeDays,
  latestMatches: CommunityMatch[],
  rangeSourceMatches?: CommunityMatch[] | null,
): Promise<CommunityRangeWindow | null> {
  if (rangeSourceMatches) {
    const statsMatches = filterCommunityMatchesByDays(rangeSourceMatches, days);
    return {
      statsMatches,
      detailMatches: sortedByCreatedAtDesc(statsMatches).slice(0, COMMUNITY_WINDOW_SIZE),
    };
  }

  const existing = await fetchRangeAggregatePayload(days);
  if (existing?.collectionBacked) {
    const byId = new Map<string, CommunityMatch>();
    const existingStats = existing.stats?.matchCount
      ? existing.matches
      : existing.matches;
    for (const match of [...latestMatches, ...existingStats]) {
      if (!match.id || byId.has(match.id)) continue;
      byId.set(match.id, match);
    }
    const statsMatches = sortedByCreatedAtDesc(
      filterCommunityMatchesByDays([...byId.values()], days),
    );
    return {
      statsMatches,
      detailMatches: statsMatches.slice(0, COMMUNITY_WINDOW_SIZE),
    };
  }

  const statsMatches = await fetchRangeMatchesFromCollection(days, {
    limitToDetailWindow: false,
  });
  return statsMatches
    ? {
        statsMatches,
        detailMatches: sortedByCreatedAtDesc(statsMatches).slice(
          0,
          COMMUNITY_WINDOW_SIZE,
        ),
      }
    : null;
}

/**
 * Write the full normalized match window to the aggregate doc. Called
 * only by the cron refresh route, never on a user request path.
 *
 * Also stamps lifetime public/private counter fields on the same doc
 * so user-facing pages can read headline totals in a single Firestore
 * read.
 */
async function writeMatchesToAggregate(
  matches: CommunityMatch[],
  privateBoost: { privateMatchCount: number; privatePlayerCount: number },
  publicLifetimeMatchCount: number | null,
  publicPlayerStats: {
    publicLifetimePlayerCount: number;
    publicPlayerIndexReady: boolean;
  } | null,
  rangeWindows: CommunityRangeWindows = {},
): Promise<{
  publicLifetimeMatchCount: number;
  publicLifetimePlayerCount?: number;
  publicPlayerIndexReady: boolean;
}> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firestore admin is not configured");
  }

  const ref = db.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOC_ID);
  let existingPublicLifetimeMatchCount: number | undefined;
  let existingPublicLifetimePlayerCount: number | undefined;
  let existingPublicPlayerIndexReady = false;
  if (publicLifetimeMatchCount === null || publicPlayerStats === null) {
    const existing = await ref.get();
    const data = existing.data() ?? {};
    existingPublicLifetimeMatchCount = toNonNegativeInteger(data.publicLifetimeMatchCount);
    existingPublicLifetimePlayerCount = toNonNegativeInteger(
      data.publicLifetimePlayerCount,
    );
    existingPublicPlayerIndexReady = data.publicPlayerIndexReady === true;
  }
  const resolvedPublicLifetimeMatchCount = Math.max(
    publicLifetimeMatchCount ?? existingPublicLifetimeMatchCount ?? matches.length,
    matches.length,
  );
  const publicPlayerIndexReady =
    publicPlayerStats?.publicPlayerIndexReady ?? existingPublicPlayerIndexReady;
  const publicLifetimePlayerCount = publicPlayerIndexReady
    ? Math.max(
        publicPlayerStats?.publicLifetimePlayerCount ??
          existingPublicLifetimePlayerCount ??
          countWindowPlayers(matches),
        countWindowPlayers(matches),
      )
    : existingPublicLifetimePlayerCount;

  const updatedAt = Date.now();
  const previousChunkCount = toNonNegativeInteger((await ref.get()).data()?.chunkCount) ?? 0;
  const chunks = chunkMatches(matches, COMMUNITY_CHUNK_SIZE);
  const batch = db.batch();

  for (let index = 0; index < chunks.length; index += 1) {
    batch.set(db.collection(AGGREGATE_COLLECTION).doc(aggregateChunkDocId(index)), {
      updatedAt,
      index,
      chunkSize: COMMUNITY_CHUNK_SIZE,
      matchCount: chunks[index].length,
      matchesGz: encodeMatches(chunks[index]),
      matchesJson: null,
    });
  }
  for (let index = chunks.length; index < previousChunkCount; index += 1) {
    batch.delete(db.collection(AGGREGATE_COLLECTION).doc(aggregateChunkDocId(index)));
  }

  for (const days of COMMUNITY_RANGE_DAYS) {
    const hasRangeWindow = rangeWindows[days] !== undefined;
    const fallbackStatsMatches = filterCommunityMatchesByDays(matches, days, updatedAt);
    const statsMatches = rangeWindows[days]?.statsMatches ?? fallbackStatsMatches;
    const detailMatches =
      rangeWindows[days]?.detailMatches ??
      sortedByCreatedAtDesc(fallbackStatsMatches).slice(0, COMMUNITY_WINDOW_SIZE);
    const rangeStats = buildRangeStats(days, statsMatches, detailMatches.length);
    const rangeChunks = chunkMatches(detailMatches, COMMUNITY_CHUNK_SIZE);
    for (let index = 0; index < rangeChunks.length; index += 1) {
      batch.set(db.collection(AGGREGATE_COLLECTION).doc(rangeChunkDocId(days, index)), {
        updatedAt,
        rangeDays: days,
        index,
        chunkSize: COMMUNITY_CHUNK_SIZE,
        matchCount: rangeChunks[index].length,
        matchesGz: encodeMatches(rangeChunks[index]),
        matchesJson: null,
      });
    }
    batch.set(
      db.collection(AGGREGATE_COLLECTION).doc(rangeDocId(days)),
      buildRangeAggregateManifest(
        days,
        detailMatches.length,
        rangeChunks.length,
        updatedAt,
        hasRangeWindow ? "collection" : "latest-window",
        rangeStats,
      ),
    );
  }

  batch.set(ref, {
    updatedAt,
    matchCount: matches.length,
    windowSize: COMMUNITY_WINDOW_SIZE,
    chunkSize: COMMUNITY_CHUNK_SIZE,
    chunkCount: chunks.length,
    publicLifetimeMatchCount: resolvedPublicLifetimeMatchCount,
    ...(publicLifetimePlayerCount === undefined
      ? {}
      : { publicLifetimePlayerCount }),
    publicPlayerIndexReady,
    // Match bodies now live in chunk docs. Keep legacy fields empty so
    // this manifest stays small as the detailed window grows.
    matchesGz: null,
    matchesJson: null,
    privateMatchCount: privateBoost.privateMatchCount,
    privatePlayerCount: privateBoost.privatePlayerCount,
  });
  await batch.commit();

  return {
    publicLifetimeMatchCount: resolvedPublicLifetimeMatchCount,
    publicLifetimePlayerCount,
    publicPlayerIndexReady,
  };
}

/**
 * Read aggregate-only counters from the aggregate doc. Cheap: 1
 * Firestore read, no match bodies. Returns zeros if the doc is
 * missing or counter fields aren't populated yet.
 */
async function fetchAggregateCountsFromAggregate(): Promise<CommunityAggregateCounts> {
  const db = getFirestoreAdmin();
  if (!db) {
    return { privateMatchCount: 0, privatePlayerCount: 0 };
  }
  try {
    const snap = await db
      .collection(AGGREGATE_COLLECTION)
      .doc(AGGREGATE_DOC_ID)
      .get();
    if (!snap.exists) {
      return { privateMatchCount: 0, privatePlayerCount: 0 };
    }
    const data = snap.data() ?? {};
    let publicLifetimeMatchCount = toNonNegativeInteger(
      data.publicLifetimeMatchCount,
    );
    if (publicLifetimeMatchCount === undefined) {
      publicLifetimeMatchCount =
        (await fetchPublicLifetimeMatchCount()) ?? undefined;
    }
    const publicPlayerIndexReady = data.publicPlayerIndexReady === true;
    let publicLifetimePlayerCount = toNonNegativeInteger(
      data.publicLifetimePlayerCount,
    );
    if (publicPlayerIndexReady && publicLifetimePlayerCount === undefined) {
      publicLifetimePlayerCount =
        (await fetchPublicLifetimePlayerCount()) ?? undefined;
    }

    return {
      privateMatchCount: toNonNegativeInteger(data.privateMatchCount) ?? 0,
      privatePlayerCount: toNonNegativeInteger(data.privatePlayerCount) ?? 0,
      publicLifetimeMatchCount,
      publicLifetimePlayerCount,
      publicPlayerIndexReady:
        publicPlayerIndexReady && publicLifetimePlayerCount !== undefined,
    };
  } catch (error) {
    console.error("[community/data] Aggregate counts fetch failed", error);
    return { privateMatchCount: 0, privatePlayerCount: 0 };
  }
}

const cachedFetchAggregateCounts = unstable_cache(
  fetchAggregateCountsFromAggregate,
  ["community-aggregate-counts-v1"],
  { revalidate: COMMUNITY_CACHE_TTL_SECONDS, tags: ["community-matches"] },
);

export async function getCommunityAggregateCounts() {
  try {
    return await cachedFetchAggregateCounts();
  } catch {
    return fetchAggregateCountsFromAggregate();
  }
}

export async function getCommunityPrivateBoost() {
  const counts = await getCommunityAggregateCounts();
  return {
    privateMatchCount: counts.privateMatchCount,
    privatePlayerCount: counts.privatePlayerCount,
  };
}

async function fetchCommunityMatchesSafe() {
  try {
    // Preferred path: single-doc read of the cron-maintained aggregate.
    const fromAggregate = await fetchMatchesFromAggregate();
    if (fromAggregate) {
      return fromAggregate;
    }

    if (process.env.RIFTLITE_ALLOW_COMMUNITY_LIVE_FALLBACK !== "1") {
      console.warn(
        "[community/data] Aggregate unavailable; live fallback disabled on hot path",
      );
      return FIXTURE_MATCHES;
    }

    // Fallback path: live collection scan. Costs WINDOW_SIZE Firestore
    // reads, which is fine occasionally but ruinous if it fires on
    // every cache miss. Hard-cap to FALLBACK_DAILY_CAP per process per
    // 24h so a broken cron can't quietly drain the read quota. After
    // the cap, return fixtures and lean on the cron being fixed.
    const now = Date.now();
    if (now - fallbackWindowStart > FALLBACK_WINDOW_MS) {
      fallbackWindowStart = now;
      fallbackCount = 0;
    }
    if (fallbackCount >= FALLBACK_DAILY_CAP) {
      console.warn(
        "[community/data] Aggregate unavailable AND fallback budget spent; serving fixtures",
      );
      return FIXTURE_MATCHES;
    }
    fallbackCount += 1;
    console.warn(
      `[community/data] Aggregate unavailable, live-scan fallback #${fallbackCount}/${FALLBACK_DAILY_CAP}`,
    );
    const live = await fetchMatchesFromCollection();
    return live ?? FIXTURE_MATCHES;
  } catch (error) {
    console.error("[community/data] Firestore fetch failed, using fixtures", error);
    return FIXTURE_MATCHES;
  }
}

const cachedFetchCommunityMatches = unstable_cache(
  fetchCommunityMatchesSafe,
  ["community-match-window-v4"],
  { revalidate: COMMUNITY_CACHE_TTL_SECONDS, tags: ["community-matches"] },
);

export async function getCommunityMatchWindow() {
  try {
    return await cachedFetchCommunityMatches();
  } catch {
    // `unstable_cache` throws when there is no Next.js request context
    // (e.g. inside vitest). Fall through to a direct fetch in that case.
    return fetchCommunityMatchesSafe();
  }
}

export async function getCommunityRangeMatchWindow(days: 7 | 14 | 30) {
  try {
    return await cachedFetchCommunityRangeMatches(days);
  } catch {
    return fetchCommunityRangeMatchesSafe(days);
  }
}

export async function getCommunityRangeStats(days: 7 | 14 | 30) {
  try {
    return await cachedFetchCommunityRangeStats(days);
  } catch {
    return fetchCommunityRangeStatsSafe(days);
  }
}

async function fetchCommunityRangeMatchesSafe(days: 7 | 14 | 30) {
  const fromAggregate = await fetchMatchesFromRangeAggregate(days);
  if (fromAggregate) {
    return fromAggregate;
  }
  const matches = await getCommunityMatchWindow();
  return filterCommunityMatchesByDays(matches, days);
}

async function fetchCommunityRangeStatsSafe(days: 7 | 14 | 30) {
  const fromAggregate = await fetchStatsFromRangeAggregate(days);
  if (fromAggregate) {
    return fromAggregate;
  }
  const matches = await fetchCommunityRangeMatchesSafe(days);
  return buildRangeStats(days, matches, matches.length);
}

const cachedFetchCommunityRangeMatches = unstable_cache(
  fetchCommunityRangeMatchesSafe,
  ["community-range-match-window-v1"],
  { revalidate: COMMUNITY_CACHE_TTL_SECONDS, tags: ["community-matches"] },
);

const cachedFetchCommunityRangeStats = unstable_cache(
  fetchCommunityRangeStatsSafe,
  ["community-range-stats-v1"],
  { revalidate: COMMUNITY_CACHE_TTL_SECONDS, tags: ["community-matches"] },
);

/**
 * Incrementally merge a single new match into the aggregate doc.
 *
 * Why this exists: the cron path costs COMMUNITY_WINDOW_SIZE reads per
 * run. The desktop client knows exactly when a match is added, so it
 * can trigger this endpoint instead — 1 read + 1 write per match, and
 * near-instant freshness on the site. See the append API route for the
 * caller.
 *
 * Dedup by id: if the same match arrives twice (retries, the cron
 * happening to race the append), we keep only one copy.
 */
export async function appendMatchToAggregate(
  match: CommunityMatch,
): Promise<{
  matchCount: number;
  publicLifetimeMatchCount: number;
  publicLifetimePlayerCount?: number;
  publicPlayerIndexReady: boolean;
  updatedAt: number;
  alreadyPresent: boolean;
}> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firestore admin is not configured");
  }

  const ref = db.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOC_ID);

  // Wrapped in a transaction so concurrent appends don't stomp each
  // other. Without this, two matches finishing at the same moment
  // would both read the current state, each merge in their own match,
  // then race to overwrite — and whichever write lands second silently
  // drops the other match. Firestore retries the transaction up to 5x
  // automatically on contention, so the happy path stays one aggregate
  // read/write plus one tiny public-player lookup for a new match.
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    let existing: CommunityMatch[] = [];
    // Preserve private-hub counts across appends; the full-refresh cron
    // is the only thing that should recompute them.
    let privateMatchCount = 0;
    let privatePlayerCount = 0;
    let publicLifetimeMatchCount: number | undefined;
    let publicLifetimePlayerCount: number | undefined;
    let publicPlayerIndexReady = false;
    let aggregateMatchCount: number | undefined;
    let existingChunkCount = 0;
    if (snap.exists) {
      const data = snap.data() ?? {};
      existingChunkCount = toNonNegativeInteger(data.chunkCount) ?? 0;
      if (existingChunkCount > 0) {
        const chunkSnaps = await Promise.all(
          Array.from({ length: existingChunkCount }, (_, index) =>
            tx.get(db.collection(AGGREGATE_COLLECTION).doc(aggregateChunkDocId(index))),
          ),
        );
        for (const chunkSnap of chunkSnaps) {
          if (!chunkSnap.exists) {
            existing = [];
            break;
          }
          const decoded = decodeMatchesFromAggregateData(chunkSnap.data() ?? {});
          if (!decoded) {
            existing = [];
            break;
          }
          existing.push(...decoded);
        }
      } else {
        existing = decodeMatchesFromAggregateData(data) ?? [];
      }
      privateMatchCount = toNonNegativeInteger(data.privateMatchCount) ?? 0;
      privatePlayerCount = toNonNegativeInteger(data.privatePlayerCount) ?? 0;
      publicLifetimeMatchCount = toNonNegativeInteger(
        data.publicLifetimeMatchCount,
      );
      publicLifetimePlayerCount = toNonNegativeInteger(
        data.publicLifetimePlayerCount,
      );
      publicPlayerIndexReady =
        data.publicPlayerIndexReady === true &&
        publicLifetimePlayerCount !== undefined;
      aggregateMatchCount = toNonNegativeInteger(data.matchCount);
    }

    // If the doc didn't exist yet, the append alone creates a minimal
    // aggregate with just this match. The next scheduled full refresh
    // will populate it properly. That's a cold-start edge case —
    // normal flow assumes the aggregate already exists.

    const alreadyPresent = existing.some((m) => m.id === match.id);
    const shouldRemoveFromAggregate = Boolean(match.superseded || match.mergedIntoMatchId);
    const playerDocId =
      !alreadyPresent && !shouldRemoveFromAggregate && match.uid ? publicPlayerDocId(match.uid) : "";
    const playerRef = playerDocId
      ? db.collection(PUBLIC_PLAYERS_COLLECTION).doc(playerDocId)
      : null;
    const playerSnap = playerRef ? await tx.get(playerRef) : null;
    const merged = (shouldRemoveFromAggregate
      ? existing.filter((item) => item.id !== match.id)
      : alreadyPresent
        ? [match, ...existing.filter((item) => item.id !== match.id)]
        : [match, ...existing]).sort(
          (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
        );

    // Trim to the window size so the doc doesn't grow unboundedly
    // between full refreshes.
    const trimmed = merged.slice(0, COMMUNITY_WINDOW_SIZE);
    const updatedAt = Date.now();
    const basePublicLifetimeMatchCount = Math.max(
      publicLifetimeMatchCount ?? aggregateMatchCount ?? existing.length,
      existing.length,
    );
    const nextPublicLifetimeMatchCount = shouldRemoveFromAggregate
      ? Math.max(0, basePublicLifetimeMatchCount - (alreadyPresent ? 1 : 0))
      : alreadyPresent
        ? basePublicLifetimeMatchCount
        : basePublicLifetimeMatchCount + 1;
    const shouldIncrementPlayerCount =
      publicPlayerIndexReady && playerRef !== null && !playerSnap?.exists;
    const nextPublicLifetimePlayerCount = publicPlayerIndexReady
      ? (publicLifetimePlayerCount ?? countWindowPlayers(existing)) +
        (shouldIncrementPlayerCount ? 1 : 0)
      : publicLifetimePlayerCount;
    const chunks = chunkMatches(trimmed, COMMUNITY_CHUNK_SIZE);

    for (let index = 0; index < chunks.length; index += 1) {
      tx.set(db.collection(AGGREGATE_COLLECTION).doc(aggregateChunkDocId(index)), {
        updatedAt,
        index,
        chunkSize: COMMUNITY_CHUNK_SIZE,
        matchCount: chunks[index].length,
        matchesGz: encodeMatches(chunks[index]),
        matchesJson: null,
      });
    }
    for (let index = chunks.length; index < existingChunkCount; index += 1) {
      tx.delete(db.collection(AGGREGATE_COLLECTION).doc(aggregateChunkDocId(index)));
    }

    tx.set(ref, {
      updatedAt,
      matchCount: trimmed.length,
      windowSize: COMMUNITY_WINDOW_SIZE,
      chunkSize: COMMUNITY_CHUNK_SIZE,
      chunkCount: chunks.length,
      publicLifetimeMatchCount: nextPublicLifetimeMatchCount,
      ...(nextPublicLifetimePlayerCount === undefined
        ? {}
        : { publicLifetimePlayerCount: nextPublicLifetimePlayerCount }),
      publicPlayerIndexReady,
      matchesGz: null,
      matchesJson: null,
      privateMatchCount,
      privatePlayerCount,
    });

    if (playerRef && !playerSnap?.exists) {
      tx.set(
        playerRef,
        {
          uid: match.uid,
          username: match.username,
          firstSeenAt: match.createdAt,
          lastSeenAt: match.createdAt,
          updatedAt,
        },
        { merge: true },
      );
    }

    return {
      matchCount: trimmed.length,
      publicLifetimeMatchCount: nextPublicLifetimeMatchCount,
      publicLifetimePlayerCount: nextPublicLifetimePlayerCount,
      publicPlayerIndexReady,
      updatedAt,
      alreadyPresent,
    };
  });
}

function privateHubMatchDocId(hubId: string, matchId: string): string {
  return encodeURIComponent(`${hubId.trim()}::${matchId.trim()}`);
}

export async function recordPrivateHubAggregateEvent(event: {
  action: "upsert" | "delete";
  hubId: string;
  matchId: string;
  uid: string;
  username?: string;
}): Promise<{
  privateMatchCount: number;
  privatePlayerCount: number;
  alreadyPresent?: boolean;
  missing?: boolean;
}> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firestore admin is not configured");
  }

  const hubId = event.hubId.trim();
  const matchId = event.matchId.trim();
  const uid = event.uid.trim();
  if (!hubId || !matchId || !uid) {
    throw new Error("hubId, matchId, and uid are required");
  }

  const now = Date.now();
  const countersRef = db.collection(AGGREGATE_COLLECTION).doc(PRIVATE_COUNTER_DOC_ID);
  const aggregateRef = db.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOC_ID);
  const matchRef = db
    .collection(PRIVATE_MATCH_INDEX_COLLECTION)
    .doc(privateHubMatchDocId(hubId, matchId));
  const playerRef = db.collection(PRIVATE_PLAYER_INDEX_COLLECTION).doc(publicPlayerDocId(uid));

  return db.runTransaction(async (tx) => {
    const [countersSnap, aggregateSnap, matchSnap, playerSnap] = await Promise.all([
      tx.get(countersRef),
      tx.get(aggregateRef),
      tx.get(matchRef),
      tx.get(playerRef),
    ]);
    const counterData = countersSnap.data() ?? aggregateSnap.data() ?? {};
    let privateMatchCount = toNonNegativeInteger(counterData.privateMatchCount) ?? 0;
    let privatePlayerCount = toNonNegativeInteger(counterData.privatePlayerCount) ?? 0;
    const playerData = playerSnap.data() ?? {};
    const playerMatchCount = toNonNegativeInteger(playerData.matchCount) ?? 0;

    if (event.action === "upsert") {
      if (matchSnap.exists) {
        return { privateMatchCount, privatePlayerCount, alreadyPresent: true };
      }
      privateMatchCount += 1;
      const nextPlayerMatchCount = playerMatchCount + 1;
      if (playerMatchCount === 0) {
        privatePlayerCount += 1;
      }
      tx.set(matchRef, { hubId, matchId, uid, username: event.username ?? "", createdAt: now });
      tx.set(
        playerRef,
        {
          uid,
          username: event.username ?? playerData.username ?? "",
          matchCount: nextPlayerMatchCount,
          updatedAt: now,
        },
        { merge: true },
      );
    } else {
      if (!matchSnap.exists) {
        return { privateMatchCount, privatePlayerCount, missing: true };
      }
      privateMatchCount = Math.max(0, privateMatchCount - 1);
      const indexedUid = String(matchSnap.get("uid") ?? uid).trim() || uid;
      const indexedPlayerRef =
        indexedUid === uid
          ? playerRef
          : db.collection(PRIVATE_PLAYER_INDEX_COLLECTION).doc(publicPlayerDocId(indexedUid));
      const indexedPlayerSnap =
        indexedUid === uid ? playerSnap : await tx.get(indexedPlayerRef);
      const indexedPlayerData = indexedPlayerSnap.data() ?? {};
      const indexedPlayerMatchCount =
        toNonNegativeInteger(indexedPlayerData.matchCount) ?? 0;
      const nextPlayerMatchCount = Math.max(0, indexedPlayerMatchCount - 1);
      if (indexedPlayerMatchCount > 0 && nextPlayerMatchCount === 0) {
        privatePlayerCount = Math.max(0, privatePlayerCount - 1);
        tx.delete(indexedPlayerRef);
      } else {
        tx.set(
          indexedPlayerRef,
          { matchCount: nextPlayerMatchCount, updatedAt: now },
          { merge: true },
        );
      }
      tx.delete(matchRef);
    }

    const counterPayload = {
      privateMatchCount,
      privatePlayerCount,
      updatedAt: now,
    };
    tx.set(countersRef, counterPayload, { merge: true });
    tx.set(aggregateRef, counterPayload, { merge: true });
    return { privateMatchCount, privatePlayerCount };
  });
}

/**
 * Force-refresh the aggregate doc from the live matches collection.
 * Entry point for the scheduled cron. Intentionally bypasses the
 * unstable_cache wrapper so every cron run reads fresh from Firestore.
 * Returns a summary for the API response + logs.
 */
export async function refreshCommunityAggregate(): Promise<{
  matchCount: number;
  publicLifetimeMatchCount: number;
  publicLifetimePlayerCount?: number;
  publicPlayerIndexReady: boolean;
  privateMatchCount: number;
  privatePlayerCount: number;
  updatedAt: number;
  source: "firestore" | "fixtures";
}> {
  const live = await fetchMatchesFromCollection();

  if (live === null) {
    throw new Error(
      "Firestore admin is not configured — cannot refresh aggregate",
    );
  }

  const fullThirtyDayWindow = await fetchRangeMatchesFromCollection(30, {
    limitToDetailWindow: false,
  });
  const rangeWindows: CommunityRangeWindows = {};
  await Promise.all(
    COMMUNITY_RANGE_DAYS.map(async (days) => {
      try {
        const window = await fetchRangeMatchesForRefresh(
          days,
          live,
          fullThirtyDayWindow,
        );
        if (window) {
          rangeWindows[days] = window;
        }
      } catch (error) {
        console.error(`[community/data] ${days}d range refresh failed`, error);
      }
    }),
  );

  // Compute private-hub counts in parallel-safe fashion; failures
  // shouldn't block the public refresh — we just record zeros.
  let privateBoost = { privateMatchCount: 0, privatePlayerCount: 0 };
  try {
    privateBoost = await fetchPrivateHubStats();
  } catch (error) {
    console.error("[community/data] Private hub stats failed", error);
  }

  const publicLifetimeMatchCount = await fetchPublicLifetimeMatchCount();
  const db = getFirestoreAdmin();
  const aggregateData =
    (await db?.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOC_ID).get())
      ?.data() ?? {};
  const existingPublicLifetimePlayerCount = toNonNegativeInteger(
    aggregateData.publicLifetimePlayerCount,
  );
  const existingPublicPlayerIndexReady =
    aggregateData.publicPlayerIndexReady === true &&
    existingPublicLifetimePlayerCount !== undefined;
  const publicPlayerStats = existingPublicPlayerIndexReady
    ? {
        publicLifetimePlayerCount:
          (await fetchPublicLifetimePlayerCount()) ??
          existingPublicLifetimePlayerCount,
        publicPlayerIndexReady: true,
      }
    : await rebuildPublicPlayerIndexFromMatches();
  const writeResult = await writeMatchesToAggregate(
    live,
    privateBoost,
    publicLifetimeMatchCount,
    publicPlayerStats,
    rangeWindows,
  );

  return {
    matchCount: live.length,
    publicLifetimeMatchCount: writeResult.publicLifetimeMatchCount,
    publicLifetimePlayerCount: writeResult.publicLifetimePlayerCount,
    publicPlayerIndexReady: writeResult.publicPlayerIndexReady,
    privateMatchCount: privateBoost.privateMatchCount,
    privatePlayerCount: privateBoost.privatePlayerCount,
    updatedAt: Date.now(),
    source: "firestore",
  };
}
