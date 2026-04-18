import "server-only";

import { unstable_cache } from "next/cache";

import { COMMUNITY_WINDOW_SIZE } from "@/lib/constants";
import { FIXTURE_MATCHES } from "@/lib/fixtures/community";
import { getFirestoreAdmin } from "@/lib/firebase/admin";
import type { CommunityMatch, DeckSnapshot, MatchGame } from "@/lib/types";

const COMMUNITY_CACHE_TTL_SECONDS = 300;

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

function normalizeMatch(id: string, raw: Record<string, unknown>): CommunityMatch {
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

async function fetchFromFirestore(): Promise<CommunityMatch[] | null> {
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

const cachedFetchCommunityMatches = unstable_cache(
  async () => {
    try {
      const firestoreMatches = await fetchFromFirestore();
      return firestoreMatches ?? FIXTURE_MATCHES;
    } catch (error) {
      console.error("[community/data] Firestore fetch failed, using fixtures", error);
      return FIXTURE_MATCHES;
    }
  },
  ["community-match-window-v1"],
  { revalidate: COMMUNITY_CACHE_TTL_SECONDS, tags: ["community-matches"] },
);

export async function getCommunityMatchWindow() {
  return cachedFetchCommunityMatches();
}
