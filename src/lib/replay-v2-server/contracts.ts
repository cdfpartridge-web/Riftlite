import { z } from "zod";

import { MAX_RAW_CAPTURE_MESSAGES } from "@/lib/replay-v2";
import {
  DEFAULT_REPLAY_LIST_LIMIT,
  MAX_RAW_GZIP_BYTES,
  MAX_REPLAY_LIST_LIMIT,
} from "@/lib/replay-v2-server/constants";

export const ReplayVisibilitySchema = z.enum(["private", "unlisted", "public"]);
export type ReplayVisibility = z.infer<typeof ReplayVisibilitySchema>;

export function replayVisibilityAllowsViewer(
  visibility: ReplayVisibility,
  ownerUid: string,
  viewerUid: string,
): boolean {
  return visibility !== "private" || Boolean(ownerUid && ownerUid === viewerUid);
}

export const ReplayStatusSchema = z.enum(["uploading", "processing", "ready", "failed"]);
export type ReplayStatus = z.infer<typeof ReplayStatusSchema>;

export const ReplayPlatformSchema = z.enum(["atlas", "tcga"]);
export type ReplayPlatform = z.infer<typeof ReplayPlatformSchema>;

export const Sha256HexSchema = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{64}$/, "sha256 must contain exactly 64 hexadecimal characters")
  .transform((value) => value.toLowerCase());

const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "identifier contains control characters");

const OptionalIdentifierSchema = z
  .string()
  .trim()
  .max(160)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "identifier contains control characters")
  .optional();

// Atlas capture support predates Replay V2, so retain a generous product epoch
// while rejecting Firestore-invalid dates and future-dated discovery abuse.
export const REPLAY_CAPTURED_AT_EPOCH_MS = Date.UTC(2025, 0, 1);
export const REPLAY_CAPTURED_AT_FUTURE_TOLERANCE_MS = 10 * 60 * 1_000;

export const ReplayCapturedAtSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => {
    const capturedAt = Date.parse(value);
    return capturedAt >= REPLAY_CAPTURED_AT_EPOCH_MS &&
      capturedAt <= Date.now() + REPLAY_CAPTURED_AT_FUTURE_TOLERANCE_MS;
  }, "capturedAt is outside the supported RiftLite capture window")
  .transform((value) => new Date(value).toISOString());

export const InitReplaySchema = z
  .object({
    captureId: IdentifierSchema,
    sha256: Sha256HexSchema,
    bytes: z.number().int().min(1).max(MAX_RAW_GZIP_BYTES),
    visibility: ReplayVisibilitySchema.default("private"),
    title: z.string().trim().max(180).optional(),
    platform: ReplayPlatformSchema.default("atlas"),
    localReplayId: OptionalIdentifierSchema,
    matchId: OptionalIdentifierSchema,
    seriesId: OptionalIdentifierSchema,
    roomCode: z.string().trim().max(80).optional(),
    messageCount: z.number().int().min(0).max(MAX_RAW_CAPTURE_MESSAGES).optional(),
    capturedAt: ReplayCapturedAtSchema.optional(),
  })
  .strict();

export type InitReplayInput = z.infer<typeof InitReplaySchema>;

export const VisibilityUpdateSchema = z
  .object({
    visibility: ReplayVisibilitySchema,
  })
  .strict();

export type VisibilityUpdateInput = z.infer<typeof VisibilityUpdateSchema>;

export function normalizeListLimit(value: string | null): number {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_REPLAY_LIST_LIMIT;
  return Math.min(parsed, MAX_REPLAY_LIST_LIMIT);
}
