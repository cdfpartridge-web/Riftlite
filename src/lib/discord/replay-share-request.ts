import "server-only";

import { createHash } from "node:crypto";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import type { ReplayDiscordHubShareResult } from "@/lib/discord/replay-share-server";

const RECEIPT_COLLECTION = "replayDiscordRequestReceipts";
const RECEIPT_VERSION = 1;
const PENDING_RECHECK_MS = 6 * 60 * 60 * 1_000;

export type ReplayDiscordRequestReceipt =
  | { status: "complete"; results: ReplayDiscordHubShareResult[] }
  | { status: "terminal"; results: ReplayDiscordHubShareResult[] }
  | { status: "result-pending" };

export async function readReplayDiscordRequestReceipt(input: {
  ownerUid: string;
  replayId: string;
  hubIds: string[];
}): Promise<ReplayDiscordRequestReceipt | null> {
  const db = getFirestoreAdmin();
  if (!db) return null;
  const hubIds = canonicalHubIds(input.hubIds);
  const snapshot = await db.collection(RECEIPT_COLLECTION)
    .doc(receiptId(input.ownerUid, input.replayId, hubIds))
    .get()
    .catch(() => null);
  if (!snapshot?.exists) return null;
  const value = snapshot.data() ?? {};
  if (
    value.version !== RECEIPT_VERSION ||
    value.ownerUid !== input.ownerUid ||
    value.replayId !== input.replayId ||
    !equalStrings(value.hubIds, hubIds)
  ) return null;
  if (value.status === "result-pending") {
    return Number(value.retryAfter ?? 0) > Date.now() ? { status: "result-pending" } : null;
  }
  if ((value.status !== "complete" && value.status !== "terminal") || !Array.isArray(value.results)) return null;
  const results = value.results.flatMap((item): ReplayDiscordHubShareResult[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    const hubId = typeof candidate.hubId === "string" ? candidate.hubId : "";
    const status = candidate.status;
    if (!hubIds.includes(hubId) || !isSettledStatus(status)) return [];
    return [{ hubId, status: status as ReplayDiscordHubShareResult["status"] }];
  });
  if (results.length !== hubIds.length || new Set(results.map((item) => item.hubId)).size !== hubIds.length) return null;
  const complete = results.every((item) => item.status === "shared" || item.status === "already-shared");
  if ((value.status === "complete") !== complete) return null;
  return { status: value.status, results };
}

export async function writeReplayDiscordRequestReceipt(input: {
  ownerUid: string;
  replayId: string;
  hubIds: string[];
  receipt: ReplayDiscordRequestReceipt;
}): Promise<void> {
  const db = getFirestoreAdmin();
  if (!db) return;
  const hubIds = canonicalHubIds(input.hubIds);
  await db.collection(RECEIPT_COLLECTION)
    .doc(receiptId(input.ownerUid, input.replayId, hubIds))
    .set({
      version: RECEIPT_VERSION,
      ownerUid: input.ownerUid,
      replayId: input.replayId,
      hubIds,
      status: input.receipt.status,
      ...(input.receipt.status === "complete" || input.receipt.status === "terminal"
        ? { results: input.receipt.results, completedAt: Date.now() }
        : { retryAfter: Date.now() + PENDING_RECHECK_MS }),
      updatedAt: Date.now(),
    })
    .catch(() => undefined);
}

function receiptId(ownerUid: string, replayId: string, hubIds: string[]): string {
  return createHash("sha256").update(`${ownerUid}\0${replayId}\0${hubIds.join("\0")}`).digest("hex");
}

function canonicalHubIds(hubIds: string[]): string[] {
  return Array.from(new Set(hubIds)).sort();
}

function equalStrings(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index]);
}

function isSettledStatus(value: unknown): boolean {
  return [
    "shared",
    "already-shared",
    "not-member",
    "not-configured",
    "hub-unavailable",
  ].includes(String(value ?? ""));
}
