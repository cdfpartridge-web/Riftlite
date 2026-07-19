import type { ReplayStatus, ReplayVisibility } from "@/lib/replay-v2-server/contracts";
import type { ReplayListingMetadata } from "@/lib/replay-v2/replay-listing";

export type ReplayArtifactKind = "raw" | "canonical";

type ArtifactPointerBase = {
  kind: ReplayArtifactKind;
  generation: string;
  sha256: string;
  bytes: number;
  contentType: "application/gzip";
};

export type ReplayArtifactPointer =
  | (ArtifactPointerBase & {
      provider: "vercel-blob";
      pathname: string;
    })
  | (ArtifactPointerBase & {
      provider: "firestore-chunks";
      artifactId: string;
      chunkCount: number;
    });

export type ReplayRecord = {
  schema: "riftlite-replay-record";
  version: 2;
  replayId: string;
  ownerUid: string;
  captureId: string;
  visibility: ReplayVisibility;
  status: ReplayStatus;
  title: string;
  platform: string;
  localReplayId: string;
  matchId: string;
  seriesId: string;
  roomCode: string;
  messageCount: number | null;
  listing?: ReplayListingMetadata;
  expectedRaw: {
    sha256: string;
    bytes: number;
  };
  rawArtifact?: ReplayArtifactPointer;
  canonicalArtifact?: ReplayArtifactPointer;
  processingGeneration?: string;
  failure?: {
    code: string;
    message: string;
  } | null;
  capturedAt?: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  rawUploadedAt?: unknown;
  processedAt?: unknown;
};

export type ReplaySummary = {
  replayId: string;
  captureId?: string;
  visibility: ReplayVisibility;
  status: ReplayStatus;
  title: string;
  platform: string;
  roomCode?: string;
  messageCount: number | null;
  listing?: ReplayListingMetadata;
  capturedAt?: string;
  createdAt: string;
  updatedAt: string;
  failure?: {
    code: string;
    message: string;
  };
};
