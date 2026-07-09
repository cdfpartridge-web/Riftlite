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

    expect(metadata).toEqual({ captureId: "capture-123", messageCount: 2 });
    expect(Object.keys(metadata)).toEqual(["captureId", "messageCount"]);
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
