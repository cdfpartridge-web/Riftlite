import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

import { FieldValue, type DocumentReference, type Query } from "firebase-admin/firestore";
import { type NextRequest, NextResponse } from "next/server";

import { getFirestoreAdmin, verifyFirebaseIdToken } from "@/lib/firebase/admin";
import type { CommunityMatch, DeckSnapshot, MatchGame } from "@/lib/types";

export type AccountProfile = {
  uid: string;
  email: string;
  handle: string;
  handleLower: string;
  displayName: string;
  searchable: boolean;
  publicProfile: boolean;
  showStats: boolean;
  showMatches: boolean;
  showDecks: boolean;
  showHubBadges: boolean;
  marketingConsent: boolean;
  marketingConsentAt: number;
  marketingConsentUpdatedAt: number;
  marketingConsentVersion: string;
  marketingConsentSource: string;
  createdAt: number;
  updatedAt: number;
};

export type PublicProfile = {
  uid: string;
  handle: string;
  handleLower: string;
  displayName: string;
  searchable: boolean;
  showStats: boolean;
  showMatches: boolean;
  showDecks: boolean;
  showHubBadges: boolean;
  updatedAt: number;
  searchPrefixes: string[];
};

export type UserAggregate = {
  uid: string;
  handle: string;
  displayName: string;
  updatedAt: number;
  totalMatches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  topLegend: string;
  recentMatches: CommunityMatch[];
};

const DEFAULT_PROFILE_VISIBILITY = {
  searchable: false,
  publicProfile: false,
  showStats: true,
  showMatches: true,
  showDecks: true,
  showHubBadges: false,
};

export const MARKETING_CONSENT_VERSION = "riftlite-marketing-v1";
export const MARKETING_CONSENT_SOURCE = "desktop-account-profile";
export const DEFAULT_DISPLAY_NAME = "RiftLite Player";
const GENERIC_DISPLAY_NAMES = new Set([
  DEFAULT_DISPLAY_NAME.toLowerCase(),
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
const USER_MATCH_WINDOW = 500;
const PROFILE_PAGE_MATCH_WINDOW = 250;
const USER_BACKFILL_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const LINK_SESSION_TTL_MS = 15 * 60 * 1000;

export function socialJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function requireUser(req: NextRequest) {
  const db = getFirestoreAdmin();
  if (!db) {
    return { error: socialJson({ error: "Firebase admin is not configured" }, 503) };
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.match(/^Bearer (.+)$/i)?.[1]?.trim() ?? "";
  if (!token) {
    return { error: socialJson({ error: "Missing Authorization: Bearer <idToken>" }, 401) };
  }
  const decoded = await verifyFirebaseIdToken(token);
  if (!decoded) {
    return { error: socialJson({ error: "Invalid or expired ID token" }, 401) };
  }
  return { db, decoded, token };
}

export function cleanHandle(value: unknown): string {
  const raw = String(value ?? "").trim().replace(/^@+/, "");
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
}

export function handleLower(value: string): string {
  return value.trim().toLowerCase();
}

export function validHandle(value: string): boolean {
  return /^[a-zA-Z0-9_][a-zA-Z0-9_-]{2,23}$/.test(value);
}

function compactDisplayName(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
}

export function isGenericDisplayName(value: unknown): boolean {
  const cleaned = compactDisplayName(value).toLowerCase();
  return !cleaned || GENERIC_DISPLAY_NAMES.has(cleaned) || /^player(?:[ #_-]|$)/i.test(cleaned);
}

function fallbackPlayerName(uid: string): string {
  const suffix = uid.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6);
  return suffix ? `Player ${suffix}` : DEFAULT_DISPLAY_NAME;
}

export function cleanDisplayName(value: unknown, fallback = DEFAULT_DISPLAY_NAME, uid = ""): string {
  const fallbackName = compactDisplayName(fallback);
  const cleaned = compactDisplayName(value);
  if (!isGenericDisplayName(cleaned)) {
    return cleaned;
  }
  if (fallbackName && !isGenericDisplayName(fallbackName)) {
    return fallbackName;
  }
  return fallbackPlayerName(uid);
}

export function bestProfileDisplayName(uid: string, ...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const cleaned = compactDisplayName(candidate);
    if (!isGenericDisplayName(cleaned)) {
      return cleaned;
    }
  }
  return fallbackPlayerName(uid);
}

function cleanDeckName(value: unknown): string {
  const cleaned = String(value ?? "").trim().replace(/\s+/g, " ");
  const normalized = cleaned.toLowerCase().replace(/^tcga:/, "");
  return cleaned && !GENERIC_DECK_NAMES.has(normalized) ? cleaned : "";
}

function cleanDeckSource(value: unknown): string {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return "";
  const tcgaDeckKey = cleaned.match(/^tcga:\/\/deck\/(.+)$/i)?.[1] ?? cleaned;
  const normalized = tcgaDeckKey.toLowerCase().replace(/^tcga:/, "").replace(/\s+/g, " ");
  return GENERIC_DECK_NAMES.has(normalized) ? "" : cleaned;
}

function profileNeedsDisplayNameRepair(rawDisplayName: unknown, nextDisplayName: string): boolean {
  const current = compactDisplayName(rawDisplayName);
  return isGenericDisplayName(current) && !isGenericDisplayName(nextDisplayName) && current !== nextDisplayName;
}

export function readBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function publicProfileFromAccount(profile: AccountProfile): PublicProfile {
  return {
    uid: profile.uid,
    handle: profile.handle,
    handleLower: profile.handleLower,
    displayName: profile.displayName,
    searchable: profile.searchable,
    showStats: profile.showStats,
    showMatches: profile.showMatches,
    showDecks: profile.showDecks,
    showHubBadges: profile.showHubBadges,
    updatedAt: profile.updatedAt,
    searchPrefixes: buildSearchPrefixes(profile.handle, profile.displayName),
  };
}

export function buildSearchPrefixes(...values: string[]): string[] {
  const prefixes = new Set<string>();
  for (const value of values) {
    const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, " ").trim();
    for (const token of normalized.split(/\s+/).filter(Boolean)) {
      for (let index = 1; index <= Math.min(token.length, 24); index += 1) {
        prefixes.add(token.slice(0, index));
      }
    }
  }
  return Array.from(prefixes).slice(0, 80);
}

export async function ensureUserProfile(uid: string, displayName = "", email = ""): Promise<AccountProfile> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firebase admin is not configured");
  }
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  const now = Date.now();
  if (snap.exists) {
    const raw = snap.data() ?? {};
    const profile = normalizeAccountProfile(uid, raw);
    const nextDisplayName = bestProfileDisplayName(uid, displayName, profile.handle, profile.displayName);
    const patch: Record<string, unknown> = {};
    if (email && email !== profile.email) {
      patch.email = email;
      patch.emailUpdatedAt = now;
    }
    if (profileNeedsDisplayNameRepair(raw.displayName, nextDisplayName)) {
      patch.displayName = nextDisplayName;
    }
    if (Object.keys(patch).length) {
      patch.updatedAt = now;
      await ref.set(patch, { merge: true });
      const repaired = { ...profile, ...patch, updatedAt: now } as AccountProfile;
      await repairProfileReferences(repaired).catch(() => undefined);
      return repaired;
    }
    return profile;
  }
  const profile: AccountProfile = {
    uid,
    email,
    handle: "",
    handleLower: "",
    displayName: bestProfileDisplayName(uid, displayName),
    ...DEFAULT_PROFILE_VISIBILITY,
    marketingConsent: false,
    marketingConsentAt: 0,
    marketingConsentUpdatedAt: 0,
    marketingConsentVersion: "",
    marketingConsentSource: "",
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(profile, { merge: true });
  return profile;
}

export function normalizeAccountProfile(uid: string, data: Record<string, unknown>): AccountProfile {
  const handle = cleanHandle(data.handle);
  const now = Date.now();
  return {
    uid,
    email: String(data.email ?? "").trim(),
    handle,
    handleLower: handleLower(handle),
    displayName: bestProfileDisplayName(uid, data.displayName, handle),
    searchable: readBool(data.searchable, false),
    publicProfile: readBool(data.publicProfile, false),
    showStats: readBool(data.showStats, true),
    showMatches: readBool(data.showMatches, true),
    showDecks: readBool(data.showDecks, true),
    showHubBadges: readBool(data.showHubBadges, false),
    marketingConsent: readBool(data.marketingConsent, false),
    marketingConsentAt: Number(data.marketingConsentAt ?? 0),
    marketingConsentUpdatedAt: Number(data.marketingConsentUpdatedAt ?? 0),
    marketingConsentVersion: String(data.marketingConsentVersion ?? ""),
    marketingConsentSource: String(data.marketingConsentSource ?? ""),
    createdAt: Number(data.createdAt ?? now),
    updatedAt: Number(data.updatedAt ?? now),
  };
}

export async function saveAccountProfile(uid: string, patch: Partial<AccountProfile>, context: { email?: string; consentSource?: string } = {}): Promise<AccountProfile> {
  const db = getFirestoreAdmin();
  if (!db) {
    throw new Error("Firebase admin is not configured");
  }
  const userRef = db.collection("users").doc(uid);
  const now = Date.now();
  let saved: AccountProfile | null = null;

  await db.runTransaction(async (tx) => {
    const currentSnap = await tx.get(userRef);
    const current = currentSnap.exists ? normalizeAccountProfile(uid, currentSnap.data() ?? {}) : await defaultProfile(uid);
    const nextHandle = patch.handle !== undefined ? cleanHandle(patch.handle) : current.handle;
    const nextHandleLower = handleLower(nextHandle);
    const nextMarketingConsent = patch.marketingConsent ?? current.marketingConsent;
    const marketingChanged = patch.marketingConsent !== undefined && patch.marketingConsent !== current.marketingConsent;
    if (nextHandle && !validHandle(nextHandle)) {
      throw new Error("Handle must be 3-24 letters, numbers, underscores, or hyphens.");
    }
    if (nextHandleLower && nextHandleLower !== current.handleLower) {
      const handleRef = db.collection("handles").doc(nextHandleLower);
      const handleSnap = await tx.get(handleRef);
      if (handleSnap.exists && handleSnap.data()?.uid !== uid) {
        throw new Error("That handle is already taken.");
      }
      tx.set(handleRef, { uid, handle: nextHandle, updatedAt: now }, { merge: true });
      if (current.handleLower) {
        tx.delete(db.collection("handles").doc(current.handleLower));
        tx.delete(db.collection("publicProfiles").doc(current.handleLower));
      }
    }

    const next: AccountProfile = {
      ...current,
      email: context.email ?? current.email,
      handle: nextHandle,
      handleLower: nextHandleLower,
      displayName: patch.displayName !== undefined
        ? bestProfileDisplayName(uid, patch.displayName, nextHandle, current.displayName)
        : bestProfileDisplayName(uid, current.displayName, nextHandle, current.handle),
      searchable: patch.searchable ?? current.searchable,
      publicProfile: patch.publicProfile ?? current.publicProfile,
      showStats: patch.showStats ?? current.showStats,
      showMatches: patch.showMatches ?? current.showMatches,
      showDecks: patch.showDecks ?? current.showDecks,
      showHubBadges: patch.showHubBadges ?? current.showHubBadges,
      marketingConsent: nextMarketingConsent,
      marketingConsentAt: marketingChanged ? (nextMarketingConsent ? now : 0) : current.marketingConsentAt,
      marketingConsentUpdatedAt: marketingChanged ? now : current.marketingConsentUpdatedAt,
      marketingConsentVersion: marketingChanged ? MARKETING_CONSENT_VERSION : current.marketingConsentVersion,
      marketingConsentSource: marketingChanged ? (context.consentSource || MARKETING_CONSENT_SOURCE) : current.marketingConsentSource,
      updatedAt: now,
    };
    tx.set(userRef, next, { merge: true });
    if (next.publicProfile && next.handleLower) {
      tx.set(db.collection("publicProfiles").doc(next.handleLower), publicProfileFromAccount(next), { merge: true });
    } else if (next.handleLower) {
      tx.delete(db.collection("publicProfiles").doc(next.handleLower));
    }
    saved = next;
  });

  const profile = saved ?? await ensureUserProfile(uid);
  await repairProfileReferences(profile).catch(() => undefined);
  if (profile.publicProfile && profile.handleLower) {
    await rebuildUserPublicAggregate(profile).catch(() => undefined);
  }
  return profile;
}

async function defaultProfile(uid: string): Promise<AccountProfile> {
  const now = Date.now();
  return {
    uid,
    email: "",
    handle: "",
    handleLower: "",
    displayName: fallbackPlayerName(uid),
    ...DEFAULT_PROFILE_VISIBILITY,
    marketingConsent: false,
    marketingConsentAt: 0,
    marketingConsentUpdatedAt: 0,
    marketingConsentVersion: "",
    marketingConsentSource: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function createLinkCode() {
  return randomBytes(4).toString("hex").toUpperCase();
}

export function newLinkSession(uid: string) {
  const now = Date.now();
  return {
    sessionId: randomUUID(),
    code: createLinkCode(),
    desktopUid: uid,
    status: "pending",
    createdAt: now,
    expiresAt: now + LINK_SESSION_TTL_MS,
  };
}

export function encodeMatches(matches: CommunityMatch[]): string {
  return gzipSync(JSON.stringify(matches)).toString("base64");
}

export function decodeMatches(encoded: string): CommunityMatch[] {
  try {
    const parsed = JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
    return Array.isArray(parsed) ? parsed as CommunityMatch[] : [];
  } catch {
    return [];
  }
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function firstProfileString(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function firstProfileNumber(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function normalizeProfileGames(value: unknown, match: Record<string, unknown>): MatchGame[] {
  const parsed =
    typeof value === "string" && value
      ? safeJsonParse(value)
      : Array.isArray(value)
        ? value
        : [];

  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed.map((game) => {
      const row = game as Record<string, unknown>;
      const myBf = firstProfileString(row, "my_bf", "myBf", "myBattlefield", "my_battlefield");
      const oppBf = firstProfileString(row, "opp_bf", "oppBf", "opponentBattlefield", "opp_battlefield");
      const shouldUseMatchBattlefields = parsed.length === 1 || (!myBf && !oppBf);
      return {
        myBf: myBf || (shouldUseMatchBattlefields ? firstProfileString(match, "my_battlefield", "myBattlefield") : ""),
        oppBf: oppBf || (shouldUseMatchBattlefields ? firstProfileString(match, "opp_battlefield", "oppBattlefield", "opponentBattlefield") : ""),
        wentFirst: firstProfileString(row, "went_first", "wentFirst") || firstProfileString(match, "went_first", "wentFirst"),
        result: firstProfileString(row, "result"),
        myPoints: firstProfileNumber(row, "my_points", "myPoints", "myScore", "my_score"),
        oppPoints: firstProfileNumber(row, "opp_points", "oppPoints", "oppScore", "opponentScore", "opp_score"),
      };
    });
  }

  const fallbackMyBf = firstProfileString(match, "my_battlefield", "myBattlefield");
  const fallbackOppBf = firstProfileString(match, "opp_battlefield", "oppBattlefield", "opponentBattlefield");
  const fallbackSeat = firstProfileString(match, "went_first", "wentFirst");
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

function normalizeProfileSnapshot(value: unknown): DeckSnapshot | null {
  if (!value) return null;
  const parsed = typeof value === "string" ? safeJsonParse(value) : value;
  return parsed && typeof parsed === "object" ? parsed as DeckSnapshot : null;
}

function normalizeProfileMatch(id: string, raw: Record<string, unknown>): CommunityMatch {
  const uid = String(raw.uid ?? raw.owner_uid ?? "").trim();
  const username = bestProfileDisplayName(uid, raw.username, raw.owner_display_name, raw.ownerDisplayName, raw.displayName, raw.owner_handle, raw.ownerHandle);
  return {
    id,
    uid,
    username,
    date: String(raw.date ?? "").trim(),
    result: String(raw.result ?? "").trim() as CommunityMatch["result"],
    myChampion: String(raw.my_champion ?? raw.myChampion ?? "").trim(),
    oppChampion: String(raw.opp_champion ?? raw.oppChampion ?? "").trim(),
    oppName: String(raw.opp_name ?? raw.oppName ?? "").trim(),
    fmt: String(raw.fmt ?? raw.format ?? "Bo1").trim() || "Bo1",
    score: String(raw.score ?? "").trim(),
    wentFirst: String(raw.went_first ?? raw.wentFirst ?? "").trim(),
    myBattlefield: String(raw.my_battlefield ?? raw.myBattlefield ?? "").trim(),
    oppBattlefield: String(raw.opp_battlefield ?? raw.oppBattlefield ?? "").trim(),
    flags: String(raw.flags ?? "").trim(),
    games: normalizeProfileGames(raw.games_json ?? raw.games, raw),
    deckName: cleanDeckName(raw.my_deck_name ?? raw.deckName ?? raw.myDeckName),
    deckSourceUrl: cleanDeckSource(raw.my_deck_source_url ?? raw.deckSourceUrl),
    deckSourceKey: cleanDeckSource(raw.my_deck_source_key ?? raw.deckSourceKey),
    deckSnapshot: normalizeProfileSnapshot(raw.my_deck_snapshot_json ?? raw.deckSnapshot),
    createdAt: Number(raw.created_at ?? raw.createdAt ?? Date.now()),
  };
}

export function repairCachedProfileMatch(match: CommunityMatch): CommunityMatch {
  return normalizeProfileMatch(match.id, match as unknown as Record<string, unknown>);
}

function repairCachedProfileMatches(matches: CommunityMatch[]): CommunityMatch[] {
  return matches.map((match) => repairCachedProfileMatch(match));
}

export async function appendUserPublicMatch(match: CommunityMatch) {
  if (!match.uid) return;
  const db = getFirestoreAdmin();
  if (!db) return;
  const profileSnap = await db.collection("users").doc(match.uid).get();
  if (!profileSnap.exists) return;
  const profile = normalizeAccountProfile(match.uid, profileSnap.data() ?? {});
  if (!profile.publicProfile || !profile.handleLower) return;

  const ref = db.collection("userAggregates").doc(match.uid);
  const snap = await ref.get();
  const existing = decodeMatches(String(snap.data()?.matchesEncoded ?? ""));
  const matches = [match, ...existing.filter((item) => item.id !== match.id)]
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
    .slice(0, USER_MATCH_WINDOW);
  const aggregate = buildUserAggregate(profile, matches);
  await ref.set({
    ...aggregate,
    matchesEncoded: encodeMatches(matches),
    recentMatches: matches.slice(0, 20),
    updatedAt: Date.now(),
  }, { merge: true });
}

export async function rebuildUserPublicAggregate(profileOrUid: AccountProfile | string): Promise<UserAggregate | null> {
  const db = getFirestoreAdmin();
  if (!db) return null;
  const profile = typeof profileOrUid === "string"
    ? normalizeAccountProfile(profileOrUid, (await db.collection("users").doc(profileOrUid).get()).data() ?? {})
    : profileOrUid;
  if (!profile.uid || !profile.publicProfile || !profile.handleLower) return null;

  const byId = new Map<string, CommunityMatch>();
  const addSnapshot = (snapshot: FirebaseFirestore.QuerySnapshot) => {
    for (const doc of snapshot.docs) {
      try {
        byId.set(doc.id, normalizeProfileMatch(doc.id, doc.data() as Record<string, unknown>));
      } catch (error) {
        console.warn("[social] Skipped malformed public profile match", doc.id, error);
      }
    }
    return snapshot.size;
  };
  const addQuery = async (label: string, query: Query): Promise<number> => {
    try {
      return addSnapshot(await query.get());
    } catch (error) {
      console.warn(`[social] Public profile match query failed: ${label}`, error);
      return 0;
    }
  };

  let uidMatches = await addQuery("uid + created_at", db
    .collection("matches")
    .where("uid", "==", profile.uid)
    .orderBy("created_at", "desc")
    .limit(USER_MATCH_WINDOW));
  if (uidMatches === 0) {
    uidMatches = await addQuery("uid", db
      .collection("matches")
      .where("uid", "==", profile.uid)
      .limit(USER_MATCH_WINDOW));
  }

  if (uidMatches === 0) {
    await addQuery("owner_uid", db
      .collection("matches")
      .where("owner_uid", "==", profile.uid)
      .limit(USER_MATCH_WINDOW));
  }

  const matches = Array.from(byId.values())
    .filter((match) => match.uid === profile.uid)
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
    .slice(0, USER_MATCH_WINDOW);
  const aggregate = buildUserAggregate(profile, matches);
  await db.collection("userAggregates").doc(profile.uid).set({
    ...aggregate,
    matchesEncoded: encodeMatches(matches),
    recentMatches: matches.slice(0, 20),
    backfillAttemptAt: Date.now(),
    updatedAt: Date.now(),
  }, { merge: true });
  return aggregate;
}

export function buildUserAggregate(profile: AccountProfile, matches: CommunityMatch[]): UserAggregate {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  const legendCounts = new Map<string, number>();
  for (const match of matches) {
    if (match.result === "Win") wins += 1;
    else if (match.result === "Loss") losses += 1;
    else if (match.result === "Draw") draws += 1;
    if (match.myChampion) {
      legendCounts.set(match.myChampion, (legendCounts.get(match.myChampion) ?? 0) + 1);
    }
  }
  const topLegend = Array.from(legendCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return {
    uid: profile.uid,
    handle: profile.handle,
    displayName: profile.displayName,
    updatedAt: Date.now(),
    totalMatches: matches.length,
    wins,
    losses,
    draws,
    winRate: wins + losses ? Number(((wins / (wins + losses)) * 100).toFixed(1)) : 0,
    topLegend,
    recentMatches: matches.slice(0, 20),
  };
}

export async function getPublicProfileByHandle(handle: string) {
  const db = getFirestoreAdmin();
  if (!db) return null;
  const clean = handleLower(cleanHandle(handle));
  if (!clean) return null;
  const profileSnap = await db.collection("publicProfiles").doc(clean).get();
  if (!profileSnap.exists) return null;
  const rawProfile = profileSnap.data() as PublicProfile;
  const profile: PublicProfile = {
    ...rawProfile,
    displayName: cleanDisplayName(rawProfile.displayName, rawProfile.handle || clean),
  };
  let aggregateSnap = await db.collection("userAggregates").doc(String(profile.uid)).get();
  let aggregateData = aggregateSnap.data() ?? {};
  let matches = repairCachedProfileMatches(decodeMatches(String(aggregateData.matchesEncoded ?? "")));
  if (!matches.length && Array.isArray(aggregateData.recentMatches)) {
    matches = repairCachedProfileMatches(aggregateData.recentMatches as CommunityMatch[]);
  }
  const lastBackfillAttemptAt = Number(aggregateData.backfillAttemptAt ?? 0);
  const canBackfill = Date.now() - lastBackfillAttemptAt > USER_BACKFILL_COOLDOWN_MS;
  if (!matches.length && profile.uid && canBackfill) {
    try {
      const rebuilt = await rebuildUserPublicAggregate(String(profile.uid));
      if (rebuilt) {
        aggregateSnap = await db.collection("userAggregates").doc(String(profile.uid)).get();
        aggregateData = aggregateSnap.data() ?? {};
        matches = repairCachedProfileMatches(decodeMatches(String(aggregateData.matchesEncoded ?? "")));
        if (!matches.length && Array.isArray(aggregateData.recentMatches)) {
          matches = repairCachedProfileMatches(aggregateData.recentMatches as CommunityMatch[]);
        }
      }
    } catch (error) {
      console.warn("[social] Public profile backfill failed during read", profile.uid, error);
      await db.collection("userAggregates").doc(String(profile.uid)).set({
        backfillAttemptAt: Date.now(),
        updatedAt: Date.now(),
      }, { merge: true }).catch(() => undefined);
      aggregateSnap = await db.collection("userAggregates").doc(String(profile.uid)).get();
      aggregateData = aggregateSnap.data() ?? {};
      matches = repairCachedProfileMatches(decodeMatches(String(aggregateData.matchesEncoded ?? "")));
      if (!matches.length && Array.isArray(aggregateData.recentMatches)) {
        matches = repairCachedProfileMatches(aggregateData.recentMatches as CommunityMatch[]);
      }
    }
  }
  return {
    profile,
    aggregate: {
      uid: profile.uid,
      handle: profile.handle,
      displayName: profile.displayName,
      updatedAt: Number(aggregateData.updatedAt ?? profile.updatedAt ?? 0),
      totalMatches: Number(aggregateData.totalMatches ?? matches.length),
      wins: Number(aggregateData.wins ?? 0),
      losses: Number(aggregateData.losses ?? 0),
      draws: Number(aggregateData.draws ?? 0),
      winRate: Number(aggregateData.winRate ?? 0),
      topLegend: String(aggregateData.topLegend ?? ""),
      // Keep this profile page aggregate-only: the richer explorer can use a
      // larger cached match window without adding extra Firestore reads.
      recentMatches: profile.showMatches ? matches.slice(0, PROFILE_PAGE_MATCH_WINDOW) : [],
    } satisfies UserAggregate,
  };
}

export async function repairProfileReferences(profile: AccountProfile): Promise<void> {
  const db = getFirestoreAdmin();
  if (!db || !profile.uid) return;
  const displayName = bestProfileDisplayName(profile.uid, profile.displayName, profile.handle);
  const handle = profile.handle || "";
  const now = Date.now();
  const batch = db.batch();
  let writes = 0;

  const queueSet = (ref: DocumentReference, data: Record<string, unknown>) => {
    if (writes >= 450) return;
    batch.set(ref, data, { merge: true });
    writes += 1;
  };

  if (profile.handleLower) {
    if (profile.publicProfile) {
      queueSet(db.collection("publicProfiles").doc(profile.handleLower), {
        displayName,
        handle,
        searchPrefixes: buildSearchPrefixes(handle, displayName),
        updatedAt: now,
      });
    }
    queueSet(db.collection("handles").doc(profile.handleLower), {
      uid: profile.uid,
      handle,
      updatedAt: now,
    });
  }

  queueSet(db.collection("userAggregates").doc(profile.uid), {
    displayName,
    handle,
    updatedAt: now,
  });

  const updateCollectionGroup = async (collectionId: string, field: string, value: string, data: Record<string, unknown>) => {
    const snap = await db.collectionGroup(collectionId).where(field, "==", value).limit(150).get().catch(() => null);
    for (const doc of snap?.docs ?? []) {
      queueSet(doc.ref, data);
    }
  };

  await updateCollectionGroup("members", "uid", profile.uid, { displayName, handle, updatedAt: now });
  await updateCollectionGroup("messages", "uid", profile.uid, { displayName, handle, updatedAt: now });
  await updateCollectionGroup("inbox", "senderUid", profile.uid, { senderDisplayName: displayName, senderHandle: handle, updatedAt: now });

  const inviteSnap = await db.collection("hubInvites").where("senderUid", "==", profile.uid).limit(150).get().catch(() => null);
  for (const doc of inviteSnap?.docs ?? []) {
    queueSet(doc.ref, { senderDisplayName: displayName, senderHandle: handle, updatedAt: now });
  }

  if (writes) {
    await batch.commit();
  }
}

export async function assertHubRole(hubId: string, uid: string, roles: string[]) {
  const db = getFirestoreAdmin();
  if (!db) throw new Error("Firebase admin is not configured");
  const member = await db.collection("hubs").doc(hubId).collection("members").doc(uid).get();
  const role = String(member.data()?.role ?? "");
  if (!member.exists || !roles.includes(role)) {
    throw new Error("You do not have permission for this hub action.");
  }
  return role;
}

export function hubIdFromName(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
}

export function nowField() {
  return FieldValue.serverTimestamp();
}
