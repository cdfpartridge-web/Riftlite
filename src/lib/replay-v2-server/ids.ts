import { createHash, randomUUID } from "node:crypto";

const REPLAY_ID_PATTERN = /^rl2_[a-f0-9]{32}$/;

export function deterministicReplayId(ownerUid: string, captureId: string): string {
  const digest = createHash("sha256")
    .update("riftlite-replay-v2\0", "utf8")
    .update(ownerUid, "utf8")
    .update("\0", "utf8")
    .update(captureId, "utf8")
    .digest("hex");
  return `rl2_${digest.slice(0, 32)}`;
}

export function isReplayId(value: string): boolean {
  return REPLAY_ID_PATTERN.test(value);
}

export function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createArtifactGeneration(kind: "raw" | "canonical"): string {
  return `${kind}_${randomUUID().replace(/-/g, "")}`;
}
