import { describe, expect, it } from "vitest";

import {
  bytesToHex,
  isSupportedReplayFileName,
  validateRawCaptureEnvelope,
} from "@/components/replay-v2/library/upload-helpers";
import { MAX_RAW_CAPTURE_MESSAGES } from "@/lib/replay-v2";

describe("replay upload helpers", () => {
  it("accepts supported capture filenames without case sensitivity", () => {
    expect(isSupportedReplayFileName("capture.json")).toBe(true);
    expect(isSupportedReplayFileName("capture.JSON.GZ")).toBe(true);
    expect(isSupportedReplayFileName("capture.zip")).toBe(false);
  });

  it("returns only safe upload metadata from a raw capture envelope", () => {
    const metadata = validateRawCaptureEnvelope({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "capture-123",
        identity: { roomCode: "DO-NOT-EXPOSE" },
      },
      messages: [
        { seq: 0, raw: JSON.stringify({ type: "chat", text: "DO-NOT-EXPOSE" }) },
        { seq: 1, raw: "{}" },
      ],
    });

    expect(metadata).toEqual({ captureId: "capture-123", messageCount: 2, platform: "atlas" });
    expect(Object.keys(metadata)).toEqual(["captureId", "messageCount", "platform"]);
  });

  it("derives a canonical capture time from raw identity metadata", () => {
    const metadata = validateRawCaptureEnvelope({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "capture-timestamped",
        identity: { firstSeenAt: Date.parse("2026-07-09T18:00:12.345Z") },
      },
      messages: [],
    });

    expect(metadata).toEqual({
      captureId: "capture-timestamped",
      messageCount: 0,
      platform: "atlas",
      capturedAt: "2026-07-09T18:00:12.345Z",
    });
  });

  it("accepts the isolated TCGA provider envelope without exposing decoded data", () => {
    const metadata = validateRawCaptureEnvelope({
      schema: "riftlite-tcga-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "tcga_capture_123",
        identity: {
          firstSeenAt: Date.parse("2026-07-20T13:46:41.834Z"),
          perspectivePlayerId: "DO-NOT-EXPOSE",
        },
        source: { schema: "riftlite-tcga-web-replay", version: 1 },
        match: { result: "win", perspectivePoints: 8, opponentPoints: 5 },
      },
      messages: [{ parsed: { type: "PLAYER_DATA", payload: { private: "DO-NOT-EXPOSE" } } }],
    });

    expect(metadata).toEqual({
      captureId: "tcga_capture_123",
      messageCount: 1,
      platform: "tcga",
      capturedAt: "2026-07-20T13:46:41.834Z",
    });
    expect(JSON.stringify(metadata)).not.toContain("DO-NOT-EXPOSE");
  });

  it("keeps TCGA research and unresolved captures out of normal website uploads", () => {
    const capture = (source: string, result?: string) => ({
      schema: "riftlite-tcga-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "tcga_capture_123",
        identity: { firstSeenAt: Date.parse("2026-07-20T13:46:41.834Z") },
        source: { schema: source, version: 1 },
        ...(result ? { match: { result } } : {}),
      },
      messages: [],
    });

    expect(() => validateRawCaptureEnvelope(
      capture("riftlite-tcga-research-session", "win"),
    )).toThrow(/completed TCGA Web Replay/i);
    expect(() => validateRawCaptureEnvelope(
      capture("riftlite-tcga-web-replay", "incomplete"),
    )).toThrow(/completed TCGA Web Replay/i);
    expect(() => validateRawCaptureEnvelope(
      capture("riftlite-tcga-web-replay"),
    )).toThrow(/completed TCGA Web Replay/i);
  });

  it.each([
    null,
    {},
    { schema: "riftreplay-raw-capture", version: 2, capture: {}, messages: [] },
    { schema: "riftreplay-raw-capture", version: 1, capture: {}, messages: [] },
    {
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: { captureSessionId: "capture-123" },
    },
  ])("rejects an invalid envelope", (value) => {
    expect(() => validateRawCaptureEnvelope(value)).toThrow();
  });

  it("encodes digest bytes as lowercase hexadecimal", () => {
    expect(bytesToHex(new Uint8Array([0, 15, 16, 171, 255]))).toBe("000f10abff");
  });

  it("rejects captures above the server message limit before upload", () => {
    expect(() => validateRawCaptureEnvelope({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: { captureSessionId: "capture-too-large" },
      messages: new Array(MAX_RAW_CAPTURE_MESSAGES + 1),
    })).toThrow(/too many messages/i);
  });
});
