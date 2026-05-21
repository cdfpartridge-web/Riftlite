import "server-only";

import { randomUUID } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { type NextRequest } from "next/server";

import {
  bestProfileDisplayName,
  buildSearchPrefixes,
  cleanDisplayName,
  cleanHandle,
  ensureUserProfile,
  handleLower,
  requireUser,
  socialJson,
  type AccountProfile
} from "@/lib/social/server";

export { socialJson };

export const LFG_TTL_MS = 15 * 60 * 1000;
export const LFG_IDLE_VOICE_MS = 3 * 60 * 1000;
export const TEAM_MESSAGE_LIMIT = 40;

type RequireUserSuccess = Extract<Awaited<ReturnType<typeof requireUser>>, { db: unknown }>;

export type LinkedSocialAuth = RequireUserSuccess & {
  profile: AccountProfile;
  displayName: string;
};

export async function requireLinkedProfile(req: NextRequest): Promise<LinkedSocialAuth | { error: ReturnType<typeof socialJson> }> {
  const auth = await requireUser(req);
  if ("error" in auth && auth.error) return { error: auth.error };
  const profile = await ensureUserProfile(auth.decoded.uid, auth.decoded.name ?? auth.decoded.email ?? "", auth.decoded.email ?? "");
  if (!profile.handleLower) {
    return { error: socialJson({ error: "Link your RiftLite profile and claim a handle before using Social Hub." }, 403) };
  }
  const displayName = bestProfileDisplayName(auth.decoded.uid, profile.displayName, profile.handle);
  return { ...auth, profile, displayName };
}

export function readBodyObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function parseBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return readBodyObject(await req.json());
  } catch {
    return {};
  }
}

export function cleanText(value: unknown, max = 2000): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

export function cleanLongText(value: unknown, max = 5000): string {
  return String(value ?? "").trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n").slice(0, max);
}

export function cleanSlug(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

export function validSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{2,47}$/.test(value);
}

export function cleanUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:image/")) {
    return /^data:image\/(png|jpe?g|webp);base64,/i.test(raw) && raw.length <= 180_000 ? raw : "";
  }
  const text = raw.slice(0, 500);
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function cleanTeamVisibility(value: unknown): "public" | "private" {
  return String(value ?? "").toLowerCase() === "private" ? "private" : "public";
}

export function cleanList(value: unknown, maxItems = 12, maxLength = 40): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return Array.from(new Set(raw.map((item) => cleanText(item, maxLength)).filter(Boolean))).slice(0, maxItems);
}

export function cleanLegendList(value: unknown): string[] {
  return cleanList(value, 12, 36);
}

export function socialMentions(text: string): string[] {
  return Array.from(new Set(text.match(/@[a-z0-9_-]{3,24}/gi)?.map((item) => item.slice(1).toLowerCase()) ?? [])).slice(0, 16);
}

export function lfgFromDoc(id: string, data: Record<string, unknown>) {
  const now = Date.now();
  const status = String(data.status ?? "active");
  const expiresAt = Number(data.expiresAt ?? 0);
  const resolvedStatus = status === "active" && expiresAt > 0 && expiresAt <= now ? "expired" : status;
  const discordVoiceExpiresAt = Number(data.discordVoiceExpiresAt ?? 0);
  const exposeDiscordVoice = (resolvedStatus === "active" || resolvedStatus === "matched") && discordVoiceExpiresAt > now;
  return {
    id,
    uid: String(data.uid ?? ""),
    handle: String(data.handle ?? ""),
    displayName: cleanDisplayName(data.displayName, String(data.handle ?? ""), String(data.uid ?? "")),
    platform: String(data.platform ?? ""),
    roomCode: String(data.roomCode ?? ""),
    format: String(data.format ?? "Bo1"),
    myLegend: String(data.myLegend ?? ""),
    lookingForLegends: Array.isArray(data.lookingForLegends) ? data.lookingForLegends.map(String) : [],
    allowAny: Boolean(data.allowAny),
    note: String(data.note ?? ""),
    status: resolvedStatus,
    acceptedByUid: String(data.acceptedByUid ?? ""),
    acceptedByHandle: String(data.acceptedByHandle ?? ""),
    acceptedByDisplayName: cleanDisplayName(data.acceptedByDisplayName, String(data.acceptedByHandle ?? ""), String(data.acceptedByUid ?? "")),
    acceptedAt: Number(data.acceptedAt ?? 0),
    createdAt: Number(data.createdAt ?? 0),
    expiresAt,
    closedAt: Number(data.closedAt ?? 0),
    discordVoiceChannelId: exposeDiscordVoice ? String(data.discordVoiceChannelId ?? "") : "",
    discordGuildId: exposeDiscordVoice ? String(data.discordGuildId ?? "") : "",
    discordChannelUrl: exposeDiscordVoice ? String(data.discordChannelUrl ?? "") : "",
    discordAppUrl: exposeDiscordVoice ? String(data.discordAppUrl ?? "") : "",
    discordInviteUrl: exposeDiscordVoice ? String(data.discordInviteUrl ?? "") : "",
    discordVoiceExpiresAt: exposeDiscordVoice ? discordVoiceExpiresAt : 0,
    discordVoiceCreatedAt: Number(data.discordVoiceCreatedAt ?? 0)
  };
}

export function publicTeamFromDoc(id: string, data: Record<string, unknown>) {
  const visibility = cleanTeamVisibility(data.visibility);
  return {
    id,
    slug: String(data.slug ?? id),
    name: String(data.name ?? id),
    description: String(data.description ?? ""),
    region: String(data.region ?? ""),
    locationMode: String(data.locationMode ?? ""),
    visibility,
    purposes: Array.isArray(data.purposes) ? data.purposes.map(String) : [],
    recruitmentStatus: String(data.recruitmentStatus ?? "open"),
    logoUrl: String(data.logoUrl ?? ""),
    bannerUrl: String(data.bannerUrl ?? ""),
    memberCount: Number(data.memberCount ?? 0),
    applicationCount: Number(data.applicationCount ?? 0),
    ownerUid: String(data.ownerUid ?? ""),
    ownerHandle: String(data.ownerHandle ?? ""),
    ownerDisplayName: String(data.ownerDisplayName ?? ""),
    updatedAt: Number(data.updatedAt ?? 0),
    createdAt: Number(data.createdAt ?? 0)
  };
}

export function fullTeamFromDoc(id: string, data: Record<string, unknown>) {
  return {
    ...publicTeamFromDoc(id, data),
    socials: readBodyObject(data.socials),
    website: String(data.website ?? ""),
    discord: String(data.discord ?? ""),
    hidden: Boolean(data.hidden),
    searchPrefixes: Array.isArray(data.searchPrefixes) ? data.searchPrefixes.map(String) : []
  };
}

export function memberFromDoc(id: string, data: Record<string, unknown>) {
  const uid = String(data.uid ?? id);
  return {
    id,
    uid,
    handle: String(data.handle ?? ""),
    displayName: cleanDisplayName(data.displayName, String(data.handle ?? ""), uid),
    role: normalizeTeamRole(data.role),
    joinedAt: Number(data.joinedAt ?? 0),
    updatedAt: Number(data.updatedAt ?? 0)
  };
}

export function applicationFromDoc(id: string, data: Record<string, unknown>) {
  const uid = String(data.uid ?? "");
  return {
    id,
    teamId: String(data.teamId ?? ""),
    uid,
    handle: String(data.handle ?? ""),
    displayName: cleanDisplayName(data.displayName, String(data.handle ?? ""), uid),
    message: String(data.message ?? ""),
    region: String(data.region ?? ""),
    preferredLegends: Array.isArray(data.preferredLegends) ? data.preferredLegends.map(String) : [],
    availability: String(data.availability ?? ""),
    status: normalizeApplicationStatus(data.status),
    createdAt: Number(data.createdAt ?? 0),
    updatedAt: Number(data.updatedAt ?? 0),
    reviewedAt: Number(data.reviewedAt ?? 0),
    reviewedBy: String(data.reviewedBy ?? "")
  };
}

export function teamMessageFromDoc(id: string, data: Record<string, unknown>) {
  const uid = String(data.uid ?? "");
  return {
    id,
    uid,
    handle: String(data.handle ?? ""),
    displayName: cleanDisplayName(data.displayName, String(data.handle ?? ""), uid),
    text: String(data.text ?? ""),
    mentions: Array.isArray(data.mentions) ? data.mentions.map(String) : [],
    pinned: Boolean(data.pinned),
    deleted: Boolean(data.deleted),
    createdAt: Number(data.createdAt ?? 0),
    updatedAt: Number(data.updatedAt ?? 0)
  };
}

export function normalizeTeamRole(value: unknown): "owner" | "admin" | "member" {
  return value === "owner" || value === "admin" || value === "member" ? value : "member";
}

export function normalizeApplicationStatus(value: unknown): "pending" | "accepted" | "declined" | "withdrawn" {
  return value === "accepted" || value === "declined" || value === "withdrawn" ? value : "pending";
}

export async function assertTeamRole(teamId: string, uid: string, roles: Array<"owner" | "admin" | "member">) {
  const authDb = (await import("@/lib/firebase/admin")).getFirestoreAdmin();
  if (!authDb) throw new Error("Firebase admin is not configured");
  const snap = await authDb.collection("teams").doc(teamId).collection("members").doc(uid).get();
  const role = normalizeTeamRole(snap.data()?.role);
  if (!snap.exists || !roles.includes(role)) {
    throw new Error("You do not have permission for this team action.");
  }
  return role;
}

export async function resolveTeamRef(db: Firestore, idOrSlug: string) {
  const clean = cleanSlug(idOrSlug);
  if (!clean) return null;
  let snap = await db.collection("teams").doc(clean).get();
  if (!snap.exists) {
    const slugSnap = await db.collection("teamSlugs").doc(clean).get();
    const teamId = String(slugSnap.data()?.teamId ?? "");
    if (teamId) {
      snap = await db.collection("teams").doc(teamId).get();
    }
  }
  return snap.exists ? snap : null;
}

export function teamPublicDoc(team: Record<string, unknown>) {
  const visibility = cleanTeamVisibility(team.visibility);
  return {
    id: String(team.id ?? ""),
    slug: String(team.slug ?? ""),
    name: String(team.name ?? ""),
    description: String(team.description ?? ""),
    region: String(team.region ?? ""),
    locationMode: String(team.locationMode ?? ""),
    visibility,
    purposes: Array.isArray(team.purposes) ? team.purposes : [],
    recruitmentStatus: String(team.recruitmentStatus ?? "open"),
    logoUrl: String(team.logoUrl ?? ""),
    bannerUrl: String(team.bannerUrl ?? ""),
    ownerUid: String(team.ownerUid ?? ""),
    ownerHandle: String(team.ownerHandle ?? ""),
    ownerDisplayName: String(team.ownerDisplayName ?? ""),
    memberCount: Number(team.memberCount ?? 1),
    applicationCount: Number(team.applicationCount ?? 0),
    createdAt: Number(team.createdAt ?? Date.now()),
    updatedAt: Number(team.updatedAt ?? Date.now()),
    searchPrefixes: buildSearchPrefixes(
      String(team.name ?? ""),
      String(team.slug ?? ""),
      String(team.region ?? ""),
      ...(Array.isArray(team.purposes) ? team.purposes.map(String) : [])
    )
  };
}

export function newId() {
  return randomUUID();
}

export function increment(value: number) {
  return FieldValue.increment(value);
}
