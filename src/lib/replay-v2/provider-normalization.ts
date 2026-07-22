import { normalizeRawCaptureV1 } from "@/lib/replay-v2/normalize-replay";
import { parseRawCaptureV1 } from "@/lib/replay-v2/parse-raw-capture";
import {
  assertTcgaCanonicalReplaySafe,
  normalizeParsedTcgaReplayRawCaptureV1,
  parseTcgaReplayRawCaptureV1,
} from "@/lib/replay-v2/tcga";
import type { CanonicalReplayV2 } from "@/lib/replay-v2/types";
import type { ReplayPlatform } from "@/lib/replay-v2-server/contracts";

export type ProviderNormalizedReplay = {
  captureId: string;
  replay: CanonicalReplayV2;
};

/**
 * Provider dispatch is deliberately outside both normalizers. Atlas continues
 * through its original parser/deriver unchanged; TCGA cannot fall through to
 * that path or masquerade as an Atlas envelope.
 */
export function normalizeReplayProviderCapture(
  input: unknown,
  platform: ReplayPlatform,
  replayId: string,
): ProviderNormalizedReplay {
  switch (platform) {
    case "atlas": {
      const parsed = parseRawCaptureV1(input);
      return {
        captureId: parsed.captureId,
        replay: { ...normalizeRawCaptureV1(input), id: replayId },
      };
    }
    case "tcga": {
      const parsed = parseTcgaReplayRawCaptureV1(input);
      if (parsed.capture.source.schema !== "riftlite-tcga-web-replay") {
        throw new Error("TCGA research captures are local-preview only and cannot be published.");
      }
      const replay = normalizeParsedTcgaReplayRawCaptureV1(parsed, { replayId });
      assertTcgaCanonicalReplaySafe(parsed, replay);
      return {
        captureId: parsed.capture.captureSessionId,
        replay,
      };
    }
  }
}
