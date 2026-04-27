import "server-only";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import type { CommunityMatch } from "@/lib/types";

// Weekly snapshots are the historical-record layer the rolling aggregate
// doc can't provide. The aggregate holds the latest 500 matches, which
// could span anywhere from 7 days (high activity) to weeks or months
// (low activity). To say "Darius is up 3% vs last week" the report
// generator needs a stable frozen view of each past week.
//
// One doc per ISO week (`weekly-2026-W17`), written once on Sunday
// night by the snapshot cron. 52 writes a year — basically free. Each
// snapshot is read by the report generator a few hours later and then
// occasionally in future weeks for trend comparisons.
export const WEEKLY_SNAPSHOT_COLLECTION = "aggregates";
export const WEEKLY_SNAPSHOT_ID_PREFIX = "weekly-";

export type WeeklyLegendStats = {
  legend: string;
  plays: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number; // 0..1, NaN if plays === 0
};

export type WeeklyDeckStats = {
  deckKey: string;
  deckName: string;
  legend: string;
  plays: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
};

export type WeeklyPlayerStats = {
  uid: string;
  username: string;
  plays: number;
  wins: number;
  losses: number;
  winRate: number;
};

export type WeeklyBattlefieldStats = {
  name: string;
  picks: number;
  wins: number;
  winRate: number;
};

export type WeeklySnapshot = {
  week: string; // "2026-W17"
  year: number;
  weekNumber: number;
  startMs: number; // inclusive, Monday 00:00 UTC
  endMs: number; // exclusive, next Monday 00:00 UTC
  matchCount: number;
  uniquePlayers: number;
  legends: WeeklyLegendStats[];
  decks: WeeklyDeckStats[];
  players: WeeklyPlayerStats[];
  battlefields: WeeklyBattlefieldStats[];
  createdAt: number;
};

/**
 * ISO 8601 week calculation. Returns `{ year, week }` where week is 1..53
 * and `year` is the *ISO year* — which can differ from the calendar year
 * around Jan 1. Example: Dec 31 2024 is ISO 2025-W01, Jan 1 2023 is ISO
 * 2022-W52. Without this, two adjacent days could land in different years
 * and our snapshot IDs would get weird.
 */
export function isoWeek(date: Date): { year: number; week: number } {
  // Copy so we don't mutate the caller's date
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // Shift to the Thursday of the current week — the ISO spec defines the
  // week that contains Thursday as belonging to that year.
  const dayNum = d.getUTCDay() || 7; // Sunday=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/**
 * Start-of-week timestamp (Monday 00:00 UTC) for the ISO week that
 * contains `date`. This is the inclusive lower bound used when filtering
 * matches into a weekly snapshot.
 */
export function isoWeekStartMs(date: Date): number {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dayNum - 1));
  return d.getTime();
}

function formatWeekId(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function weeklySnapshotDocId(year: number, week: number): string {
  return `${WEEKLY_SNAPSHOT_ID_PREFIX}${formatWeekId(year, week)}`;
}

/**
 * Return the ISO week that most recently *fully ended* before `now`.
 *
 * Rules:
 *  - For any day Mon-Sat (or Sun before 22:00 UTC), the answer is the
 *    previous Mon-Sun week.
 *  - On Sunday from 22:00 UTC onwards, the current week is treated as
 *    "ending now" so the Sunday-night cron snapshots the week it's
 *    closing out (rather than the one before it).
 *
 * This replaces the older "now − 1 hour" trick, which was only correct
 * within ~1h of midnight Sun→Mon. A manual Monday-morning run under that
 * logic would land in the *new* ISO week and snapshot the wrong one.
 */
export function weekJustEnded(now: Date = new Date()): {
  year: number;
  week: number;
  startMs: number;
  endMs: number;
} {
  const dayNum = now.getUTCDay() || 7; // 1 = Mon … 7 = Sun
  // How many days back from `now` to land in the just-ended week.
  // Mon..Sat: walk back to last Sunday (the end of the just-ended week).
  // Sun late (>=22:00 UTC): treat today's week as the just-ended one.
  // Sun early: walk back a full week to last Sunday.
  let daysBack: number;
  if (dayNum === 7) {
    daysBack = now.getUTCHours() >= 22 ? 0 : 7;
  } else {
    daysBack = dayNum;
  }
  const anchor = new Date(now);
  anchor.setUTCDate(anchor.getUTCDate() - daysBack);
  const { year, week } = isoWeek(anchor);
  const startMs = isoWeekStartMs(anchor);
  const endMs = startMs + 7 * 24 * 60 * 60 * 1000;
  return { year, week, startMs, endMs };
}

function isDecisive(result: string): "win" | "loss" | "draw" | "unknown" {
  const r = result.trim().toLowerCase();
  if (r === "win" || r === "w") return "win";
  if (r === "loss" || r === "lose" || r === "l") return "loss";
  if (r === "draw" || r === "tie" || r === "d") return "draw";
  return "unknown";
}

function upsert<T>(map: Map<string, T>, key: string, init: () => T): T {
  const existing = map.get(key);
  if (existing) return existing;
  const fresh = init();
  map.set(key, fresh);
  return fresh;
}

function winRate(wins: number, losses: number): number {
  const total = wins + losses;
  if (total === 0) return 0;
  return wins / total;
}

/**
 * Build a snapshot from a pre-filtered list of matches. Pure function —
 * doesn't touch Firestore, so it's easy to test and safe to call from
 * anywhere. The Firestore read happens in `buildWeeklySnapshot` below.
 *
 * `matches` should already be filtered to the target week window; this
 * function does not re-filter by date.
 */
export function buildWeeklySnapshotFromMatches(
  matches: CommunityMatch[],
  window: { year: number; week: number; startMs: number; endMs: number },
): WeeklySnapshot {
  const legends = new Map<string, WeeklyLegendStats>();
  const decks = new Map<string, WeeklyDeckStats>();
  const players = new Map<string, WeeklyPlayerStats>();
  const battlefields = new Map<string, WeeklyBattlefieldStats>();
  const playerSet = new Set<string>();

  for (const m of matches) {
    const result = isDecisive(m.result);
    const isWin = result === "win";
    const isLoss = result === "loss";
    const isDraw = result === "draw";
    // If the result is unknown, still count plays but not W/L. This
    // mirrors how the live meta tables treat ambiguous matches.

    if (m.myChampion) {
      const l = upsert(legends, m.myChampion, () => ({
        legend: m.myChampion,
        plays: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
      }));
      l.plays += 1;
      if (isWin) l.wins += 1;
      if (isLoss) l.losses += 1;
      if (isDraw) l.draws += 1;
    }

    if (m.deckSourceKey || m.deckName) {
      const key = m.deckSourceKey || m.deckName;
      const d = upsert(decks, key, () => ({
        deckKey: key,
        deckName: m.deckName || key,
        legend: m.myChampion,
        plays: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
      }));
      d.plays += 1;
      if (isWin) d.wins += 1;
      if (isLoss) d.losses += 1;
      if (isDraw) d.draws += 1;
    }

    if (m.uid) {
      const p = upsert(players, m.uid, () => ({
        uid: m.uid,
        username: m.username,
        plays: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
      }));
      p.plays += 1;
      if (isWin) p.wins += 1;
      if (isLoss) p.losses += 1;
      playerSet.add(m.uid);
    }

    if (m.myBattlefield) {
      const b = upsert(battlefields, m.myBattlefield, () => ({
        name: m.myBattlefield,
        picks: 0,
        wins: 0,
        winRate: 0,
      }));
      b.picks += 1;
      if (isWin) b.wins += 1;
    }
  }

  // Finalize win rates. Done once at the end so the per-match loop
  // stays cheap and each rate is computed from its final totals.
  for (const l of legends.values()) l.winRate = winRate(l.wins, l.losses);
  for (const d of decks.values()) d.winRate = winRate(d.wins, d.losses);
  for (const p of players.values()) p.winRate = winRate(p.wins, p.losses);
  for (const b of battlefields.values()) b.winRate = winRate(b.wins, b.picks - b.wins);

  return {
    week: formatWeekId(window.year, window.week),
    year: window.year,
    weekNumber: window.week,
    startMs: window.startMs,
    endMs: window.endMs,
    matchCount: matches.length,
    uniquePlayers: playerSet.size,
    // Sort for deterministic output — easier to diff snapshots in logs.
    legends: Array.from(legends.values()).sort((a, b) => b.plays - a.plays),
    decks: Array.from(decks.values()).sort((a, b) => b.plays - a.plays),
    players: Array.from(players.values()).sort((a, b) => b.plays - a.plays),
    battlefields: Array.from(battlefields.values()).sort((a, b) => b.picks - a.picks),
    createdAt: Date.now(),
  };
}

/**
 * Read matches for a given week directly from the `matches` collection
 * and build the snapshot. Deliberately bypasses the rolling aggregate
 * doc — at high match velocity (>500/week) the aggregate wouldn't
 * cover a full week, so we go to source. Cost scales with the number
 * of matches actually played that week, which is what we want.
 */
export async function buildWeeklySnapshot(window: {
  year: number;
  week: number;
  startMs: number;
  endMs: number;
}): Promise<WeeklySnapshot | null> {
  const db = getFirestoreAdmin();
  if (!db) return null;

  // Guard: if a snapshot is being requested for a window that's fully
  // in the future, there's nothing to snapshot. Return an empty one so
  // callers have a well-defined shape to work with.
  if (window.startMs > Date.now()) {
    return buildWeeklySnapshotFromMatches([], window);
  }

  // The Python desktop app stores `created_at` as Unix seconds (int(time.time())).
  // Convert the millisecond window bounds to seconds before comparing.
  const startSec = Math.floor(window.startMs / 1000);
  const endSec = Math.floor(window.endMs / 1000);

  const snap = await db
    .collection("matches")
    .where("created_at", ">=", startSec)
    .where("created_at", "<", endSec)
    .orderBy("created_at", "desc")
    .get();

  // Normalize into CommunityMatch shape. Inline here rather than
  // depending on normalizeMatch from data.ts to keep this module
  // testable without a Firebase admin stub for everything.
  const matches: CommunityMatch[] = snap.docs.map((doc) => {
    const raw = doc.data() as Record<string, unknown>;
    // created_at is stored in seconds by the Python client; multiply to get ms
    // so CommunityMatch.createdAt is consistently in milliseconds.
    const createdAtSec = Number(raw.created_at ?? 0);
    return {
      id: doc.id,
      uid: String(raw.uid ?? "").trim(),
      username: String(raw.username ?? "").trim(),
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
      games: [],
      deckName: String(raw.my_deck_name ?? "").trim(),
      deckSourceUrl: String(raw.my_deck_source_url ?? "").trim(),
      deckSourceKey: String(raw.my_deck_source_key ?? "").trim(),
      deckSnapshot: null,
      createdAt: createdAtSec * 1000,
    };
  });

  return buildWeeklySnapshotFromMatches(matches, window);
}

export async function writeWeeklySnapshot(snapshot: WeeklySnapshot): Promise<void> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firestore admin is not configured");
  }
  const docId = weeklySnapshotDocId(snapshot.year, snapshot.weekNumber);

  // Destructure the arrays out before spreading so we never pass `undefined`
  // to Firestore — the Admin SDK rejects undefined values and throws. The
  // arrays are stored as JSON strings to keep the doc well under the 1 MiB
  // limit even at high match volume.
  const { legends, decks, players, battlefields, ...scalars } = snapshot;
  await db
    .collection(WEEKLY_SNAPSHOT_COLLECTION)
    .doc(docId)
    .set({
      ...scalars,
      legendsJson: JSON.stringify(legends),
      decksJson: JSON.stringify(decks),
      playersJson: JSON.stringify(players),
      battlefieldsJson: JSON.stringify(battlefields),
    });
}

export async function readWeeklySnapshot(
  year: number,
  week: number,
): Promise<WeeklySnapshot | null> {
  const db = getFirestoreAdmin();
  if (!db) return null;

  const snap = await db
    .collection(WEEKLY_SNAPSHOT_COLLECTION)
    .doc(weeklySnapshotDocId(year, week))
    .get();
  if (!snap.exists) return null;

  const data = snap.data() ?? {};

  function parseArray<T>(raw: unknown): T[] {
    if (Array.isArray(raw)) return raw as T[];
    if (typeof raw === "string" && raw) {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as T[]) : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  return {
    week: String(data.week ?? ""),
    year: Number(data.year ?? year),
    weekNumber: Number(data.weekNumber ?? week),
    startMs: Number(data.startMs ?? 0),
    endMs: Number(data.endMs ?? 0),
    matchCount: Number(data.matchCount ?? 0),
    uniquePlayers: Number(data.uniquePlayers ?? 0),
    legends: parseArray<WeeklyLegendStats>(data.legendsJson ?? data.legends),
    decks: parseArray<WeeklyDeckStats>(data.decksJson ?? data.decks),
    players: parseArray<WeeklyPlayerStats>(data.playersJson ?? data.players),
    battlefields: parseArray<WeeklyBattlefieldStats>(
      data.battlefieldsJson ?? data.battlefields,
    ),
    createdAt: Number(data.createdAt ?? 0),
  };
}

/**
 * Convenience: return the ISO week immediately prior to the given one.
 * Handles year boundaries correctly by subtracting 7 days from the
 * start of the given week and re-running the ISO calculation.
 */
export function previousIsoWeek(year: number, week: number): { year: number; week: number } {
  // Approximate start of the given week: Jan 4 of its year is always
  // in ISO W01, so we back-solve from there. Then subtract 7 days and
  // re-derive the ISO week of that earlier moment.
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Date = new Date(jan4);
  const jan4DayNum = jan4Date.getUTCDay() || 7;
  const week01StartMs = jan4 - (jan4DayNum - 1) * 86_400_000;
  const targetStartMs = week01StartMs + (week - 1) * 7 * 86_400_000;
  const priorStartMs = targetStartMs - 7 * 86_400_000;
  return isoWeek(new Date(priorStartMs));
}
