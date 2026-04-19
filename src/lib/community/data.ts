import "server-only";

import { unstable_cache } from "next/cache";

import { COMMUNITY_WINDOW_SIZE } from "@/lib/constants";
import { FIXTURE_MATCHES } from "@/lib/fixtures/community";
import { getFirestoreAdmin } from "@/lib/firebase/admin";
import type { CommunityMatch, DeckSnapshot, MatchGame } from "@/lib/types";

// 10 minutes. Community stats are intentionally not real-time — sync from
// the desktop app is already a ~30s async pipeline. Longer TTL halves the
// cache-miss rate, which directly halves Firestore reads in steady state.
const COMMUNITY_CACHE_TTL_SECONDS = 600;

// Precomputed aggregate doc. A scheduled cron writes the full normalized
// match window here so page renders only pay ONE Firestore read per cache
// miss instead of COMMUNITY_WINDOW_SIZE (500). See:
//   src/app/api/community/aggregate/refresh/route.ts
//   .github/workflows/refresh-aggregates.yml
const AGGREGATE_COLLECTION = "aggregates";
const AGGREGATE_DOC_ID = "community-v1";

// If the aggregate doc hasn't been updated in this long, treat it as
// unreliable (maybe the cron broke) and fall back to a direct collection
// read so users don't see wildly stale data. Set high enough that a few
// missed cron runs don't trigger the fallback.
const AGGREGATE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeGames(value: unknown, match: Record<string, unknown>): MatchGame[] {
  const source =
    typeof value === "string" && value
      ? safeJsonParse(value)
      : Array.isArray(value)
        ? value
        : [];

  if (Array.isArray(source) && source.length > 0) {
    return source.map((game) => ({
      myBf: String((game as Record<string, unknown>).my_bf ?? "").trim(),
      oppBf: String((game as Record<string, unknown>).opp_bf ?? "").trim(),
      wentFirst: String((game as Record<string, unknown>).went_first ?? "").trim(),
      result: String((game as Record<string, unknown>).result ?? "").trim(),
      myPoints: Number((game as Record<string, unknown>).my_points ?? 0),
      oppPoints: Number((game as Record<string, unknown>).opp_points ?? 0),
    }));
  }

  if (match.my_battlefield || match.opp_battlefield || match.went_first) {
    return [
      {
        myBf: String(match.my_battlefield ?? "").trim(),
        oppBf: String(match.opp_battlefield ?? "").trim(),
        wentFirst: String(match.went_first ?? "").trim(),
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
  const username = String(raw.username ?? "").trim() || `Player#${uid.slice(0, 6)}`;
  return {
    id,
    uid,
    username,
    date: String(raw.date ?? "").trim(),
    result: String(raw.result ?? "").trim(),
    myChampion: String(raw.my_champion ?? "").trim(),
    oppChampion: String(raw.opp_champion ?? "").trim(),
    oppName: String(raw.opp_name ?? "").trim(),
    fmt: String(raw.fmt ?? "Bo1").trim() || "Bo1",
    score: String(raw.score ?? "").trim(),
    wentFirst: String(raw.went_first ?? "").trim(),
    myBattlefield: String(raw.my_battlefield ?? "").trim(),
    oppBattlefield: String(raw.opp_battlefield ?? "").trim(),
    flags: String(raw.flags ?? "").trim(),
    games: normalizeGames(raw.games_json, raw),
    deckName: String(raw.my_deck_name ?? "").trim(),
    deckSourceUrl: String(raw.my_deck_source_url ?? "").trim(),
    deckSourceKey: String(raw.my_deck_source_key ?? "").trim(),
    deckSnapshot: normalizeSnapshot(raw.my_deck_snapshot_json),
    createdAt: Number(raw.created_at ?? Date.now()),
  };
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

  const snapshot = await db
    .collection("matches")
    .orderBy("created_at", "desc")
    .limit(COMMUNITY_WINDOW_SIZE)
    .get();

  return snapshot.docs.map((doc) =>
    normalizeMatch(doc.id, doc.data() as Record<string, unknown>),
  );
}

/**
 * Read the precomputed aggregate doc. Costs exactly 1 Firestore read.
 * Returns null if the doc doesn't exist, can't be parsed, or is older
 * than AGGREGATE_MAX_AGE_MS (so a dead cron doesn't silently serve
 * ancient data forever).
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
  const matchesJson = typeof data.matchesJson === "string" ? data.matchesJson : "";

  if (!matchesJson) {
    return null;
  }

  if (updatedAt > 0 && Date.now() - updatedAt > AGGREGATE_MAX_AGE_MS) {
    console.warn(
      "[community/data] Aggregate doc is stale (>4h old), falling back to live read",
    );
    return null;
  }

  const parsed = safeJsonParse(matchesJson);
  if (!Array.isArray(parsed)) {
    return null;
  }

  // The doc stores already-normalized matches — no re-normalization needed.
  return parsed as CommunityMatch[];
}

/**
 * Write the full normalized match window to the aggregate doc. Called
 * only by the cron refresh route, never on a user request path.
 */
async function writeMatchesToAggregate(matches: CommunityMatch[]): Promise<void> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firestore admin is not configured");
  }

  await db.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOC_ID).set({
    updatedAt: Date.now(),
    matchCount: matches.length,
    matchesJson: JSON.stringify(matches),
  });
}

async function fetchCommunityMatchesSafe() {
  try {
    // Preferred path: single-doc read.
    const fromAggregate = await fetchMatchesFromAggregate();
    if (fromAggregate) {
      return fromAggregate;
    }

    // Fallback path: live collection scan. Only hit when the aggregate
    // doc is missing (first deployment, before any cron run) or stale.
    console.warn(
      "[community/data] Aggregate doc unavailable, falling back to live collection read",
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
  ["community-match-window-v2"],
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
): Promise<{ matchCount: number; updatedAt: number; alreadyPresent: boolean }> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firestore admin is not configured");
  }

  const ref = db.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOC_ID);
  const snap = await ref.get();

  let existing: CommunityMatch[] = [];
  if (snap.exists) {
    const data = snap.data() ?? {};
    const raw = typeof data.matchesJson === "string" ? data.matchesJson : "";
    const parsed = raw ? safeJsonParse(raw) : null;
    if (Array.isArray(parsed)) {
      existing = parsed as CommunityMatch[];
    }
  }

  // If the doc didn't exist yet, the append alone creates a minimal
  // aggregate with just this match. The next scheduled full refresh
  // will populate it properly. That's a cold-start edge case — normal
  // flow assumes the aggregate already exists.

  const alreadyPresent = existing.some((m) => m.id === match.id);
  const merged = alreadyPresent
    ? existing
    : [match, ...existing].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  // Trim to the window size so the doc doesn't grow unboundedly between
  // full refreshes.
  const trimmed = merged.slice(0, COMMUNITY_WINDOW_SIZE);
  const updatedAt = Date.now();

  await ref.set({
    updatedAt,
    matchCount: trimmed.length,
    matchesJson: JSON.stringify(trimmed),
  });

  return { matchCount: trimmed.length, updatedAt, alreadyPresent };
}

/**
 * Force-refresh the aggregate doc from the live matches collection.
 * Entry point for the scheduled cron. Intentionally bypasses the
 * unstable_cache wrapper so every cron run reads fresh from Firestore.
 * Returns a summary for the API response + logs.
 */
export async function refreshCommunityAggregate(): Promise<{
  matchCount: number;
  updatedAt: number;
  source: "firestore" | "fixtures";
}> {
  const live = await fetchMatchesFromCollection();

  if (live === null) {
    throw new Error(
      "Firestore admin is not configured — cannot refresh aggregate",
    );
  }

  await writeMatchesToAggregate(live);

  return {
    matchCount: live.length,
    updatedAt: Date.now(),
    source: "firestore",
  };
}
