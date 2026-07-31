import { z } from "zod";

import type { JsonValue } from "@/lib/replay-v2/types";
import type { TcgaReplayRawCaptureV1 } from "@/lib/replay-v2/tcga/types";

const MAX_MESSAGES = 50_000;
const MAX_IDENTIFIER_LENGTH = 240;
const MAX_MESSAGE_TYPE_LENGTH = 120;

const IdentifierSchema = z.string()
  .trim()
  .min(1)
  .max(MAX_IDENTIFIER_LENGTH)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "identifier contains control characters");

const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const TimestampSchema = z.number().finite().nonnegative().max(8_640_000_000_000_000);
const JsonValueSchema: z.ZodType<JsonValue> = z.json();

const ParsedMessageSchema = z.object({
  type: z.string().trim().min(1).max(MAX_MESSAGE_TYPE_LENGTH),
  gameId: IdentifierSchema.optional(),
  payload: JsonValueSchema.optional(),
}).catchall(JsonValueSchema);

const RawMessageSchema = z.object({
  seq: CountSchema,
  ts: TimestampSchema,
  dir: z.enum(["in", "out"]),
  firstTransportSequence: CountSchema,
  completedTransportSequence: CountSchema,
  parsed: ParsedMessageSchema,
}).strict();

const MatchSummarySchema = z.object({
  result: z.enum(["win", "loss", "draw", "incomplete"]),
  perspectivePoints: z.number().int().min(0).max(99).optional(),
  opponentPoints: z.number().int().min(0).max(99).optional(),
}).strict().superRefine((match, context) => {
  if ((match.perspectivePoints === undefined) !== (match.opponentPoints === undefined)) {
    context.addIssue({ code: "custom", message: "match points must be supplied as a complete pair" });
  }
});

export const TcgaReplayRawCaptureV1Schema: z.ZodType<TcgaReplayRawCaptureV1> = z.object({
  schema: z.literal("riftlite-tcga-raw-capture"),
  version: z.literal(1),
  exportedAt: z.iso.datetime({ offset: true }),
  capture: z.object({
    captureSessionId: IdentifierSchema,
    identity: z.object({
      perspectivePlayerId: IdentifierSchema,
      firstSeenAt: TimestampSchema,
      lastSeenAt: TimestampSchema,
    }).strict(),
    lifecycle: z.object({
      channelKey: IdentifierSchema,
      openedAt: TimestampSchema.nullable(),
      closedAt: TimestampSchema.nullable(),
      endedByLeaving: z.boolean(),
    }).strict(),
    source: z.object({
      schema: z.enum(["riftlite-tcga-research-session", "riftlite-tcga-web-replay"]),
      version: z.literal(1),
      sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase()),
    }).strict(),
    match: MatchSummarySchema.optional(),
  }).strict(),
  transport: z.object({
    frames: CountSchema,
    decodedFrames: CountSchema,
    logicalMessages: CountSchema,
    chunkGroups: CountSchema,
    completeChunkGroups: CountSchema,
    incompleteChunkGroups: CountSchema,
    incompleteChunkCount: CountSchema,
    duplicateChunks: CountSchema,
    issueCounts: z.record(z.string().min(1).max(120), CountSchema),
  }).strict(),
  messages: z.array(RawMessageSchema).min(1).max(MAX_MESSAGES),
}).strict().superRefine((capture, context) => {
  if (capture.capture.identity.lastSeenAt < capture.capture.identity.firstSeenAt) {
    context.addIssue({ code: "custom", message: "capture lastSeenAt cannot precede firstSeenAt" });
  }
  if (capture.transport.decodedFrames > capture.transport.frames) {
    context.addIssue({ code: "custom", message: "decoded frame count cannot exceed frame count" });
  }
  if (capture.messages.length > capture.transport.logicalMessages) {
    context.addIssue({ code: "custom", message: "message count cannot exceed logical message count" });
  }
  if (capture.transport.completeChunkGroups + capture.transport.incompleteChunkGroups > capture.transport.chunkGroups) {
    context.addIssue({ code: "custom", message: "chunk group counts are inconsistent" });
  }
  if (capture.capture.source.schema === "riftlite-tcga-web-replay") {
    const transport = capture.transport;
    if (
      !capture.capture.match ||
      capture.capture.match.result === "incomplete"
    ) {
      context.addIssue({
        code: "custom",
        message: "production TCGA replay capture must include a completed match result",
      });
    }
    if (
      transport.decodedFrames !== transport.frames ||
      transport.incompleteChunkGroups !== 0 ||
      transport.incompleteChunkCount !== 0 ||
      transport.duplicateChunks !== 0 ||
      transport.completeChunkGroups !== transport.chunkGroups ||
      Object.values(transport.issueCounts).some((count) => count !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "production TCGA replay transport must be complete and issue-free",
      });
    }
  }

  const sourceSequences = new Set<number>();
  for (const message of capture.messages) {
    if (sourceSequences.has(message.seq)) {
      context.addIssue({ code: "custom", message: `duplicate source sequence ${message.seq}` });
      break;
    }
    sourceSequences.add(message.seq);
    if (message.firstTransportSequence > message.completedTransportSequence) {
      context.addIssue({ code: "custom", message: "first transport sequence cannot exceed completion sequence" });
      break;
    }
  }

  const outboundPlayerIds = new Set(
    capture.messages.flatMap((message) => (
      message.dir === "out" &&
      (message.parsed.type === "PLAYER_DATA" || message.parsed.type === "GAME_DATA") &&
      message.parsed.gameId
        ? [message.parsed.gameId]
        : []
    )),
  );
  if (outboundPlayerIds.size !== 1 || !outboundPlayerIds.has(capture.capture.identity.perspectivePlayerId)) {
    context.addIssue({
      code: "custom",
      message: "perspective player must match the sole outbound PLAYER_DATA/GAME_DATA player",
    });
  }
});

export function parseTcgaReplayRawCaptureV1(input: unknown): TcgaReplayRawCaptureV1 {
  const result = TcgaReplayRawCaptureV1Schema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues.slice(0, 3).map((issue) => issue.message).join("; ");
    throw new Error(`Invalid TCGA raw capture: ${detail || "schema validation failed"}.`);
  }
  return result.data;
}
