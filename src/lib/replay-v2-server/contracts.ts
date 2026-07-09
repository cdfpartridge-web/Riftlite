import { z } from "zod";

import { MAX_RAW_CAPTURE_MESSAGES } from "@/lib/replay-v2";
import {
  DEFAULT_REPLAY_LIST_LIMIT,
  MAX_RAW_GZIP_BYTES,
  MAX_REPLAY_LIST_LIMIT,
} from "@/lib/replay-v2-server/constants";

export const ReplayVisibilitySchema = z.enum(["private", "unlisted", "public"]);
export type ReplayVisibility = z.infer<typeof ReplayVisibilitySchema>;

export const ReplayStatusSchema = z.enum(["uploading", "processing", "ready", "failed"]);
export type ReplayStatus = z.infer<typeof ReplayStatusSchema>;

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

export const InitReplaySchema = z
  .object({
    captureId: IdentifierSchema,
    sha256: Sha256HexSchema,
    bytes: z.number().int().min(1).max(MAX_RAW_GZIP_BYTES),
    visibility: ReplayVisibilitySchema.default("private"),
    title: z.string().trim().max(180).optional(),
    platform: z.string().trim().max(40).default("atlas"),
    localReplayId: OptionalIdentifierSchema,
    matchId: OptionalIdentifierSchema,
    seriesId: OptionalIdentifierSchema,
    roomCode: z.string().trim().max(80).optional(),
    messageCount: z.number().int().min(0).max(MAX_RAW_CAPTURE_MESSAGES).optional(),
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
