import { z } from "zod";

const REPLAY_ID_PATTERN = /^rl2_[a-f0-9]{32}$/;
const REPLAY_PATH_PATTERN = /^\/replays\/(rl2_[a-f0-9]{32})\/?$/;

const ReplayReferenceSchema = z.string().trim().min(1).max(1_024);

export const ReplayCombinationRequestSchema = z
  .object({
    leftReplay: ReplayReferenceSchema,
    rightReplay: ReplayReferenceSchema,
    permissionConfirmed: z.literal(true),
  })
  .strict();

export type ReplayCombinationRequest = z.infer<typeof ReplayCombinationRequestSchema>;

export type ParsedReplayCombinationRequest = {
  leftReplayId: string;
  rightReplayId: string;
  permissionConfirmed: true;
};

export class ReplayReferenceError extends Error {
  readonly code: "invalid_replay_reference" | "duplicate_replay_source";

  constructor(
    code: "invalid_replay_reference" | "duplicate_replay_source",
    message: string,
  ) {
    super(message);
    this.name = "ReplayReferenceError";
    this.code = code;
  }
}

export function parseReplayCombinationRequest(
  input: ReplayCombinationRequest,
): ParsedReplayCombinationRequest {
  const leftReplayId = parseReplayReference(input.leftReplay);
  const rightReplayId = parseReplayReference(input.rightReplay);
  if (leftReplayId === rightReplayId) {
    throw new ReplayReferenceError(
      "duplicate_replay_source",
      "Choose two different replay links, one captured by each player.",
    );
  }
  return {
    leftReplayId,
    rightReplayId,
    permissionConfirmed: true,
  };
}

export function parseReplayReference(value: string): string {
  const candidate = value.trim();
  if (REPLAY_ID_PATTERN.test(candidate)) return candidate;

  let parsed: URL;
  try {
    parsed = candidate.startsWith("/")
      ? new URL(candidate, "https://www.riftlite.com")
      : new URL(candidate);
  } catch {
    throw invalidReference();
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    !trustedReplayHost(parsed.hostname)
  ) {
    throw invalidReference();
  }

  const match = REPLAY_PATH_PATTERN.exec(parsed.pathname);
  if (!match?.[1]) throw invalidReference();
  return match[1];
}

function trustedReplayHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "riftlite.com" ||
    host.endsWith(".riftlite.com") ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1"
  );
}

function invalidReference(): ReplayReferenceError {
  return new ReplayReferenceError(
    "invalid_replay_reference",
    "Enter a RiftLite replay link such as https://www.riftlite.com/replays/rl2_... or its replay ID.",
  );
}
