import "server-only";

import { gzipSync, gunzipSync } from "node:zlib";

import { unstable_cache } from "next/cache";

import { COMMUNITY_WINDOW_SIZE } from "@/lib/constants";
import { FIXTURE_MATCHES } from "@/lib/fixtures/community";
import { getFirestoreAdmin } from "@/lib/firebase/admin";
import type { CommunityMatch, DeckSnapshot, MatchGame } from "@/lib/types";

// Firestore caps a single doc at ~1 MB. Once the community started
// hitting 500+ matches with full deck snapshots (cards, image URLs,
// runes, battlefields), the raw JSON crossed that line and the cron's
// `set()` started 500ing. Gzipping the matches blob shrinks it ~6-8x
// because deck lists and field names repeat heavily. We base64 the
// result so it can live in a Firestore string field.
function encodeMatches(matches: CommunityMatch[]): string {
  const json = JSON.stringify(matches);
  return gzipSync(json).toString("base64");
}

function decodeMatches(encoded: string): CommunityMatch[] | null {
  try {
    const buf = Buffer.from(encoded, "base64");
    const json = gunzipSync(buf).toString("utf8");
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as CommunityMatch[]) : null;
  } catch (error) {
    console.error("[community/data] decodeMatches failed", error);
    return null;
  }
}

// 10 minutes. Community stats are intentionally not real-time — sync from
// the desktop app is already a ~30s async pipeline. Longer TTL halves the
// cache-miss rate, which directly halves Firestore reads in steady state.
const COMMUNITY_CACHE_TTL_SECONDS = 600;

// Precomputed aggregate doc. A scheduled cron writes the full normalized
// match window here so page renders only pay ONE Firestore read per cache
// miss instead of scanning the full match window. See:
//   src/app/api/community/aggregate/refresh/route.ts
//   .github/workflows/refresh-aggregates.yml
const AGGREGATE_COLLECTION = "aggregates";
const AGGREGATE_DOC_ID = "community-v1";

// If the aggregate doc hasn't been updated in this long, treat it as
// unreliable. Tuned to absorb several missed cron runs (cron is every
// 4h) without triggering the expensive fallback. Past this threshold
// the read path returns fixtures rather than live-scanning the matches
// collection — see fetchCommunityMatchesSafe for why.
const AGGREGATE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export type CommunityAggregateCounts = {
  privateMatchCount: number;
  privatePlayerCount: number;
  publicLifetimeMatchCount?: number;
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

// Hard daily ceiling on the live-collection fallback. The cron runs
// every 4h; if it breaks, the unstable_cache miss path would otherwise
// trigger a WINDOW_SIZE-doc scan up to 144×/day, blowing past the
// Spark 50k/day quota on a single failed cron. We allow at most this
// many live scans per process before falling back to fixtures.
//
// Module-level state — Vercel function instances each carry their own
// counter, but each instance handles many requests so this still
// flattens fallback storms within an instance. For belt-and-braces
// across instances we'd need a shared store; this guard is "good
// enough" given the cron is reliable post-gzip-fix.
const FALLBACK_DAILY_CAP = 6;
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
 * Scan all private hubs and return aggregate-only counts.
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

  const hubsSnap = await db.collection("hubs").get();
  if (hubsSnap.empty) {
    return { privateMatchCount: 0, privatePlayerCount: 0 };
  }

  let privateMatchCount = 0;
  const uids = new Set<string>();

  for (const hub of hubsSnap.docs) {
    // .select("uid") fetches only that field; Firestore still charges 1
    // read per doc but the payload is tiny. Good enough at private-hub
    // volume (handful of hubs, tens of matches each).
    const matchesSnap = await db
      .collection("hubs")
      .doc(hub.id)
      .collection("matches")
      .select("uid")
      .get();
    privateMatchCount += matchesSnap.size;
    for (const doc of matchesSnap.docs) {
      const uid = doc.get("uid");
      if (typeof uid === "string" && uid) {
        uids.add(uid);
      }
    }
  }

  return { privateMatchCount, privatePlayerCount: uids.size };
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
    const snapshot = await db.collection("matches").count().get();
    return toNonNegativeInteger(snapshot.data().count) ?? 0;
  } catch (error) {
    console.error("[community/data] Public match count failed", error);
    return null;
  }
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
  const matchesGz = typeof data.matchesGz === "string" ? data.matchesGz : "";
  const matchesJson = typeof data.matchesJson === "string" ? data.matchesJson : "";

  if (!matchesGz && !matchesJson) {
    return null;
  }

  if (updatedAt > 0 && Date.now() - updatedAt > AGGREGATE_MAX_AGE_MS) {
    console.warn(
      "[community/data] Aggregate doc is stale (>24h old), falling back to live read",
    );
    return null;
  }

  // Prefer the gzipped blob; fall back to legacy uncompressed field for
  // a single read after deploy, before the next cron rewrite.
  if (matchesGz) {
    const decoded = decodeMatches(matchesGz);
    if (decoded) return decoded;
  }

  if (matchesJson) {
    const parsed = safeJsonParse(matchesJson);
    if (Array.isArray(parsed)) return parsed as CommunityMatch[];
  }

  return null;
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
): Promise<{ publicLifetimeMatchCount: number }> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firestore admin is not configured");
  }

  const ref = db.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOC_ID);
  let existingPublicLifetimeMatchCount: number | undefined;
  if (publicLifetimeMatchCount === null) {
    const existing = await ref.get();
    existingPublicLifetimeMatchCount = toNonNegativeInteger(
      existing.data()?.publicLifetimeMatchCount,
    );
  }
  const resolvedPublicLifetimeMatchCount = Math.max(
    publicLifetimeMatchCount ?? existingPublicLifetimeMatchCount ?? matches.length,
    matches.length,
  );

  await ref.set({
    updatedAt: Date.now(),
    matchCount: matches.length,
    publicLifetimeMatchCount: resolvedPublicLifetimeMatchCount,
    // gzip+base64 to fit comfortably under Firestore's 1 MB doc cap.
    // Drop the legacy uncompressed field so it stops eating doc budget;
    // readers fall back to it only if matchesGz is missing.
    matchesGz: encodeMatches(matches),
    matchesJson: null,
    privateMatchCount: privateBoost.privateMatchCount,
    privatePlayerCount: privateBoost.privatePlayerCount,
  });

  return { publicLifetimeMatchCount: resolvedPublicLifetimeMatchCount };
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

    return {
      privateMatchCount: toNonNegativeInteger(data.privateMatchCount) ?? 0,
      privatePlayerCount: toNonNegativeInteger(data.privatePlayerCount) ?? 0,
      publicLifetimeMatchCount,
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
): Promise<{
  matchCount: number;
  publicLifetimeMatchCount: number;
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
  // automatically on contention, so the happy path stays 1 read + 1
  // write and only gets more expensive under actual concurrency.
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    let existing: CommunityMatch[] = [];
    // Preserve private-hub counts across appends; the full-refresh cron
    // is the only thing that should recompute them.
    let privateMatchCount = 0;
    let privatePlayerCount = 0;
    let publicLifetimeMatchCount: number | undefined;
    let aggregateMatchCount: number | undefined;
    if (snap.exists) {
      const data = snap.data() ?? {};
      const gz = typeof data.matchesGz === "string" ? data.matchesGz : "";
      const raw = typeof data.matchesJson === "string" ? data.matchesJson : "";
      if (gz) {
        const decoded = decodeMatches(gz);
        if (decoded) existing = decoded;
      } else if (raw) {
        const parsed = safeJsonParse(raw);
        if (Array.isArray(parsed)) existing = parsed as CommunityMatch[];
      }
      privateMatchCount = toNonNegativeInteger(data.privateMatchCount) ?? 0;
      privatePlayerCount = toNonNegativeInteger(data.privatePlayerCount) ?? 0;
      publicLifetimeMatchCount = toNonNegativeInteger(
        data.publicLifetimeMatchCount,
      );
      aggregateMatchCount = toNonNegativeInteger(data.matchCount);
    }

    // If the doc didn't exist yet, the append alone creates a minimal
    // aggregate with just this match. The next scheduled full refresh
    // will populate it properly. That's a cold-start edge case —
    // normal flow assumes the aggregate already exists.

    const alreadyPresent = existing.some((m) => m.id === match.id);
    const merged = alreadyPresent
      ? existing
      : [match, ...existing].sort(
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
    const nextPublicLifetimeMatchCount = alreadyPresent
      ? basePublicLifetimeMatchCount
      : basePublicLifetimeMatchCount + 1;

    tx.set(ref, {
      updatedAt,
      matchCount: trimmed.length,
      publicLifetimeMatchCount: nextPublicLifetimeMatchCount,
      matchesGz: encodeMatches(trimmed),
      matchesJson: null,
      privateMatchCount,
      privatePlayerCount,
    });

    return {
      matchCount: trimmed.length,
      publicLifetimeMatchCount: nextPublicLifetimeMatchCount,
      updatedAt,
      alreadyPresent,
    };
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

  // Compute private-hub counts in parallel-safe fashion; failures
  // shouldn't block the public refresh — we just record zeros.
  let privateBoost = { privateMatchCount: 0, privatePlayerCount: 0 };
  try {
    privateBoost = await fetchPrivateHubStats();
  } catch (error) {
    console.error("[community/data] Private hub stats failed", error);
  }

  const publicLifetimeMatchCount = await fetchPublicLifetimeMatchCount();
  const writeResult = await writeMatchesToAggregate(
    live,
    privateBoost,
    publicLifetimeMatchCount,
  );

  return {
    matchCount: live.length,
    publicLifetimeMatchCount: writeResult.publicLifetimeMatchCount,
    privateMatchCount: privateBoost.privateMatchCount,
    privatePlayerCount: privateBoost.privatePlayerCount,
    updatedAt: Date.now(),
    source: "firestore",
  };
}
