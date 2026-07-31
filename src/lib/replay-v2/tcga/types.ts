import type { JsonValue } from "@/lib/replay-v2/types";
import type { ReplayCheckpointOptions } from "@/lib/replay-v2/checkpoints";

export type TcgaReplayDirection = "in" | "out";

export type TcgaReplayParsedMessageV1 = {
  type: string;
  gameId?: string;
  payload?: JsonValue;
  [key: string]: JsonValue | undefined;
};

export type TcgaReplayRawMessageV1 = {
  seq: number;
  ts: number;
  dir: TcgaReplayDirection;
  firstTransportSequence: number;
  completedTransportSequence: number;
  parsed: TcgaReplayParsedMessageV1;
};

export type TcgaReplayMatchSummaryV1 = {
  result: "win" | "loss" | "draw" | "incomplete";
  perspectivePoints?: number;
  opponentPoints?: number;
};

export type TcgaReplayRawCaptureV1 = {
  schema: "riftlite-tcga-raw-capture";
  version: 1;
  exportedAt: string;
  capture: {
    captureSessionId: string;
    identity: {
      perspectivePlayerId: string;
      firstSeenAt: number;
      lastSeenAt: number;
    };
    lifecycle: {
      channelKey: string;
      openedAt: number | null;
      closedAt: number | null;
      endedByLeaving: boolean;
    };
    source: {
      schema: "riftlite-tcga-research-session" | "riftlite-tcga-web-replay";
      version: 1;
      sha256: string;
    };
    match?: TcgaReplayMatchSummaryV1;
  };
  transport: {
    frames: number;
    decodedFrames: number;
    logicalMessages: number;
    chunkGroups: number;
    completeChunkGroups: number;
    incompleteChunkGroups: number;
    incompleteChunkCount: number;
    duplicateChunks: number;
    issueCounts: Record<string, number>;
  };
  messages: TcgaReplayRawMessageV1[];
};

export type NormalizeTcgaReplayOptions = {
  replayId?: string;
  checkpoints?: ReplayCheckpointOptions;
};
