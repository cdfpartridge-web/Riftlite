import "server-only";

import { createPublicKey, randomBytes, verify } from "node:crypto";

import { type Firestore } from "firebase-admin/firestore";
import { type NextRequest, NextResponse } from "next/server";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import {
  discordDeckLegendFromSnapshot,
  discordDeckLinkForLegend,
  formatDiscordDeckLink,
  formatDiscordDeckTitle,
} from "@/lib/discord/replay-share";
import { type DiscordVerifiedMember } from "@/lib/discord/verified-members";
import { assertHubCapability, bestProfileDisplayName, cleanDisplayName, identityUidsFor, normalizeAccountProfile } from "@/lib/social/server";

const DISCORD_API = "https://discord.com/api/v10";
const VERIFY_TTL_MS = 15 * 60 * 1000;
const HUB_MATCH_READ_LIMIT = 1000;

export type DiscordGuildConfig = {
  guildId: string;
  hubId: string;
  verifiedRoleId: string;
  feedChannelId: string;
  reportsChannelId: string;
  updatedAt: number;
  updatedByDiscordUserId: string;
  updatedByUid: string;
};

export type DiscordHubMatch = {
  id: string;
  uid: string;
  player: string;
  opponent: string;
  myLegend: string;
  oppLegend: string;
  format: string;
  result: string;
  score: string;
  deckName: string;
  deckUrl: string;
  createdAt: number;
  superseded: boolean;
};

export type DiscordHubStats = {
  hubId: string;
  rangeDays: number;
  matches: DiscordHubMatch[];
  matchCount: number;
  bo3Count: number;
  activePlayers: number;
  leaderboard: Array<{
    uid: string;
    player: string;
    matches: number;
    bo3s: number;
    uniqueMatchups: number;
  }>;
  topMatchups: Array<{ matchup: string; count: number }>;
  underTestedMatchups: Array<{ matchup: string; count: number }>;
  deckResults: Array<{ deckName: string; deckUrl: string; matches: number; wins: number; winRate: number }>;
};

export function discordJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export function getDiscordApplicationId() {
  return process.env.DISCORD_APPLICATION_ID?.trim() || process.env.DISCORD_CLIENT_ID?.trim() || "";
}

export function getDiscordBotToken() {
  return process.env.DISCORD_COMMUNITY_BOT_TOKEN?.trim() || process.env.DISCORD_BOT_TOKEN?.trim() || "";
}

export function getDiscordPublicKey() {
  return process.env.DISCORD_PUBLIC_KEY?.trim() || "";
}

export function verifyDiscordSignature(body: string, timestamp: string, signature: string) {
  const publicKeyHex = getDiscordPublicKey();
  if (!publicKeyHex || !timestamp || !signature) return false;
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(`302a300506032b6570032100${publicKeyHex}`, "hex"),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(`${timestamp}${body}`),
      publicKey,
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

export function requireBotRequest(req: NextRequest) {
  const expected = process.env.RIFTLITE_BOT_API_TOKEN?.trim() ?? "";
  const supplied = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1]?.trim() ?? "";
  if (!expected) {
    return { error: discordJson({ error: "RIFTLITE_BOT_API_TOKEN is not configured." }, 503) };
  }
  if (!supplied || supplied !== expected) {
    return { error: discordJson({ error: "Bot token required." }, 401) };
  }
  const db = getFirestoreAdmin();
  if (!db) {
    return { error: discordJson({ error: "Firebase admin is not configured." }, 503) };
  }
  return { db };
}

export function makeVerifyCode() {
  return randomBytes(12).toString("base64url");
}

export async function createDiscordVerificationSession(input: {
  guildId: string;
  channelId: string;
  discordUserId: string;
  discordUsername: string;
  origin: string;
}) {
  const db = requireDb();
  const code = makeVerifyCode();
  const now = Date.now();
  await db.collection("discordVerificationSessions").doc(code).set({
    code,
    guildId: input.guildId,
    channelId: input.channelId,
    discordUserId: input.discordUserId,
    discordUsername: input.discordUsername,
    status: "pending",
    createdAt: now,
    expiresAt: now + VERIFY_TTL_MS,
  });
  return {
    code,
    url: `${input.origin}/discord/verify?code=${encodeURIComponent(code)}`,
    expiresAt: now + VERIFY_TTL_MS,
  };
}

export async function completeDiscordVerification(code: string, uid: string, profile: { handle?: string; displayName?: string }) {
  const db = requireDb();
  const ref = db.collection("discordVerificationSessions").doc(code);
  const now = Date.now();
  const handle = String(profile.handle ?? "");
  const displayName = bestProfileDisplayName(uid, profile.displayName, handle);
  // Redeeming this code establishes an account-recovery identity, so the
  // one-time state and every resulting identity write must commit atomically.
  // A same-account retry is idempotent (for example after a lost response),
  // while a concurrent different-account redemption fails after Firestore
  // retries the transaction against the completed session.
  const completed = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new Error("Discord verification link was not found.");
    const data = snap.data() ?? {};
    const status = String(data.status ?? "");
    const completedUid = String(data.uid ?? "").trim();
    if (status === "complete") {
      if (completedUid !== uid) throw new Error("Discord verification link has already been used.");
    } else if (status !== "pending") {
      throw new Error("Discord verification link has already been used.");
    }
    if (status === "pending" && Number(data.expiresAt ?? 0) < now) {
      throw new Error("Discord verification link has expired.");
    }

    const guildId = String(data.guildId ?? "");
    const discordUserId = String(data.discordUserId ?? "");
    if (!guildId || !discordUserId) throw new Error("Discord verification link is missing guild/user data.");

    const linkRef = db.collection("discordLinks").doc(discordLinkId(guildId, discordUserId));
    const existingLink = status === "complete"
      ? (await transaction.get(linkRef)).data() ?? {}
      : {};
    const link = status === "complete" && String(existingLink.uid ?? "").trim() === uid
      ? existingLink
      : {
      uid,
      guildId,
      discordUserId,
      discordUsername: String(data.discordUsername ?? ""),
      handle,
      displayName,
      linkedAt: Number(data.completedAt ?? now) || now,
      updatedAt: now,
    };
    if (status === "pending") {
      transaction.set(linkRef, link, { merge: true });
      transaction.set(db.collection("users").doc(uid), {
        discordLinked: true,
        discordLinkedAt: now,
        discordLastGuildId: guildId,
        discordLastUserId: discordUserId,
      }, { merge: true });
      transaction.set(ref, { status: "complete", uid, completedAt: now }, { merge: true });
    }
    return { guildId, discordUserId, link };
  });

  const config = await getDiscordGuildConfig(completed.guildId);
  let roleAssigned = false;
  if (config?.verifiedRoleId) {
    roleAssigned = await assignDiscordRole(completed.guildId, completed.discordUserId, config.verifiedRoleId).then(() => true).catch(() => false);
  }
  return { link: completed.link, roleAssigned, configuredRole: Boolean(config?.verifiedRoleId) };
}

export async function getLinkedRiftLiteUid(guildId: string, discordUserId: string) {
  const snap = await requireDb().collection("discordLinks").doc(discordLinkId(guildId, discordUserId)).get();
  return String(snap.data()?.uid ?? "");
}

export async function listDiscordVerifiedMembers(guildId: string): Promise<DiscordVerifiedMember[]> {
  if (!guildId) return [];
  const db = requireDb();
  const links = await db.collection("discordLinks").where("guildId", "==", guildId).limit(200).get();
  if (links.empty) return [];
  const sourceUids = Array.from(new Set(links.docs.map((doc) => String(doc.data().uid ?? "").trim()).filter(Boolean)));
  const sourceSnaps = sourceUids.length
    ? await db.getAll(...sourceUids.map((uid) => db.collection("users").doc(uid)))
    : [];
  const sourceUsers = new Map(sourceSnaps.filter((snap) => snap.exists).map((snap) => [snap.id, snap.data() ?? {}]));
  const canonicalUids = Array.from(new Set(sourceUids.map((uid) => String(sourceUsers.get(uid)?.canonicalUid ?? uid).trim()).filter(Boolean)));
  const canonicalSnaps = canonicalUids.length
    ? await db.getAll(...canonicalUids.map((uid) => db.collection("users").doc(uid)))
    : [];
  const canonicalUsers = new Map(canonicalSnaps.filter((snap) => snap.exists).map((snap) => [snap.id, snap.data() ?? {}]));

  return links.docs.map((doc) => {
    const link = doc.data();
    const sourceUid = String(link.uid ?? "").trim();
    const canonicalUid = String(sourceUsers.get(sourceUid)?.canonicalUid ?? sourceUid).trim();
    const profileData = canonicalUsers.get(canonicalUid) ?? sourceUsers.get(sourceUid) ?? {};
    const profile = normalizeAccountProfile(canonicalUid || sourceUid, profileData);
    return {
      discordUserId: String(link.discordUserId ?? "").trim(),
      discordUsername: String(link.discordUsername ?? "").trim(),
      displayName: bestProfileDisplayName(
        canonicalUid || sourceUid,
        profile.displayName,
        profile.handle,
        link.displayName,
        link.handle,
      ),
      handle: profile.handle || String(link.handle ?? "").trim(),
      linkedAt: Number(link.linkedAt ?? link.updatedAt ?? 0),
    };
  });
}

export async function getDiscordGuildConfig(guildId: string): Promise<DiscordGuildConfig | null> {
  if (!guildId) return null;
  const snap = await requireDb().collection("discordGuildConfigs").doc(guildId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const hubId = String(data.hubId ?? "");
  if (!hubId) return null;
  return {
    guildId,
    hubId,
    verifiedRoleId: String(data.verifiedRoleId ?? ""),
    feedChannelId: String(data.feedChannelId ?? ""),
    reportsChannelId: String(data.reportsChannelId ?? ""),
    updatedAt: Number(data.updatedAt ?? 0),
    updatedByDiscordUserId: String(data.updatedByDiscordUserId ?? ""),
    updatedByUid: String(data.updatedByUid ?? ""),
  };
}

export async function getDiscordGuildIdForHub(hubId: string) {
  if (!hubId) return "";
  const snap = await requireDb()
    .collection("discordGuildConfigs")
    .where("hubId", "==", hubId)
    .limit(1)
    .get();
  return snap.docs[0]?.id ?? "";
}

export async function getDiscordGuildConfigsForHub(hubId: string): Promise<DiscordGuildConfig[]> {
  if (!hubId) return [];
  const snapshot = await requireDb().collection("discordGuildConfigs").where("hubId", "==", hubId).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      guildId: doc.id,
      hubId,
      verifiedRoleId: String(data.verifiedRoleId ?? ""),
      feedChannelId: String(data.feedChannelId ?? ""),
      reportsChannelId: String(data.reportsChannelId ?? ""),
      updatedAt: Number(data.updatedAt ?? 0),
      updatedByDiscordUserId: String(data.updatedByDiscordUserId ?? ""),
      updatedByUid: String(data.updatedByUid ?? ""),
    };
  });
}

export async function saveDiscordGuildConfig(input: Omit<DiscordGuildConfig, "updatedAt">) {
  const now = Date.now();
  const db = requireDb();
  const hubRef = db.collection("hubs").doc(input.hubId);
  await db.runTransaction(async (tx) => {
    const hubSnap = await tx.get(hubRef);
    if (!hubSnap.exists || String(hubSnap.data()?.lifecycle_state ?? "") === "deleting") {
      throw new Error("This private hub is being deleted.");
    }
    tx.set(db.collection("discordGuildConfigs").doc(input.guildId), {
      ...input,
      updatedAt: now,
    }, { merge: true });
  });
  return { ...input, updatedAt: now };
}

export async function assertDiscordSetupAllowed(input: {
  guildId: string;
  discordUserId: string;
  hubId: string;
  memberPermissions: string;
}) {
  if (!hasManageGuild(input.memberPermissions)) {
    throw new Error("Discord Manage Server permission is required for setup.");
  }
  const uid = await getLinkedRiftLiteUid(input.guildId, input.discordUserId);
  if (!uid) throw new Error("Run /verify first, then try again.");
  const identityUids = await identityUidsFor(uid);
  let authorizedUid = "";
  for (const candidateUid of identityUids) {
    const allowed = await assertHubCapability(input.hubId, candidateUid, "manage_discord")
      .then(() => true)
      .catch(() => false);
    if (allowed) {
      authorizedUid = candidateUid;
      break;
    }
  }
  if (!authorizedUid) throw new Error("Your verified RiftLite account is not an owner or admin of this hub.");
  return uid;
}

export async function assignDiscordRole(guildId: string, discordUserId: string, roleId: string) {
  if (!guildId || !discordUserId || !roleId) throw new Error("Guild, user, and role are required.");
  await discordApi(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, { method: "PUT" });
}

export async function postDiscordChannelMessage(
  channelId: string,
  content: string,
  options: { nonce?: string } = {},
) {
  if (!channelId || !content) return;
  return discordApi(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] },
      ...(options.nonce ? { nonce: options.nonce.slice(0, 25), enforce_nonce: true } : {}),
    }),
  });
}

export async function loadHubMatches(hubId: string, limit = HUB_MATCH_READ_LIMIT): Promise<DiscordHubMatch[]> {
  const db = requireDb();
  const hubRef = db.collection("hubs").doc(hubId);
  const ordered = await hubRef.collection("matches").orderBy("created_at", "desc").limit(limit).get().catch(() => null);
  const camelOrdered = ordered ?? await hubRef.collection("matches").orderBy("createdAt", "desc").limit(limit).get().catch(() => null);
  const snap = camelOrdered ?? await hubRef.collection("matches").limit(Math.min(limit, 500)).get();
  const matches = snap.docs.map((doc) => normalizeHubMatch(doc.id, doc.data() as Record<string, unknown>));
  const uids = Array.from(new Set(matches.map((match) => match.uid).filter(Boolean)));
  const userSnaps = uids.length ? await db.getAll(...uids.map((uid) => db.collection("users").doc(uid))) : [];
  const profiles = new Map(userSnaps.filter((item) => item.exists).map((item) => [item.id, normalizeAccountProfile(item.id, item.data() ?? {})]));
  return matches
    .map((match) => {
      const profile = profiles.get(match.uid);
      return profile ? { ...match, player: bestProfileDisplayName(match.uid, profile.displayName, profile.handle, match.player) } : match;
    })
    .filter((match) => !match.superseded)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function buildHubStats(hubId: string, matches: DiscordHubMatch[], rangeDays = 7): DiscordHubStats {
  const since = Date.now() - Math.max(1, rangeDays) * 24 * 60 * 60 * 1000;
  const scoped = matches.filter((match) => !match.createdAt || match.createdAt >= since);
  const byUser = new Map<string, { uid: string; player: string; matches: number; bo3s: number; unique: Set<string> }>();
  const matchups = new Map<string, number>();
  const decks = new Map<string, { deckName: string; deckUrl: string; matches: number; wins: number }>();

  for (const match of scoped) {
    const uid = match.uid || match.player;
    const player = match.player || "RiftLite player";
    const row = byUser.get(uid) ?? { uid, player, matches: 0, bo3s: 0, unique: new Set<string>() };
    row.matches += 1;
    if (isBo3(match.format)) row.bo3s += 1;
    const matchup = matchupLabel(match);
    if (matchup) {
      row.unique.add(matchup);
      matchups.set(matchup, (matchups.get(matchup) ?? 0) + 1);
    }
    byUser.set(uid, row);

    if (match.deckName) {
      const deckKey = match.deckUrl || `name:${match.deckName}`;
      const deck = decks.get(deckKey) ?? { deckName: match.deckName, deckUrl: match.deckUrl, matches: 0, wins: 0 };
      deck.matches += 1;
      if (match.result === "Win") deck.wins += 1;
      decks.set(deckKey, deck);
    }
  }

  const leaderboard = Array.from(byUser.values())
    .map((row) => ({
      uid: row.uid,
      player: row.player,
      matches: row.matches,
      bo3s: row.bo3s,
      uniqueMatchups: row.unique.size,
    }))
    .sort((a, b) => b.matches - a.matches || b.bo3s - a.bo3s || b.uniqueMatchups - a.uniqueMatchups)
    .slice(0, 10);

  const topMatchups = Array.from(matchups.entries())
    .map(([matchup, count]) => ({ matchup, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const underTestedMatchups = Array.from(matchups.entries())
    .filter(([, count]) => count <= 2)
    .map(([matchup, count]) => ({ matchup, count }))
    .sort((a, b) => a.count - b.count || a.matchup.localeCompare(b.matchup))
    .slice(0, 10);

  const deckResults = Array.from(decks.values())
    .filter((deck) => deck.matches >= 2)
    .map((deck) => ({
      ...deck,
      winRate: deck.matches ? Number(((deck.wins / deck.matches) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.matches - a.matches || b.winRate - a.winRate)
    .slice(0, 8);

  return {
    hubId,
    rangeDays,
    matches: scoped,
    matchCount: scoped.length,
    bo3Count: scoped.filter((match) => isBo3(match.format)).length,
    activePlayers: byUser.size,
    leaderboard,
    topMatchups,
    underTestedMatchups,
    deckResults,
  };
}

export function formatRecentMatches(matches: DiscordHubMatch[], count = 5) {
  const recent = matches.slice(0, Math.max(1, Math.min(10, count)));
  if (!recent.length) return "No hub matches found yet.";
  return recent.map((match) => {
    const result = match.score ? `${match.score}` : match.result || "Result pending";
    const legends = match.myLegend && match.oppLegend ? `${match.myLegend} vs ${match.oppLegend}` : "Legends pending";
    const activeDeck = match.deckUrl
      ? ` | Active deck: ${formatDiscordDeckLink({ title: match.deckName, url: match.deckUrl })}`
      : "";
    return `• ${match.player} ${result} vs ${match.opponent || "Opponent"} | ${legends} | ${match.format || "Bo1"}${activeDeck}`;
  }).join("\n");
}

export function formatLeaderboard(stats: DiscordHubStats) {
  if (!stats.leaderboard.length) return `No matches logged in the last ${stats.rangeDays} days.`;
  return [
    `**RiftLite testing leaderboard (${stats.rangeDays}d)**`,
    ...stats.leaderboard.map((row, index) =>
      `${index + 1}. ${row.player}: ${row.matches} matches, ${row.bo3s} Bo3s, ${row.uniqueMatchups} unique matchups`,
    ),
  ].join("\n");
}

export function formatWeeklyReport(stats: DiscordHubStats) {
  const lines = [
    `**RiftLite weekly testing report**`,
    `${stats.matchCount} matches logged, ${stats.bo3Count} Bo3s, ${stats.activePlayers} active players.`,
  ];
  if (stats.topMatchups.length) {
    lines.push("", "**Top matchups**", ...stats.topMatchups.slice(0, 5).map((item) => `• ${item.matchup}: ${item.count}`));
  }
  if (stats.underTestedMatchups.length) {
    lines.push("", "**Under-tested matchups**", ...stats.underTestedMatchups.slice(0, 5).map((item) => `• ${item.matchup}: ${item.count}`));
  }
  if (stats.deckResults.length) {
    lines.push("", "**Most logged decks**", ...stats.deckResults.slice(0, 5).map((deck) => {
      const label = deck.deckUrl
        ? formatDiscordDeckLink({ title: deck.deckName, url: deck.deckUrl })
        : formatDiscordDeckTitle(deck.deckName);
      return `• ${label}: ${deck.matches} matches, ${deck.winRate}% WR`;
    }));
  }
  return lines.join("\n");
}

export async function listTestingGoals(guildId: string) {
  const snap = await requireDb()
    .collection("discordGuildConfigs")
    .doc(guildId)
    .collection("testingGoals")
    .where("status", "==", "active")
    .limit(20)
    .get();
  return snap.docs
    .map((doc) => ({ id: doc.id, text: String(doc.data().text ?? ""), createdAt: Number(doc.data().createdAt ?? 0) }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function addTestingGoal(guildId: string, text: string, createdBy: string, hubIdInput = "") {
  const clean = text.trim().slice(0, 240);
  if (!clean) throw new Error("Goal text is required.");
  const db = requireDb();
  const configRef = db.collection("discordGuildConfigs").doc(guildId);
  const ref = configRef.collection("testingGoals").doc();
  await db.runTransaction(async (tx) => {
    const configSnap = await tx.get(configRef);
    const hubId = hubIdInput.trim() || String(configSnap.data()?.hubId ?? "").trim();
    if (!hubId) throw new Error("This Discord server is not connected to a RiftLite hub.");
    const hubSnap = await tx.get(db.collection("hubs").doc(hubId));
    if (!hubSnap.exists || String(hubSnap.data()?.lifecycle_state ?? "") === "deleting") {
      throw new Error("This private hub is being deleted.");
    }
    tx.set(ref, {
      id: ref.id,
      text: clean,
      status: "active",
      createdBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  return { id: ref.id, text: clean };
}

export async function completeTestingGoal(guildId: string, goalId: string, completedBy: string, hubIdInput = "") {
  const clean = goalId.trim();
  if (!clean) throw new Error("Goal id is required.");
  const db = requireDb();
  const configRef = db.collection("discordGuildConfigs").doc(guildId);
  await db.runTransaction(async (tx) => {
    const configSnap = await tx.get(configRef);
    const hubId = hubIdInput.trim() || String(configSnap.data()?.hubId ?? "").trim();
    if (!hubId) throw new Error("This Discord server is not connected to a RiftLite hub.");
    const hubSnap = await tx.get(db.collection("hubs").doc(hubId));
    if (!hubSnap.exists || String(hubSnap.data()?.lifecycle_state ?? "") === "deleting") {
      throw new Error("This private hub is being deleted.");
    }
    tx.set(configRef.collection("testingGoals").doc(clean), {
      status: "done",
      completedBy,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    }, { merge: true });
  });
}

export function formatTestingGoals(goals: Array<{ id: string; text: string }>) {
  if (!goals.length) return "No active testing goals yet. Add one with `/testing-goals add`.";
  return [
    "**Current RiftLite testing goals**",
    ...goals.map((goal, index) => `${index + 1}. ${goal.text} \`${goal.id.slice(0, 6)}\``),
  ].join("\n");
}

export function discordLinkId(guildId: string, discordUserId: string) {
  return `${guildId}_${discordUserId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function hasManageGuild(permissions: string) {
  try {
    const value = BigInt(permissions || "0");
    const administrator = 0x8n;
    const manageGuild = 0x20n;
    return (value & administrator) === administrator || (value & manageGuild) === manageGuild;
  } catch {
    return false;
  }
}

function requireDb(): Firestore {
  const db = getFirestoreAdmin();
  if (!db) throw new Error("Firebase admin is not configured.");
  return db;
}

async function discordApi(path: string, init: RequestInit = {}) {
  const token = getDiscordBotToken();
  if (!token) throw new Error("DISCORD_COMMUNITY_BOT_TOKEN is not configured.");
  const initHeaders = init.headers && !(init.headers instanceof Headers)
    ? init.headers as Record<string, string>
    : {};
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bot ${token}`,
      "Content-Type": "application/json",
      ...initHeaders,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord API ${response.status}: ${text || response.statusText}`);
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null) as Promise<unknown>;
}

function normalizeHubMatch(id: string, raw: Record<string, unknown>): DiscordHubMatch {
  const uid = String(raw.uid ?? raw.owner_uid ?? raw.ownerUid ?? "");
  const player = bestProfileDisplayName(uid, raw.username, raw.displayName, raw.ownerDisplayName, raw.handle);
  const createdAt = normalizeCreatedAt(raw);
  const myLegend = String(raw.my_champion ?? raw.myChampion ?? raw.myLegend ?? "").trim();
  const deckLink = discordDeckLinkForLegend(myLegend, {
    title: String(raw.my_deck_name ?? raw.deckName ?? raw.myDeckName ?? "").trim(),
    legend: discordDeckLegendFromSnapshot(raw.my_deck_snapshot_json ?? raw.deckSnapshotJson ?? raw.myDeckSnapshotJson),
    sourceUrl: String(raw.my_deck_source_url ?? raw.deckSourceUrl ?? raw.myDeckSourceUrl ?? "").trim(),
  });
  return {
    id,
    uid,
    player,
    opponent: cleanDisplayName(raw.opp_name ?? raw.oppName ?? raw.opponent ?? "", "Opponent"),
    myLegend,
    oppLegend: String(raw.opp_champion ?? raw.oppChampion ?? raw.oppLegend ?? "").trim(),
    format: String(raw.fmt ?? raw.format ?? "Bo1").trim() || "Bo1",
    result: String(raw.result ?? "").trim(),
    score: String(raw.score ?? "").trim(),
    deckName: deckLink?.title ?? String(raw.my_deck_name ?? raw.deckName ?? raw.myDeckName ?? "").trim(),
    deckUrl: deckLink?.url ?? "",
    createdAt,
    superseded: isSuperseded(raw),
  };
}

function normalizeCreatedAt(raw: Record<string, unknown>) {
  const numeric = Number(raw.created_at ?? raw.createdAt ?? raw.timestamp ?? 0);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const date = Date.parse(String(raw.date ?? ""));
  return Number.isFinite(date) ? date : 0;
}

function isSuperseded(raw: Record<string, unknown>) {
  return raw.superseded === true || Boolean(raw.merged_into_match_id || raw.mergedIntoMatchId);
}

function isBo3(format: string) {
  return format.toLowerCase().includes("bo3") || format.toLowerCase().includes("best of 3");
}

function matchupLabel(match: DiscordHubMatch) {
  if (!match.myLegend && !match.oppLegend) return "";
  return `${match.myLegend || "Unknown"} vs ${match.oppLegend || "Unknown"}`;
}
