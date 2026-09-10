import "server-only";

import { createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";

import { type Firestore } from "firebase-admin/firestore";
import { type NextRequest, NextResponse } from "next/server";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { DiscordCommandError } from "@/lib/discord/command-error";
import { validateDiscordSetupDestinations, validateDiscordVerificationRole } from "@/lib/discord/destinations";
import {
  discordDeckLegendFromSnapshot,
  discordDeckLinkForLegend,
  formatDiscordDeckLink,
  formatDiscordDeckTitle,
} from "@/lib/discord/replay-share";
import { type DiscordVerifiedMember } from "@/lib/discord/verified-members";
import { assertHubCapability, bestProfileDisplayName, cleanDisplayName, normalizeAccountProfile } from "@/lib/social/server";

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
  return process.env.DISCORD_APPLICATION_ID?.trim() || "";
}

export function getDiscordBotToken() {
  return process.env.DISCORD_COMMUNITY_BOT_TOKEN?.trim() || "";
}

export function getDiscordPublicKey() {
  return process.env.DISCORD_PUBLIC_KEY?.trim() || "";
}

export function verifyDiscordSignature(body: string, timestamp: string, signature: string) {
  const publicKeyHex = getDiscordPublicKey();
  if (!/^[a-f\d]{64}$/i.test(publicKeyHex) || !/^\d{10,11}$/.test(timestamp) || !/^[a-f\d]{128}$/i.test(signature)) return false;
  // Discord signs the timestamp too. Reject captured old requests, including
  // administrative commands whose server permissions may since have changed.
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > 5 * 60 * 1000) return false;
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
  if (!supplied || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
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
  // A same-account retry is idempotent while its guild link is still current
  // (for example after a lost response),
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
    if (status === "complete" && String(existingLink.uid ?? "").trim() !== uid) {
      throw new Error("This Discord verification link is no longer current. Run /verify in this Discord server again.");
    }
    const link = status === "complete"
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
  const roleRequiresHubMembership = Boolean(config?.verifiedRoleId)
    && !await assertDiscordHubCapability(config!.hubId, uid, "view").then(() => true).catch(() => false);
  if (config?.verifiedRoleId && !roleRequiresHubMembership) {
    roleAssigned = await assignDiscordRole(completed.guildId, completed.discordUserId, config.verifiedRoleId).then(() => true).catch(() => false);
  }
  return { link: completed.link, roleAssigned, configuredRole: Boolean(config?.verifiedRoleId), roleRequiresHubMembership };
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
  const db = requireDb();
  const snap = await db.collection("discordGuildConfigs").doc(guildId).get();
  if (!snap.exists) return null;
  const config = normalizeGuildConfig(guildId, snap.data() ?? {});
  if (!config.hubId || !config.updatedByUid) return null;
  const mappings = await db.collection("discordGuildConfigs").where("hubId", "==", config.hubId).limit(2).get();
  if (mappings.docs.length !== 1 || mappings.docs[0]?.id !== guildId) return null;
  return await guildConfigIsActive(config) ? config : null;
}

function normalizeGuildConfig(guildId: string, data: Record<string, unknown>): DiscordGuildConfig {
  return {
    guildId,
    hubId: String(data.hubId ?? "").trim(),
    verifiedRoleId: String(data.verifiedRoleId ?? ""),
    feedChannelId: String(data.feedChannelId ?? ""),
    reportsChannelId: String(data.reportsChannelId ?? ""),
    updatedAt: Number(data.updatedAt ?? 0),
    updatedByDiscordUserId: String(data.updatedByDiscordUserId ?? ""),
    updatedByUid: String(data.updatedByUid ?? ""),
  };
}

export async function getDiscordGuildIdForHub(hubId: string) {
  return (await getDiscordGuildConfigsForHub(hubId))[0]?.guildId ?? "";
}

export async function getDiscordGuildConfigsForHub(hubId: string): Promise<DiscordGuildConfig[]> {
  if (!hubId) return [];
  const snapshot = await requireDb().collection("discordGuildConfigs").where("hubId", "==", hubId).limit(2).get();
  // Legacy duplicate bindings must never fan private results out to servers.
  if (snapshot.docs.length !== 1) return [];
  const config = normalizeGuildConfig(snapshot.docs[0].id, snapshot.docs[0].data());
  return await guildConfigIsActive(config) ? [config] : [];
}

async function guildConfigIsActive(config: DiscordGuildConfig): Promise<boolean> {
  if (!config.hubId || !config.updatedByUid) return false;
  const hub = await requireDb().collection("hubs").doc(config.hubId).get();
  if (!hub.exists || hub.data()?.lifecycle_state === "deleting") return false;
  // Match the canonical field used by Firestore membership rules exactly.
  if (hub.data()?.role_mode !== "account") return false;
  const boundGuild = String(hub.data()?.discordGuildId ?? "").trim();
  if (boundGuild && boundGuild !== config.guildId) return false;
  // Removing or demoting the account which connected this server revokes the
  // integration immediately, including automatic replay delivery.
  return assertHubCapability(config.hubId, config.updatedByUid, "manage_discord")
    .then(() => true).catch(() => false);
}

export async function saveDiscordGuildConfig(input: Omit<DiscordGuildConfig, "updatedAt">) {
  if (!input.guildId || !input.hubId || input.hubId.includes("/")) {
    throw new DiscordCommandError("A valid Discord server and private hub id are required.");
  }
  await assertDiscordHubCapability(input.hubId, input.updatedByUid, "manage_discord");
  await validateDiscordSetupDestinations(input);
  const now = Date.now();
  const db = requireDb();
  const hubRef = db.collection("hubs").doc(input.hubId);
  const configRef = db.collection("discordGuildConfigs").doc(input.guildId);
  await db.runTransaction(async (tx) => {
    const [hubSnap, currentConfig, existingBindings] = await Promise.all([
      tx.get(hubRef),
      tx.get(configRef),
      tx.get(db.collection("discordGuildConfigs").where("hubId", "==", input.hubId)),
    ]);
    if (!hubSnap.exists || String(hubSnap.data()?.lifecycle_state ?? "") === "deleting") {
      throw new DiscordCommandError("This private hub is unavailable.");
    }
    if (hubSnap.data()?.role_mode !== "account") {
      throw new DiscordCommandError("Claim this legacy hub in RiftLite first so access is controlled by account membership, then run /setup again.");
    }
    if (existingBindings.docs.some((doc) => doc.id !== input.guildId)
      || (hubSnap.data()?.discordGuildId && hubSnap.data()?.discordGuildId !== input.guildId)) {
      throw new DiscordCommandError("This private hub is already connected to another Discord server. Use a separate hub for this server.");
    }
    const oldHubId = String(currentConfig.data()?.hubId ?? "").trim();
    const oldHubRef = oldHubId && oldHubId !== input.hubId ? db.collection("hubs").doc(oldHubId) : null;
    const oldHub = oldHubRef ? await tx.get(oldHubRef) : null;
    const legacyGoals = oldHubId !== input.hubId
      ? await tx.get(configRef.collection("testingGoals").limit(491)) : null;
    if (legacyGoals && legacyGoals.docs.length > 490) {
      throw new DiscordCommandError("This server has too much goal history to reconnect automatically. Contact RiftLite support.");
    }
    // The shared hub write serializes concurrent first-time setup attempts.
    tx.set(hubRef, { discordGuildId: input.guildId }, { merge: true });
    if (oldHubRef && oldHub?.exists && oldHub.data()?.discordGuildId === input.guildId) {
      tx.set(oldHubRef, { discordGuildId: "" }, { merge: true });
    }
    for (const goal of legacyGoals?.docs ?? []) {
      // Orphaned history with no previous configuration has no trustworthy
      // source hub. Keep it stored but invisible until support can attribute it.
      if (!goal.data().hubId) tx.set(goal.ref, { hubId: oldHubId }, { merge: true });
    }
    tx.set(configRef, {
      ...input,
      updatedAt: now,
    }, { merge: true });
  });
  return { ...input, updatedAt: now };
}

export async function disconnectDiscordGuild(guildId: string) {
  const db = requireDb();
  const configRef = db.collection("discordGuildConfigs").doc(guildId);
  await db.runTransaction(async (tx) => {
    const config = await tx.get(configRef);
    if (!config.exists) return;
    const hubId = String(config.data()?.hubId ?? "").trim();
    const hubRef = hubId ? db.collection("hubs").doc(hubId) : null;
    const [hub, goals] = await Promise.all([
      hubRef ? tx.get(hubRef) : Promise.resolve(null),
      tx.get(configRef.collection("testingGoals").limit(491)),
    ]);
    if (goals.docs.length > 490) {
      throw new DiscordCommandError("This server has too much goal history to disconnect automatically. Contact RiftLite support.");
    }
    for (const goal of goals.docs) {
      if (!goal.data().hubId) tx.set(goal.ref, { hubId }, { merge: true });
    }
    if (hubRef && hub?.exists && hub.data()?.discordGuildId === guildId) {
      tx.set(hubRef, { discordGuildId: "" }, { merge: true });
    }
    tx.delete(configRef);
  });
}

export async function assertDiscordSetupAllowed(input: {
  guildId: string;
  discordUserId: string;
  hubId: string;
  memberPermissions: string;
}) {
  if (!hasManageGuild(input.memberPermissions)) {
    throw new DiscordCommandError("Discord Manage Server permission is required for this action.");
  }
  const uid = await getLinkedRiftLiteUid(input.guildId, input.discordUserId);
  if (!uid) throw new DiscordCommandError("Run /verify in this Discord server first, then try again.");
  await assertDiscordHubCapability(input.hubId, uid, "manage_discord");
  return uid;
}

export async function assertDiscordHubCapability(hubId: string, uid: string, capability: "view" | "manage_discord" | "manage_testing_goals") {
  if (!uid) throw new DiscordCommandError("Run /verify in this Discord server first, then try again.");
  // assertHubCapability resolves all immutable account identities itself.
  const allowed = await assertHubCapability(hubId, uid, capability).then(() => true).catch(() => false);
  if (!allowed) throw new DiscordCommandError(capability === "view"
    ? "Your verified RiftLite account must be a current member of this server's private hub. Ask a hub admin for an invitation."
    : "Your verified RiftLite account must be a current owner or admin of this private hub.");
}

export async function assignDiscordRole(guildId: string, discordUserId: string, roleId: string) {
  if (!guildId || !discordUserId || !roleId) throw new Error("Guild, user, and role are required.");
  await validateDiscordVerificationRole({ guildId, verifiedRoleId: roleId });
  await discordApi(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, { method: "PUT" });
}

export async function loadHubMatches(hubId: string, limit = HUB_MATCH_READ_LIMIT): Promise<DiscordHubMatch[]> {
  const db = requireDb();
  const hubRef = db.collection("hubs").doc(hubId);
  const boundedLimit = Math.max(1, Math.min(HUB_MATCH_READ_LIMIT, Math.round(limit) || HUB_MATCH_READ_LIMIT));
  const [ordered, camelOrdered] = await Promise.all([
    hubRef.collection("matches").orderBy("created_at", "desc").limit(boundedLimit).get().catch(() => null),
    hubRef.collection("matches").orderBy("createdAt", "desc").limit(boundedLimit).get().catch(() => null),
  ]);
  const snapshots = ordered || camelOrdered ? [ordered, camelOrdered]
    : [await hubRef.collection("matches").limit(Math.min(boundedLimit, 500)).get()];
  const docs = new Map(snapshots.flatMap((snap) => snap?.docs ?? []).map((doc) => [doc.id, doc]));
  const matches = [...docs.values()].map((doc) => normalizeHubMatch(doc.id, doc.data() as Record<string, unknown>))
    .filter((match) => !match.superseded).sort((a, b) => b.createdAt - a.createdAt).slice(0, boundedLimit);
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

export async function listTestingGoals(guildId: string, expectedHubId = "") {
  const config = await getDiscordGuildConfig(guildId);
  if (!config) throw new DiscordCommandError("This Discord server has no active private hub connection. Ask a server admin to run /setup.");
  if (expectedHubId && config.hubId !== expectedHubId) {
    throw new DiscordCommandError("This server's hub connection changed. Run the command again.");
  }
  const snap = await requireDb()
    .collection("discordGuildConfigs")
    .doc(guildId)
    .collection("testingGoals")
    .where("status", "==", "active")
    .limit(100)
    .get();
  return snap.docs
    .filter((doc) => String(doc.data().hubId ?? config.hubId) === config.hubId)
    .map((doc) => ({ id: doc.id, text: String(doc.data().text ?? ""), createdAt: Number(doc.data().createdAt ?? 0) }))
    .sort((a, b) => a.createdAt - b.createdAt).slice(0, 20);
}

export async function addTestingGoal(guildId: string, text: string, createdBy: string, hubIdInput = "") {
  const clean = text.trim().slice(0, 240);
  if (!clean) throw new DiscordCommandError("Goal text is required.");
  const db = requireDb();
  const configRef = db.collection("discordGuildConfigs").doc(guildId);
  const ref = configRef.collection("testingGoals").doc();
  await db.runTransaction(async (tx) => {
    const configSnap = await tx.get(configRef);
    const hubId = hubIdInput.trim() || String(configSnap.data()?.hubId ?? "").trim();
    if (!hubId || configSnap.data()?.hubId !== hubId) throw new DiscordCommandError("This server's hub connection changed. Run the command again.");
    const hubSnap = await tx.get(db.collection("hubs").doc(hubId));
    if (!hubSnap.exists || String(hubSnap.data()?.lifecycle_state ?? "") === "deleting") {
      throw new DiscordCommandError("This private hub is unavailable.");
    }
    tx.set(ref, {
      id: ref.id,
      hubId,
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
  if (!clean) throw new DiscordCommandError("Goal id is required.");
  const goals = await listTestingGoals(guildId, hubIdInput);
  const matching = goals.filter((goal) => goal.id === clean || (clean.length >= 6 && goal.id.startsWith(clean)));
  if (matching.length !== 1) throw new DiscordCommandError(matching.length
    ? "That goal id is ambiguous. Use the full id from /testing-goals list."
    : "That active goal was not found. Copy its id from /testing-goals list.");
  const db = requireDb();
  const configRef = db.collection("discordGuildConfigs").doc(guildId);
  await db.runTransaction(async (tx) => {
    const configSnap = await tx.get(configRef);
    const hubId = hubIdInput.trim() || String(configSnap.data()?.hubId ?? "").trim();
    if (!hubId || configSnap.data()?.hubId !== hubId) throw new DiscordCommandError("This server's hub connection changed. Run the command again.");
    const goalRef = configRef.collection("testingGoals").doc(matching[0].id);
    const [hubSnap, goalSnap] = await Promise.all([tx.get(db.collection("hubs").doc(hubId)), tx.get(goalRef)]);
    if (!hubSnap.exists || String(hubSnap.data()?.lifecycle_state ?? "") === "deleting") {
      throw new DiscordCommandError("This private hub is unavailable.");
    }
    if (!goalSnap.exists || goalSnap.data()?.status !== "active" || String(goalSnap.data()?.hubId ?? hubId) !== hubId) {
      throw new DiscordCommandError("That active goal was not found. Run /testing-goals list again.");
    }
    tx.set(goalRef, {
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
    ...goals.map((goal, index) => `${index + 1}. ${goal.text} \`${goal.id}\``),
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
