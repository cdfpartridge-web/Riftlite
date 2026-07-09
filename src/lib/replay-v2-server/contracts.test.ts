import { describe, expect, it } from "vitest";

import { MAX_RAW_GZIP_BYTES } from "@/lib/replay-v2-server/constants";
import {
  InitReplaySchema,
  VisibilityUpdateSchema,
  normalizeListLimit,
} from "@/lib/replay-v2-server/contracts";
import { deterministicReplayId, isReplayId, sha256Hex } from "@/lib/replay-v2-server/ids";

describe("replay v2 init contract", () => {
  it("requires immutable content identity and defaults to private", () => {
    const parsed = InitReplaySchema.parse({
      captureId: "capture-123",
      sha256: "A".repeat(64),
      bytes: 1_024,
    });

    expect(parsed).toMatchObject({
      captureId: "capture-123",
      sha256: "a".repeat(64),
      bytes: 1_024,
      visibility: "private",
      platform: "atlas",
    });
  });

  it("rejects oversized or malformed declarations", () => {
    expect(
      InitReplaySchema.safeParse({
        captureId: "capture-123",
        sha256: "not-a-checksum",
        bytes: 1,
      }).success,
    ).toBe(false);
    expect(
      InitReplaySchema.safeParse({
        captureId: "capture-123",
        sha256: "a".repeat(64),
        bytes: MAX_RAW_GZIP_BYTES + 1,
      }).success,
    ).toBe(false);
    expect(
      InitReplaySchema.safeParse({
        captureId: "capture\n123",
        sha256: "a".repeat(64),
        bytes: 1,
      }).success,
    ).toBe(false);
  });

  it("accepts only the three supported visibility values", () => {
    expect(VisibilityUpdateSchema.parse({ visibility: "unlisted" })).toEqual({ visibility: "unlisted" });
    expect(VisibilityUpdateSchema.safeParse({ visibility: "friends" }).success).toBe(false);
  });

  it("bounds replay listing limits", () => {
    expect(normalizeListLimit(null)).toBe(48);
    expect(normalizeListLimit("0")).toBe(48);
    expect(normalizeListLimit("15")).toBe(15);
    expect(normalizeListLimit("500")).toBe(100);
  });
});

describe("replay v2 identifiers", () => {
  it("is deterministic for the same owner and capture", () => {
    const first = deterministicReplayId("owner-a", "capture-a");
    const second = deterministicReplayId("owner-a", "capture-a");

    expect(first).toBe(second);
    expect(isReplayId(first)).toBe(true);
  });

  it("separates owners and captures", () => {
    expect(deterministicReplayId("owner-a", "capture-a")).not.toBe(
      deterministicReplayId("owner-b", "capture-a"),
    );
    expect(deterministicReplayId("owner-a", "capture-a")).not.toBe(
      deterministicReplayId("owner-a", "capture-b"),
    );
  });

  it("computes the standard SHA-256 representation", () => {
    expect(sha256Hex("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});
