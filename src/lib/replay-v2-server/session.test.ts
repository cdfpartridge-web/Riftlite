import { describe, expect, it } from "vitest";

import {
  REPLAY_EMBED_SESSION_TTL_SECONDS,
  signReplayEmbedSession,
  verifyReplayEmbedSession,
} from "@/lib/replay-v2-server/session";

const SECRET = "test-only-replay-embed-secret-32-bytes-minimum";
const OTHER_SECRET = "different-test-replay-secret-32-bytes-minimum";
const NOW = Date.UTC(2026, 6, 9, 12, 0, 0);

describe("replay embed session token", () => {
  it("round-trips a short-lived owner session", () => {
    const token = signReplayEmbedSession("firebase-user", SECRET, NOW, "fixed-nonce");
    expect(verifyReplayEmbedSession(token, SECRET, NOW + 5_000)).toBe("firebase-user");
  });

  it("rejects tampering and tokens signed with another key", () => {
    const token = signReplayEmbedSession("firebase-user", SECRET, NOW, "fixed-nonce");
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(verifyReplayEmbedSession(tampered, SECRET, NOW)).toBe("");
    expect(verifyReplayEmbedSession(token, OTHER_SECRET, NOW)).toBe("");
  });

  it("rejects an expired token", () => {
    const token = signReplayEmbedSession("firebase-user", SECRET, NOW, "fixed-nonce");
    expect(
      verifyReplayEmbedSession(token, SECRET, NOW + REPLAY_EMBED_SESSION_TTL_SECONDS * 1_000),
    ).toBe("");
  });

  it("fails closed when the signing key is too short", () => {
    expect(() => signReplayEmbedSession("firebase-user", "too-short", NOW, "fixed-nonce")).toThrow(
      /32 bytes/,
    );
    expect(verifyReplayEmbedSession("anything", "too-short", NOW)).toBe("");
  });
});
