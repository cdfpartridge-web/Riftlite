import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync, inflateRawSync } from "node:zlib";

import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
} from "firebase-admin/firestore";
import { type NextRequest, NextResponse } from "next/server";

import {
  DESKTOP_IDENTITY_BACKFILL_VERSION,
  historicalDesktopIdentitySources,
} from "@/lib/account-connection";
import {
  ACCOUNT_CLOUD_SYNC_FORMAT,
  ACCOUNT_CLOUD_SYNC_VERSION,
  accountCloudSyncChunkDocumentId,
  accountCloudSyncManifestFingerprint,
  normalizeAccountCloudSyncManifest,
  validateAccountCloudSyncChunk,
  type AccountCloudSyncManifest,
} from "@/lib/account-cloud-sync-conflict";
import { conflictingLinkedIdentityCanonicalUid } from "@/lib/account-link";
import { getFirestoreAdmin, verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { canonicalIdentityUid } from "@/lib/identity-server";
import {
  hubRoleHasCapability,
  normalizeHubMemberRole,
  type HubCapability,
  type HubMemberRole,
} from "@/lib/social/hub-permissions";
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
  profileComplete: boolean;
  onboardingVersion: number;
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
const CURRENT_ONBOARDING_VERSION = 1;

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
  const authenticatedUid = decoded.uid;
  const canonicalUid = await canonicalIdentityUid(authenticatedUid, db);
  return {
    db,
    decoded: canonicalUid && canonicalUid !== authenticatedUid ? { ...decoded, uid: canonicalUid } : decoded,
    authenticatedUid,
    token,
  };
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

function isEmailDisplayName(value: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(compactDisplayName(value));
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
    if (!isGenericDisplayName(cleaned) && !isEmailDisplayName(cleaned)) {
      return cleaned;
    }
  }
  return fallbackPlayerName(uid);
}

export function profileIsComplete(profile: Pick<AccountProfile, "handle" | "displayName">): boolean {
  return validHandle(profile.handle) && !isGenericDisplayName(profile.displayName) && !isEmailDisplayName(profile.displayName);
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
    if (isEmailDisplayName(raw.displayName)) {
      patch.displayName = "";
    }
    const nextProfile = { ...profile, ...patch } as AccountProfile;
    const profileComplete = profileIsComplete(nextProfile);
    if (raw.profileComplete !== profileComplete || Number(raw.onboardingVersion ?? 0) !== (profileComplete ? CURRENT_ONBOARDING_VERSION : 0)) {
      patch.profileComplete = profileComplete;
      patch.onboardingVersion = profileComplete ? CURRENT_ONBOARDING_VERSION : 0;
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
    profileComplete: false,
    onboardingVersion: 0,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(profile, { merge: true });
  return profile;
}

export function normalizeAccountProfile(uid: string, data: Record<string, unknown>): AccountProfile {
  const handle = cleanHandle(data.handle);
  const now = Date.now();
  const profile = {
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
    profileComplete: false,
    onboardingVersion: Number(data.onboardingVersion ?? 0),
    createdAt: Number(data.createdAt ?? now),
    updatedAt: Number(data.updatedAt ?? now),
  };
  profile.profileComplete = profileIsComplete(profile);
  profile.onboardingVersion = profile.profileComplete ? Math.max(CURRENT_ONBOARDING_VERSION, profile.onboardingVersion) : 0;
  return profile;
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
      profileComplete: false,
      onboardingVersion: 0,
      updatedAt: now,
    };
    next.profileComplete = profileIsComplete(next);
    next.onboardingVersion = next.profileComplete ? CURRENT_ONBOARDING_VERSION : 0;
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
    profileComplete: false,
    onboardingVersion: 0,
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

export class LinkedIdentityConflictError extends Error {
  readonly existingCanonicalUid: string;

  constructor(existingCanonicalUid: string) {
    super("This desktop identity is already linked to another RiftLite account.");
    this.name = "LinkedIdentityConflictError";
    this.existingCanonicalUid = existingCanonicalUid;
  }
}

export async function claimLinkedIdentityAssociation(
  db: Firestore,
  sourceUid: string,
  canonicalUid: string,
  now = Date.now(),
): Promise<void> {
  const source = String(sourceUid ?? "").trim();
  const canonical = String(canonicalUid ?? "").trim();
  if (!source || !canonical) return;
  const association = {
    canonicalUid: canonical,
    sourceUid: source,
    linkedAt: now,
    migrationVersion: 1,
  };

  await db.runTransaction(async (tx) => {
    const sourceAliasRef = db.collection("identityAliases").doc(source);
    const sourceUserRef = db.collection("users").doc(source);
    const canonicalAliasRef = db.collection("identityAliases").doc(canonical);
    const canonicalUserRef = db.collection("users").doc(canonical);
    const [sourceAliasSnap, sourceUserSnap] = await Promise.all([
      tx.get(sourceAliasRef),
      tx.get(sourceUserRef),
    ]);
    const [canonicalAliasSnap, canonicalUserSnap] = source === canonical
      ? [sourceAliasSnap, sourceUserSnap]
      : await Promise.all([
        tx.get(canonicalAliasRef),
        tx.get(canonicalUserRef),
      ]);
    const conflict = conflictingLinkedIdentityCanonicalUid(
      canonical,
      sourceAliasSnap.data()?.canonicalUid,
      sourceUserSnap.data()?.canonicalUid,
    ) || conflictingLinkedIdentityCanonicalUid(
      canonical,
      canonicalAliasSnap.data()?.canonicalUid,
      canonicalUserSnap.data()?.canonicalUid,
    );
    if (conflict) throw new LinkedIdentityConflictError(conflict);

    const sourceLinkedAt = positiveNumber(sourceAliasSnap.data()?.linkedAt, now);
    const canonicalLinkedAt = positiveNumber(canonicalAliasSnap.data()?.linkedAt, now);
    tx.set(sourceAliasRef, { ...association, linkedAt: sourceLinkedAt }, { merge: true });
    if (source !== canonical) {
      tx.set(canonicalAliasRef, {
        ...association,
        sourceUid: canonical,
        linkedAt: canonicalLinkedAt,
      }, { merge: true });
    }
    tx.set(canonicalUserRef, {
      canonicalUid: canonical,
      identityAliases: FieldValue.arrayUnion(source, canonical),
      identityUpdatedAt: now,
    }, { merge: true });
    if (source !== canonical) {
      tx.set(sourceUserRef, {
        canonicalUid: canonical,
        identityAliases: FieldValue.arrayUnion(source, canonical),
        identityUpdatedAt: now,
      }, { merge: true });
    }
  });
}

export async function associateLinkedIdentity(
  sourceUid: string,
  canonicalUid: string,
  providedDb?: Firestore,
): Promise<void> {
  const source = String(sourceUid ?? "").trim();
  const canonical = String(canonicalUid ?? "").trim();
  if (!source || !canonical) return;
  const db = providedDb ?? getFirestoreAdmin();
  if (!db) throw new Error("Firebase admin is not configured");
  const now = Date.now();

  // Claim the source identity before profile promotion, data migration, or
  // token creation can happen. The transaction makes the first proven bind
  // immutable while allowing retries to the same canonical UID.
  await claimLinkedIdentityAssociation(db, source, canonical, now);

  if (source !== canonical) {
    await db.runTransaction(async (tx) => {
      const sourceRef = db.collection("users").doc(source);
      const canonicalRef = db.collection("users").doc(canonical);
      const [sourceSnap, canonicalSnap] = await Promise.all([tx.get(sourceRef), tx.get(canonicalRef)]);
      if (!sourceSnap.exists) return;
      const sourceProfile = normalizeAccountProfile(source, sourceSnap.data() ?? {});
      const canonicalProfile = normalizeAccountProfile(canonical, canonicalSnap.data() ?? {});
      if (!profileIsComplete(sourceProfile) || profileIsComplete(canonicalProfile)) return;
      const handleRef = db.collection("handles").doc(sourceProfile.handleLower);
      const handleSnap = await tx.get(handleRef);
      const handleOwner = String(handleSnap.data()?.uid ?? "");
      if (handleSnap.exists && handleOwner !== source && handleOwner !== canonical) return;
      tx.set(handleRef, { uid: canonical, handle: sourceProfile.handle, updatedAt: now }, { merge: true });
      tx.set(canonicalRef, {
        handle: sourceProfile.handle,
        handleLower: sourceProfile.handleLower,
        displayName: sourceProfile.displayName,
        profileComplete: true,
        onboardingVersion: CURRENT_ONBOARDING_VERSION,
        identityPromotedFromUid: source,
        updatedAt: now,
      }, { merge: true });
      if (sourceProfile.publicProfile) {
        tx.set(db.collection("publicProfiles").doc(sourceProfile.handleLower), {
          ...publicProfileFromAccount({ ...sourceProfile, uid: canonical }),
          uid: canonical,
          updatedAt: now,
        }, { merge: true });
      }
    });
  }

  if (source === canonical) return;
  await migrateLinkedIdentityReferences(source, canonical, now).catch(async (error) => {
    await db.collection("identityAliases").doc(source).set({
      migrationError: error instanceof Error ? error.message : "Identity migration needs retry",
      migrationAttemptAt: Date.now(),
    }, { merge: true });
  });
}

export async function identityUidsFor(uid: string, providedDb?: Firestore): Promise<string[]> {
  const cleanUid = String(uid ?? "").trim();
  if (!cleanUid) return [];
  const db = providedDb ?? getFirestoreAdmin();
  if (!db) return [cleanUid];
  const canonicalUid = await canonicalIdentityUid(cleanUid, db);
  const [sourceSnap, canonicalSnap] = await Promise.all([
    db.collection("users").doc(cleanUid).get().catch(() => null),
    canonicalUid === cleanUid
      ? Promise.resolve(null)
      : db.collection("users").doc(canonicalUid).get().catch(() => null),
  ]);
  const aliases = [sourceSnap, canonicalSnap].flatMap((snap) => Array.isArray(snap?.data()?.identityAliases)
    ? snap.data()?.identityAliases.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
    : []);
  const candidates = Array.from(new Set([cleanUid, canonicalUid, ...aliases].filter(Boolean))).slice(0, 100);
  const validated = await Promise.all(candidates.map(async (candidate) => ({
    candidate,
    canonical: await canonicalIdentityUid(candidate, db).catch(() => ""),
  })));
  return validated
    .filter(({ candidate, canonical }) => candidate === canonicalUid || canonical === canonicalUid)
    .map(({ candidate }) => candidate);
}

export async function repairHistoricalDesktopIdentityAssociations(
  canonicalUid: string,
  providedDb?: Firestore,
): Promise<string[]> {
  const canonical = String(canonicalUid ?? "").trim();
  if (!canonical) return [];
  const db = providedDb ?? getFirestoreAdmin();
  if (!db) return [];
  const userRef = db.collection("users").doc(canonical);
  const userSnap = await userRef.get();
  if (Number(userSnap.data()?.desktopIdentityBackfillVersion ?? 0) >= DESKTOP_IDENTITY_BACKFILL_VERSION) {
    return [];
  }

  const sessions = await db.collection("desktopLinkSessions")
    .where("linkedUid", "==", canonical)
    .limit(100)
    .get();
  const sources = historicalDesktopIdentitySources(
    sessions.docs.map((doc) => doc.data()),
    canonical,
  );
  const conflicts: Array<{ sourceUid: string; existingCanonicalUid: string }> = [];
  for (const source of sources) {
    try {
      await associateLinkedIdentity(source, canonical, db);
    } catch (error) {
      if (!(error instanceof LinkedIdentityConflictError)) throw error;
      conflicts.push({ sourceUid: source, existingCanonicalUid: error.existingCanonicalUid });
      // Retain the first proven bind and leave a durable repair signal instead
      // of breaking every future connection-health request for this account.
      await db.collection("identityAliases").doc(source).set({
        migrationError: "Conflicting canonical identity binding retained",
        migrationConflictCanonicalUid: error.existingCanonicalUid,
        migrationRequestedCanonicalUid: canonical,
        migrationAttemptAt: Date.now(),
      }, { merge: true });
    }
  }
  await userRef.set({
    desktopIdentityBackfillVersion: DESKTOP_IDENTITY_BACKFILL_VERSION,
    desktopIdentityBackfilledAt: Date.now(),
    desktopIdentityBackfilledSources: sources.length - conflicts.length,
    desktopIdentityBackfillConflicts: conflicts,
  }, { merge: true });
  return sources.filter((source) => !conflicts.some((conflict) => conflict.sourceUid === source));
}

type MembershipParentCollection = "hubs" | "teams";

/**
 * Finds memberships through the fast collection-group index when it is
 * available, then falls back to direct member document reads. Member IDs are
 * the Firebase UID throughout RiftLite, so the fallback is deterministic and
 * does not require scanning private match or message data.
 */
export async function findMembershipDocuments(
  db: Firestore,
  uids: string[],
  parentCollection: MembershipParentCollection,
): Promise<DocumentSnapshot[]> {
  const identityUids = Array.from(new Set(uids.map((value) => String(value ?? "").trim()).filter(Boolean)));
  if (!identityUids.length) return [];

  try {
    const indexed = await Promise.all(identityUids.map((uid) => (
      db.collectionGroup("members").where("uid", "==", uid).get()
    )));
    return dedupeDocumentSnapshots(indexed.flatMap((snapshot) => snapshot.docs)
      .filter((doc) => doc.ref.parent.parent?.parent.id === parentCollection));
  } catch {
    const parents = await db.collection(parentCollection).get();
    const refs = parents.docs.flatMap((parent) => identityUids.map((uid) => parent.ref.collection("members").doc(uid)));
    const members: DocumentSnapshot[] = [];
    for (let offset = 0; offset < refs.length; offset += 250) {
      members.push(...await db.getAll(...refs.slice(offset, offset + 250)));
    }
    return dedupeDocumentSnapshots(members.filter((member) => member.exists));
  }
}

function dedupeDocumentSnapshots(documents: DocumentSnapshot[]): DocumentSnapshot[] {
  return Array.from(new Map(documents.map((document) => [document.ref.path, document])).values());
}

async function findNestedDocumentsByField(
  db: Firestore,
  collectionId: string,
  field: string,
  value: string,
  parentCollections: MembershipParentCollection[],
  limit = Number.POSITIVE_INFINITY,
): Promise<DocumentSnapshot[]> {
  try {
    let query: Query = db.collectionGroup(collectionId).where(field, "==", value);
    if (Number.isFinite(limit)) query = query.limit(limit);
    return (await query.get()).docs;
  } catch {
    const documents: DocumentSnapshot[] = [];
    for (const parentCollection of parentCollections) {
      const parents = await db.collection(parentCollection).get();
      for (let offset = 0; offset < parents.docs.length && documents.length < limit; offset += 25) {
        const remaining = Number.isFinite(limit) ? Math.max(1, limit - documents.length) : 200;
        const snapshots = await Promise.all(parents.docs.slice(offset, offset + 25).map((parent) => (
          parent.ref.collection(collectionId).where(field, "==", value).limit(remaining).get()
        )));
        documents.push(...snapshots.flatMap((snapshot) => snapshot.docs));
      }
    }
    return dedupeDocumentSnapshots(documents).slice(0, Number.isFinite(limit) ? limit : undefined);
  }
}

async function migrateLinkedIdentityReferences(sourceUid: string, canonicalUid: string, now: number): Promise<void> {
  const db = getFirestoreAdmin();
  if (!db) return;
  const profile = await ensureUserProfile(canonicalUid);
  const updates: Array<{ ref: DocumentReference; data: Record<string, unknown> }> = [];
  const queueSet = (ref: DocumentReference, value: Record<string, unknown>) => {
    updates.push({ ref, data: value });
  };

  const sourceMembers = [
    ...await findMembershipDocuments(db, [sourceUid], "hubs"),
    ...await findMembershipDocuments(db, [sourceUid], "teams"),
  ];
  for (const memberDoc of sourceMembers) {
    const ownerRef = memberDoc.ref.parent.parent;
    if (!ownerRef) continue;
    const canonicalRef = ownerRef.collection("members").doc(canonicalUid);
    const canonicalSnap = await canonicalRef.get().catch(() => null);
    const sourceData = memberDoc.data() ?? {};
    const canonicalData = canonicalSnap?.data() ?? {};
    const role = strongerRole(String(sourceData.role ?? "member"), String(canonicalData.role ?? ""));
    const joinedAt = Math.min(
      positiveNumber(sourceData.joinedAt, now),
      positiveNumber(canonicalData.joinedAt, now),
    );
    queueSet(canonicalRef, {
      ...sourceData,
      uid: canonicalUid,
      role,
      handle: profile.handle,
      displayName: bestProfileDisplayName(canonicalUid, profile.displayName, profile.handle),
      joinedAt,
      migratedFromUid: sourceUid,
      updatedAt: now,
    });
    queueSet(memberDoc.ref, { canonicalUid, migratedToUid: canonicalUid, updatedAt: now });
  }

  for (const field of ["owner_uid", "created_by"] as const) {
    const hubs = await db.collection("hubs").where(field, "==", sourceUid).get();
    for (const hub of hubs.docs) {
      queueSet(hub.ref, { [field]: canonicalUid, owner_uid: canonicalUid, identityMigratedAt: now });
    }
  }
  const teams = await db.collection("teams").where("ownerUid", "==", sourceUid).get();
  for (const team of teams.docs) {
    queueSet(team.ref, { ownerUid: canonicalUid, identityMigratedAt: now });
  }

  const inbox = await db.collection("users").doc(sourceUid).collection("inbox").get();
  for (const item of inbox.docs) {
    queueSet(db.collection("users").doc(canonicalUid).collection("inbox").doc(item.id), {
      ...item.data(),
      migratedFromUid: sourceUid,
      updatedAt: now,
    });
  }

  const discordLinks = await db.collection("discordLinks").where("uid", "==", sourceUid).get();
  for (const link of discordLinks.docs) {
    queueSet(link.ref, {
      uid: canonicalUid,
      previousUid: sourceUid,
      handle: profile.handle,
      displayName: bestProfileDisplayName(canonicalUid, profile.displayName, profile.handle),
      updatedAt: now,
    });
  }

  const replays = await db.collection("replayV2").where("ownerUid", "==", sourceUid).get();
  for (const replay of replays.docs) {
    const replayData = replay.data();
    queueSet(replay.ref, { ownerUid: canonicalUid, previousOwnerUid: sourceUid, identityMigratedAt: now });
    queueSet(db.collection("replayV2Owners").doc(canonicalUid).collection("items").doc(replay.id), {
      ...replayData,
      ownerUid: canonicalUid,
      previousOwnerUid: sourceUid,
      identityMigratedAt: now,
    });
  }

  await commitMigrationUpdates(updates);
  await migrateIdentitySnapshots(sourceUid, canonicalUid, profile, now);
  await migrateAccountCloudBackup(sourceUid, canonicalUid, now);
  await db.collection("identityAliases").doc(sourceUid).set({
    migrationCompletedAt: now,
    migrationError: FieldValue.delete(),
  }, { merge: true });
}

async function migrateIdentitySnapshots(sourceUid: string, canonicalUid: string, profile: AccountProfile, now: number): Promise<void> {
  const db = getFirestoreAdmin();
  if (!db) return;
  const displayName = bestProfileDisplayName(canonicalUid, profile.displayName, profile.handle);
  for (const collectionId of ["matches", "messages"] as const) {
    const documents = await findNestedDocumentsByField(db, collectionId, "uid", sourceUid, ["hubs", "teams"]);
    const updates = documents.map((doc) => ({
      ref: doc.ref,
      data: {
        uid: canonicalUid,
        owner_uid: collectionId === "matches" ? canonicalUid : undefined,
        previousUid: sourceUid,
        owner_display_name: collectionId === "matches" ? displayName : undefined,
        username: collectionId === "matches" ? displayName : undefined,
        displayName,
        handle: profile.handle,
        identityMigratedAt: now,
      },
    }));
    await commitMigrationUpdates(updates);
  }
}

const ACCOUNT_CLOUD_SYNC_MIGRATION_MAX_CHUNKS = 64;
// Keep worst-case 450 KB chunk batches comfortably below Firestore's 10 MiB
// write-request limit, including document and protocol overhead.
const ACCOUNT_CLOUD_SYNC_MIGRATION_BATCH_SIZE = 16;

type PreparedAccountCloudMigration = {
  canonicalManifestData: Record<string, unknown>;
  sourceContentFingerprint: string;
  sourceFingerprint: string;
  stagedGenerationId: string;
  stagedChunkWrites: Array<{ ref: DocumentReference; data: Record<string, unknown> }>;
};

type AccountCloudMigrationOutcome = "migrated" | "already-migrated" | "conflict" | "source-changed";

export async function migrateAccountCloudBackup(
  sourceUid: string,
  canonicalUid: string,
  now: number,
  providedDb?: Firestore,
): Promise<void> {
  const db = providedDb ?? getFirestoreAdmin();
  if (!db) return;
  const sourceRoot = db.collection("accountSync").doc(sourceUid);
  const canonicalRoot = db.collection("accountSync").doc(canonicalUid);
  const sourceManifestRef = sourceRoot.collection("manifest").doc("current");
  const canonicalManifestRef = canonicalRoot.collection("manifest").doc("current");
  const aliasRef = db.collection("identityAliases").doc(sourceUid);
  const canonicalUserRef = db.collection("users").doc(canonicalUid);
  const [sourceManifestSnapshot, canonicalManifestSnapshot, aliasSnapshot] = await Promise.all([
    sourceManifestRef.get().catch(() => null),
    canonicalManifestRef.get().catch(() => null),
    aliasRef.get().catch(() => null),
  ]);
  if (!sourceManifestSnapshot?.exists) return;

  const sourceManifest = accountCloudManifestFromSnapshot(sourceManifestSnapshot);
  const aliasData = aliasSnapshot?.data() ?? {};
  if (canonicalManifestSnapshot?.exists) {
    if (!sourceManifest) {
      // An invalid retained copy cannot be offered as a safe recovery choice.
      // Surface repair attention without creating an unresolvable two-backup
      // conflict or modifying the valid canonical backup.
      await aliasRef.set({
        cloudSyncConflict: FieldValue.delete(),
        cloudSyncCheckedAt: now,
      }, { merge: true });
      throw new Error("The retained account backup manifest is invalid and needs support.");
    }
    const sourceFingerprint = accountCloudSyncManifestFingerprint(sourceManifest);
    const sourceContentFingerprint = accountCloudMigrationContentFingerprint(sourceManifest);

    // An explicit owner decision remains authoritative until the retained
    // source changes again. This also prevents a resolved migrated backup from
    // being reopened merely because its canonical manifest still has migration
    // provenance fields.
    if (
      aliasData.cloudSyncConflict === false &&
      String(aliasData.cloudSyncResolvedSourceFingerprint ?? "").trim() === sourceFingerprint
    ) {
      await aliasRef.set({ cloudSyncCheckedAt: now }, { merge: true });
      return;
    }

    const canonicalData = canonicalManifestSnapshot.data() ?? {};
    const canonicalManifest = accountCloudManifestFromSnapshot(canonicalManifestSnapshot);
    if (String(canonicalData.identityMigratedFromUid ?? "").trim() === sourceUid) {
      const storedSourceFingerprint = String(
        canonicalData.identityMigratedSourceFingerprint ?? aliasData.cloudSyncMigratedSourceFingerprint ?? "",
      ).trim();
      const storedSourceContentFingerprint = String(
        canonicalData.identityMigratedSourceContentFingerprint ??
        aliasData.cloudSyncMigratedSourceContentFingerprint ??
        "",
      ).trim();
      const legacyMigrationStillMatches = !storedSourceFingerprint &&
        !storedSourceContentFingerprint &&
        canonicalManifest &&
        accountCloudMigrationContentFingerprint(canonicalManifest) === sourceContentFingerprint;
      if (
        storedSourceFingerprint === sourceFingerprint ||
        storedSourceContentFingerprint === sourceContentFingerprint ||
        legacyMigrationStillMatches
      ) {
        await aliasRef.set(accountCloudMigrationCompleteData(
          sourceFingerprint,
          sourceContentFingerprint,
          positiveNumber(canonicalData.identityMigratedAt, now),
          now,
        ), { merge: true });
        return;
      }
    }

    // There are now two independently changed backups. Retain both and make
    // the choice explicit instead of silently treating the first migration as
    // permanently complete.
    await markAccountCloudBackupConflict(db, sourceUid, canonicalUid, now);
    return;
  }

  if (!sourceManifest) {
    throw new Error("The retained account backup manifest is invalid and was not migrated.");
  }
  const prepared = await prepareAccountCloudMigration(
    sourceRoot,
    canonicalRoot,
    sourceManifestSnapshot,
    sourceManifest,
    sourceUid,
    now,
  );

  try {
    await commitAccountCloudMigrationChunks(db, prepared.stagedChunkWrites);
  } catch (error) {
    await cleanupAccountCloudMigrationChunks(db, prepared.stagedChunkWrites.map(({ ref }) => ref)).catch(() => undefined);
    throw error;
  }

  let outcome: AccountCloudMigrationOutcome;
  try {
    outcome = await db.runTransaction(async (transaction): Promise<AccountCloudMigrationOutcome> => {
      const [latestSourceSnapshot, latestCanonicalSnapshot] = await Promise.all([
        transaction.get(sourceManifestRef),
        transaction.get(canonicalManifestRef),
      ]);
      const latestSourceManifest = accountCloudManifestFromSnapshot(latestSourceSnapshot);
      if (
        !latestSourceManifest ||
        accountCloudSyncManifestFingerprint(latestSourceManifest) !== prepared.sourceFingerprint
      ) {
        return "source-changed";
      }

      if (latestCanonicalSnapshot.exists) {
        const latestCanonicalData = latestCanonicalSnapshot.data() ?? {};
        if (
          String(latestCanonicalData.identityMigratedFromUid ?? "").trim() === sourceUid &&
          String(latestCanonicalData.identityMigratedSourceFingerprint ?? "").trim() === prepared.sourceFingerprint
        ) {
          transaction.set(aliasRef, accountCloudMigrationCompleteData(
            prepared.sourceFingerprint,
            prepared.sourceContentFingerprint,
            positiveNumber(latestCanonicalData.identityMigratedAt, now),
            now,
          ), { merge: true });
          return "already-migrated";
        }
        transaction.set(aliasRef, accountCloudMigrationConflictData(sourceUid, canonicalUid, now), { merge: true });
        transaction.set(canonicalUserRef, accountCloudMigrationConflictUserData(sourceUid, now), { merge: true });
        return "conflict";
      }

      transaction.set(canonicalManifestRef, prepared.canonicalManifestData);
      transaction.set(aliasRef, accountCloudMigrationCompleteData(
        prepared.sourceFingerprint,
        prepared.sourceContentFingerprint,
        now,
        now,
      ), { merge: true });
      return "migrated";
    });
  } catch (error) {
    // A transaction acknowledgement can be lost after Firestore has committed.
    // Reconcile against canonical current before deleting the staged generation;
    // otherwise an uncertain response could leave the live manifest pointing at
    // chunks that this catch block just removed.
    const canonicalAfterError = await canonicalManifestRef.get().catch(() => null);
    if (canonicalAfterError && accountCloudMigrationMatchesPreparedCommit(
      canonicalAfterError,
      prepared,
      sourceUid,
    )) {
      outcome = "migrated";
    } else {
      if (
        canonicalAfterError &&
        !accountCloudMigrationReferencesPreparedGeneration(canonicalAfterError, prepared)
      ) {
        await cleanupAccountCloudMigrationChunks(
          db,
          prepared.stagedChunkWrites.map(({ ref }) => ref),
        ).catch(() => undefined);
      }
      throw error;
    }
  }

  if (outcome !== "migrated") {
    await cleanupAccountCloudMigrationChunks(db, prepared.stagedChunkWrites.map(({ ref }) => ref)).catch(() => undefined);
  }
  if (outcome === "source-changed") {
    await aliasRef.set({
      cloudSyncMigrationSourceChanged: true,
      cloudSyncMigrationSourceChangedAt: now,
      cloudSyncCheckedAt: now,
    }, { merge: true });
    throw new Error("The retained account backup changed during migration and was left untouched for a safe retry.");
  }
}

async function prepareAccountCloudMigration(
  sourceRoot: DocumentReference,
  canonicalRoot: DocumentReference,
  sourceManifestSnapshot: DocumentSnapshot,
  sourceManifest: AccountCloudSyncManifest,
  sourceUid: string,
  now: number,
): Promise<PreparedAccountCloudMigration> {
  if (sourceManifest.chunkCount > ACCOUNT_CLOUD_SYNC_MIGRATION_MAX_CHUNKS) {
    throw new Error(
      `The retained account backup has ${sourceManifest.chunkCount} chunks and is too large for safe inline migration.`,
    );
  }

  const sourceChunkSnapshots: DocumentSnapshot[] = [];
  for (let offset = 0; offset < sourceManifest.chunkCount; offset += 16) {
    const indexes = Array.from(
      { length: Math.min(16, sourceManifest.chunkCount - offset) },
      (_, index) => offset + index,
    );
    sourceChunkSnapshots.push(...await Promise.all(indexes.map((index) => (
      sourceRoot.collection("chunks").doc(accountCloudSyncChunkDocumentId(sourceManifest, index)).get()
    ))));
  }

  const payloads: string[] = [];
  const chunkChecksums: string[] = [];
  const checksum = createHash("sha256");
  let byteSize = 0;
  for (let index = 0; index < sourceManifest.chunkCount; index += 1) {
    const snapshot = sourceChunkSnapshots[index];
    const chunk = validateAccountCloudSyncChunk(sourceManifest, index, snapshot?.data() ?? null);
    if (!snapshot?.exists || !chunk) {
      throw new Error(`Retained account backup chunk ${index + 1} is missing or failed validation.`);
    }
    payloads.push(chunk.payload);
    chunkChecksums.push(createHash("sha256").update(chunk.payload, "utf8").digest("hex"));
    checksum.update(chunk.payload, "utf8");
    byteSize += chunk.byteSize;
  }
  const fullChecksum = checksum.digest("hex");
  if (byteSize !== sourceManifest.byteSize) {
    throw new Error("The retained account backup byte size does not match its manifest.");
  }
  if (sourceManifest.version === ACCOUNT_CLOUD_SYNC_VERSION && fullChecksum !== sourceManifest.checksum) {
    throw new Error("The retained account backup checksum does not match its manifest.");
  }
  if (sourceManifest.version !== ACCOUNT_CLOUD_SYNC_VERSION) {
    validateLegacyAccountCloudBackupPayload(payloads.join(""), sourceManifest);
  }

  const sourceFingerprint = accountCloudSyncManifestFingerprint(sourceManifest);
  const sourceContentFingerprint = accountCloudMigrationContentFingerprint(sourceManifest);
  const stagedGenerationId = randomUUID();
  const stagedManifest: AccountCloudSyncManifest = {
    ...sourceManifest,
    version: ACCOUNT_CLOUD_SYNC_VERSION,
    generationId: stagedGenerationId,
    byteSize,
    checksumAlgorithm: "sha256",
    checksum: fullChecksum,
    chunkChecksums,
    updateTime: "",
  };
  const stagedChunkWrites = payloads.map((payload, index) => ({
    ref: canonicalRoot.collection("chunks").doc(accountCloudSyncChunkDocumentId(stagedManifest, index)),
    data: {
      format: ACCOUNT_CLOUD_SYNC_FORMAT,
      version: ACCOUNT_CLOUD_SYNC_VERSION,
      generation_id: stagedGenerationId,
      index,
      payload,
      byte_size: Buffer.byteLength(payload, "utf8"),
      checksum: chunkChecksums[index],
      identityMigratedFromUid: sourceUid,
      identityMigratedAt: now,
    },
  }));

  return {
    sourceFingerprint,
    sourceContentFingerprint,
    stagedGenerationId,
    stagedChunkWrites,
    canonicalManifestData: {
      format: ACCOUNT_CLOUD_SYNC_FORMAT,
      version: ACCOUNT_CLOUD_SYNC_VERSION,
      updated_at: sourceManifest.updatedAt,
      device_id: sourceManifest.deviceId,
      device_name: sourceManifest.deviceName,
      app_version: sourceManifest.appVersion,
      generation_id: stagedGenerationId,
      chunk_count: sourceManifest.chunkCount,
      byte_size: byteSize,
      checksum_algorithm: "sha256",
      checksum: fullChecksum,
      chunk_checksums: chunkChecksums,
      counts: sourceManifest.counts,
      identityMigratedFromUid: sourceUid,
      identityMigratedAt: now,
      identityMigratedSourceFingerprint: sourceFingerprint,
      identityMigratedSourceContentFingerprint: sourceContentFingerprint,
      identityMigratedSourceUpdateTime: sourceManifestSnapshot.updateTime?.toDate().toISOString() ?? "",
    },
  };
}

function accountCloudMigrationMatchesPreparedCommit(
  snapshot: DocumentSnapshot,
  prepared: PreparedAccountCloudMigration,
  sourceUid: string,
): boolean {
  if (!snapshot.exists) return false;
  const data = snapshot.data() ?? {};
  return String(data.generation_id ?? "").trim() === prepared.stagedGenerationId &&
    String(data.identityMigratedFromUid ?? "").trim() === sourceUid &&
    String(data.identityMigratedSourceFingerprint ?? "").trim() === prepared.sourceFingerprint &&
    String(data.identityMigratedSourceContentFingerprint ?? "").trim() === prepared.sourceContentFingerprint;
}

function accountCloudMigrationReferencesPreparedGeneration(
  snapshot: DocumentSnapshot,
  prepared: PreparedAccountCloudMigration,
): boolean {
  return snapshot.exists &&
    String(snapshot.data()?.generation_id ?? "").trim() === prepared.stagedGenerationId;
}

function validateLegacyAccountCloudBackupPayload(
  compressed: string,
  manifest: AccountCloudSyncManifest,
): void {
  let backup: Record<string, unknown>;
  try {
    const json = inflateRawSync(Buffer.from(compressed, "base64")).toString("utf8");
    const decoded = JSON.parse(json) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new Error("Invalid backup document");
    }
    backup = decoded as Record<string, unknown>;
  } catch {
    throw new Error("The retained legacy account backup could not be decoded safely.");
  }

  if (
    backup.format !== "riftlite.backup" ||
    backup.version !== 1 ||
    !backup.settings ||
    typeof backup.settings !== "object" ||
    Array.isArray(backup.settings) ||
    !Array.isArray(backup.matches) ||
    !Array.isArray(backup.deletedMatches) ||
    !Array.isArray(backup.decks) ||
    !Array.isArray(backup.notebooks) ||
    !Array.isArray(backup.replays) ||
    !Array.isArray(backup.deletedReplays)
  ) {
    throw new Error("The retained legacy account backup is not a supported RiftLite backup.");
  }

  const counts = {
    matches: backup.matches.length + backup.deletedMatches.length,
    decks: backup.decks.length,
    notebooks: backup.notebooks.length,
    replays: 0,
  };
  if (
    counts.matches !== manifest.counts.matches ||
    counts.decks !== manifest.counts.decks ||
    counts.notebooks !== manifest.counts.notebooks ||
    counts.replays !== manifest.counts.replays
  ) {
    throw new Error("The retained legacy account backup contents do not match its manifest.");
  }
}

function accountCloudManifestFromSnapshot(snapshot: DocumentSnapshot | null | undefined): AccountCloudSyncManifest | null {
  if (!snapshot?.exists) return null;
  return normalizeAccountCloudSyncManifest(
    snapshot.data() ?? null,
    snapshot.updateTime?.toDate().toISOString() ?? "",
  );
}

function accountCloudMigrationContentFingerprint(manifest: AccountCloudSyncManifest): string {
  return accountCloudSyncManifestFingerprint({ ...manifest, updateTime: "" });
}

function accountCloudMigrationCompleteData(
  sourceFingerprint: string,
  sourceContentFingerprint: string,
  migratedAt: number,
  checkedAt: number,
): Record<string, unknown> {
  return {
    cloudSyncMigratedAt: migratedAt,
    cloudSyncMigratedSourceFingerprint: sourceFingerprint,
    cloudSyncMigratedSourceContentFingerprint: sourceContentFingerprint,
    cloudSyncConflict: FieldValue.delete(),
    cloudSyncMigrationSourceChanged: FieldValue.delete(),
    cloudSyncMigrationSourceChangedAt: FieldValue.delete(),
    cloudSyncCheckedAt: checkedAt,
  };
}

function accountCloudMigrationConflictData(
  sourceUid: string,
  canonicalUid: string,
  now: number,
): Record<string, unknown> {
  return {
    cloudSyncConflict: true,
    cloudSyncSourceUid: sourceUid,
    cloudSyncCanonicalUid: canonicalUid,
    cloudSyncCheckedAt: now,
  };
}

function accountCloudMigrationConflictUserData(sourceUid: string, now: number): Record<string, unknown> {
  return {
    accountCloudSyncLegacySources: FieldValue.arrayUnion(sourceUid),
    accountCloudSyncIdentityUpdatedAt: now,
  };
}

async function markAccountCloudBackupConflict(
  db: Firestore,
  sourceUid: string,
  canonicalUid: string,
  now: number,
): Promise<void> {
  const batch = db.batch();
  batch.set(
    db.collection("identityAliases").doc(sourceUid),
    accountCloudMigrationConflictData(sourceUid, canonicalUid, now),
    { merge: true },
  );
  batch.set(
    db.collection("users").doc(canonicalUid),
    accountCloudMigrationConflictUserData(sourceUid, now),
    { merge: true },
  );
  await batch.commit();
}

async function commitAccountCloudMigrationChunks(
  db: Firestore,
  writes: Array<{ ref: DocumentReference; data: Record<string, unknown> }>,
): Promise<void> {
  for (let offset = 0; offset < writes.length; offset += ACCOUNT_CLOUD_SYNC_MIGRATION_BATCH_SIZE) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + ACCOUNT_CLOUD_SYNC_MIGRATION_BATCH_SIZE)) {
      batch.set(write.ref, write.data);
    }
    await batch.commit();
  }
}

async function cleanupAccountCloudMigrationChunks(db: Firestore, refs: DocumentReference[]): Promise<void> {
  for (let offset = 0; offset < refs.length; offset += ACCOUNT_CLOUD_SYNC_MIGRATION_BATCH_SIZE) {
    const batch = db.batch();
    for (const ref of refs.slice(offset, offset + ACCOUNT_CLOUD_SYNC_MIGRATION_BATCH_SIZE)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

async function commitMigrationUpdates(updates: Array<{ ref: DocumentReference; data: Record<string, unknown> }>): Promise<void> {
  const db = getFirestoreAdmin();
  if (!db) return;
  for (let offset = 0; offset < updates.length; offset += 400) {
    const batch = db.batch();
    for (const update of updates.slice(offset, offset + 400)) {
      const data = Object.fromEntries(Object.entries(update.data).filter(([, value]) => value !== undefined));
      batch.set(update.ref, data, { merge: true });
    }
    await batch.commit();
  }
}

function strongerRole(left: string, right: string): "owner" | "admin" | "member" {
  const rank: Record<string, number> = { member: 1, admin: 2, owner: 3 };
  const selected = (rank[left] ?? 0) >= (rank[right] ?? 0) ? left : right;
  return selected === "owner" || selected === "admin" ? selected : "member";
}

function positiveNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
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

function firstProfileBoolean(source: Record<string, unknown>, ...keys: string[]): boolean {
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

function firstProfileStringArray(source: Record<string, unknown>, ...keys: string[]): string[] {
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
    manualRepair: firstProfileBoolean(raw, "manual_repair", "manualRepair"),
    combinedFromMatchIds: firstProfileStringArray(raw, "combined_from_match_ids", "combinedFromMatchIds"),
    mergedIntoMatchId: firstProfileString(raw, "merged_into_match_id", "mergedIntoMatchId"),
    superseded: firstProfileBoolean(raw, "superseded"),
    supersededAt: firstProfileString(raw, "superseded_at", "supersededAt"),
  };
}

export function repairCachedProfileMatch(match: CommunityMatch): CommunityMatch {
  return normalizeProfileMatch(match.id, match as unknown as Record<string, unknown>);
}

function repairCachedProfileMatches(matches: CommunityMatch[]): CommunityMatch[] {
  return matches
    .map((match) => repairCachedProfileMatch(match))
    .filter((match) => !match.superseded);
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
  const shouldRemove = Boolean(match.superseded || match.mergedIntoMatchId);
  const matches = (shouldRemove
    ? existing.filter((item) => item.id !== match.id)
    : [match, ...existing.filter((item) => item.id !== match.id)])
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
    .filter((match) => match.uid === profile.uid && !match.superseded)
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
    const documents = collectionId === "members" && field === "uid"
      ? [
          ...await findMembershipDocuments(db, [value], "hubs"),
          ...await findMembershipDocuments(db, [value], "teams"),
        ].slice(0, 150)
      : await findNestedDocumentsByField(db, collectionId, field, value, ["hubs", "teams"], 150).catch(() => []);
    for (const doc of documents) {
      queueSet(doc.ref, data);
    }
  };

  await updateCollectionGroup("members", "uid", profile.uid, { displayName, handle, updatedAt: now });
  await updateCollectionGroup("messages", "uid", profile.uid, { displayName, handle, updatedAt: now });
  await updateCollectionGroup("matches", "uid", profile.uid, {
    username: displayName,
    owner_display_name: displayName,
    owner_handle: handle,
    updatedAt: now,
  });
  await updateCollectionGroup("inbox", "senderUid", profile.uid, { senderDisplayName: displayName, senderHandle: handle, updatedAt: now });

  const inviteSnap = await db.collection("hubInvites").where("senderUid", "==", profile.uid).limit(150).get().catch(() => null);
  for (const doc of inviteSnap?.docs ?? []) {
    queueSet(doc.ref, { senderDisplayName: displayName, senderHandle: handle, updatedAt: now });
  }
  const discordSnap = await db.collection("discordLinks").where("uid", "==", profile.uid).limit(150).get().catch(() => null);
  for (const doc of discordSnap?.docs ?? []) {
    queueSet(doc.ref, { displayName, handle, updatedAt: now });
  }

  if (writes) {
    await batch.commit();
  }
}

export async function resolveHubRole(hubId: string, uid: string): Promise<HubMemberRole | ""> {
  const db = getFirestoreAdmin();
  if (!db) throw new Error("Firebase admin is not configured");
  const hubRef = db.collection("hubs").doc(hubId);
  const identityUids = await identityUidsFor(uid);
  const memberRefs = identityUids.map((identityUid) => hubRef.collection("members").doc(identityUid));
  const members = memberRefs.length ? await db.getAll(...memberRefs) : [];
  const memberRole = members.reduce(
    (selected, member) => {
      const candidate = member.exists ? String(member.data()?.role ?? "") : "";
      if (!candidate || !["owner", "admin", "member"].includes(candidate)) return selected;
      return selected ? strongerRole(selected, candidate) : candidate;
    },
    "",
  );
  const hubSnap = await hubRef.get();
  const hub = hubSnap.data() ?? {};
  const ownerUid = String(hub.owner_uid ?? hub.ownerUid ?? "");
  const createdBy = String(hub.created_by ?? hub.createdBy ?? "");
  if (identityUids.some((identityUid) => ownerUid === identityUid || createdBy === identityUid)) {
    return "owner";
  }
  return memberRole ? normalizeHubMemberRole(memberRole) : "";
}

export async function assertHubRole(hubId: string, uid: string, roles: string[]) {
  const role = await resolveHubRole(hubId, uid);
  if (!role || !roles.includes(role)) {
    throw new Error("You do not have permission for this hub action.");
  }
  return role;
}

export async function assertHubCapability(hubId: string, uid: string, capability: HubCapability): Promise<HubMemberRole> {
  const role = await resolveHubRole(hubId, uid);
  if (!role || !hubRoleHasCapability(role, capability)) {
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
