import { buildReplayCheckpoints, type ReplayCheckpointOptions } from "@/lib/replay-v2/checkpoints";
import { deriveCanonicalReplay } from "@/lib/replay-v2/derive-replay";
import { parseRawCaptureV1 } from "@/lib/replay-v2/parse-raw-capture";
import type { CanonicalReplayV2 } from "@/lib/replay-v2/types";

export type NormalizeReplayOptions = {
  checkpoints?: ReplayCheckpointOptions;
};

export function normalizeRawCaptureV1(
  input: unknown,
  options: NormalizeReplayOptions = {},
): CanonicalReplayV2 {
  const replay = deriveCanonicalReplay(parseRawCaptureV1(input));
  replay.checkpoints = buildReplayCheckpoints(replay, options.checkpoints);
  return replay;
}
