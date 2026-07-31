import { constants as fileConstants } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  LOCAL_TCGA_FIXTURE_ID_PATTERN,
  localTcgaReplayPath,
} from "@/lib/local-tcga-replay-preview";
import {
  MAX_CANONICAL_GZIP_BYTES,
  MAX_CANONICAL_JSON_BYTES,
  MAX_RAW_GZIP_BYTES,
  MAX_RAW_JSON_BYTES,
} from "@/lib/replay-v2-server/constants";
import { canonicalStringify } from "@/lib/replay-v2/json";
import { assessReplayPublicationQuality } from "@/lib/replay-v2/replay-quality";
import {
  inspectTcgaCanonicalReplay,
  normalizeParsedTcgaReplayRawCaptureV1,
  parseTcgaReplayRawCaptureV1,
  type TcgaReplayRawCaptureV1,
} from "@/lib/replay-v2/tcga";
import type { CanonicalReplayV2 } from "@/lib/replay-v2/types";

export type LocalTcgaPreviewBuildReport = {
  fixtureId: string;
  previewPath: string;
  outputPath: string;
  replayId: string;
  canonicalBytes: number;
  canonicalGzipBytes: number;
  events: number;
  checkpoints: number;
  unchanged: boolean;
};

export type LocalTcgaPreviewArtifact = {
  replay: CanonicalReplayV2;
  json: string;
  canonicalBytes: number;
  canonicalGzipBytes: number;
};

export type BuildLocalTcgaPreviewFileOptions = {
  inputPath: string;
  outputDirectory: string;
  fixtureId: string;
  force?: boolean;
};

export class LocalTcgaPreviewBuildError extends Error {
  constructor(
    readonly code:
      | "invalid_arguments"
      | "invalid_input"
      | "normalization_failed"
      | "quality_failed"
      | "privacy_failed"
      | "size_failed"
      | "output_exists",
    message: string,
  ) {
    super(message);
    this.name = "LocalTcgaPreviewBuildError";
  }
}

/**
 * Builds the exact JSON consumed by the localhost-only preview route. This
 * module has no HTTP client, upload, Firebase, Vercel, or deployment path.
 */
export function buildLocalTcgaPreviewArtifact(input: unknown): LocalTcgaPreviewArtifact {
  let raw: TcgaReplayRawCaptureV1;
  let replay: CanonicalReplayV2;
  try {
    raw = parseTcgaReplayRawCaptureV1(input);
    replay = normalizeParsedTcgaReplayRawCaptureV1(raw);
  } catch {
    throw new LocalTcgaPreviewBuildError(
      "normalization_failed",
      "The input could not be normalized as a TCGA replay capture.",
    );
  }

  verifyLocalTcgaPreviewReplay(raw, replay);
  const json = `${canonicalStringify(replay)}\n`;
  const canonicalBytes = Buffer.byteLength(json, "utf8");
  const canonicalGzipBytes = gzipSync(json, { level: 9 }).byteLength;
  if (
    canonicalBytes < 1 ||
    canonicalBytes > MAX_CANONICAL_JSON_BYTES ||
    canonicalGzipBytes > MAX_CANONICAL_GZIP_BYTES
  ) {
    throw new LocalTcgaPreviewBuildError(
      "size_failed",
      "The canonical replay exceeds the Replay V2 publication size limits.",
    );
  }

  return { replay, json, canonicalBytes, canonicalGzipBytes };
}

export function verifyLocalTcgaPreviewReplay(
  raw: TcgaReplayRawCaptureV1,
  replay: CanonicalReplayV2,
): void {
  if (
    replay.schema !== "riftlite-canonical-replay" ||
    replay.version !== 2 ||
    replay.source.schema !== "riftlite-tcga-raw-capture"
  ) {
    throw new LocalTcgaPreviewBuildError(
      "quality_failed",
      "The normalizer did not produce a TCGA Canonical Replay V2 artifact.",
    );
  }

  const quality = assessReplayPublicationQuality(replay);
  if (!quality.publishable) {
    const codes = [...new Set(quality.issues.map((issue) => issue.code))].sort();
    throw new LocalTcgaPreviewBuildError(
      "quality_failed",
      `The replay failed publication quality checks: ${codes.join(", ")}.`,
    );
  }

  const verification = inspectTcgaCanonicalReplay(raw, replay);
  if (verification.integrityIssues.length) {
    throw new LocalTcgaPreviewBuildError(
      "quality_failed",
      `The replay failed deterministic timeline checks: ${verification.integrityIssues.join(", ")}.`,
    );
  }
  if (verification.privacyIssues.length) {
    throw new LocalTcgaPreviewBuildError(
      "privacy_failed",
      `The replay failed privacy checks: ${verification.privacyIssues.join(", ")}.`,
    );
  }
}

export async function readLocalTcgaRawCaptureFile(inputPath: string): Promise<unknown> {
  const resolved = resolveRequiredPath(inputPath, "input capture");
  const lower = resolved.toLowerCase();
  if (!lower.endsWith(".json") && !lower.endsWith(".json.gz")) {
    throw new LocalTcgaPreviewBuildError(
      "invalid_input",
      "The input capture must end in .json or .json.gz.",
    );
  }

  let info;
  try {
    info = await stat(resolved);
  } catch {
    throw new LocalTcgaPreviewBuildError("invalid_input", "The input capture does not exist.");
  }
  const compressed = lower.endsWith(".json.gz");
  const maximumInputBytes = compressed ? MAX_RAW_GZIP_BYTES : MAX_RAW_JSON_BYTES;
  if (!info.isFile() || info.size < 1 || info.size > maximumInputBytes) {
    throw new LocalTcgaPreviewBuildError(
      "size_failed",
      "The input capture exceeds the Replay V2 raw artifact size limits.",
    );
  }

  let jsonBytes: Buffer;
  try {
    const bytes = await readFile(resolved);
    jsonBytes = compressed
      ? gunzipSync(bytes, { maxOutputLength: MAX_RAW_JSON_BYTES })
      : bytes;
  } catch {
    throw new LocalTcgaPreviewBuildError(
      "invalid_input",
      "The input capture could not be read or decompressed.",
    );
  }
  if (jsonBytes.byteLength < 1 || jsonBytes.byteLength > MAX_RAW_JSON_BYTES) {
    throw new LocalTcgaPreviewBuildError(
      "size_failed",
      "The expanded input capture exceeds the Replay V2 raw JSON limit.",
    );
  }

  try {
    return JSON.parse(jsonBytes.toString("utf8").replace(/^\uFEFF/, "")) as unknown;
  } catch {
    throw new LocalTcgaPreviewBuildError("invalid_input", "The input capture is not valid JSON.");
  }
}

export async function buildLocalTcgaPreviewFile(
  options: BuildLocalTcgaPreviewFileOptions,
): Promise<LocalTcgaPreviewBuildReport> {
  const fixtureId = options.fixtureId.trim();
  if (!LOCAL_TCGA_FIXTURE_ID_PATTERN.test(fixtureId)) {
    throw new LocalTcgaPreviewBuildError(
      "invalid_arguments",
      "The fixture id must be a lowercase letter/number slug of at most 64 characters.",
    );
  }
  const outputDirectory = resolveRequiredPath(options.outputDirectory, "output directory");
  const input = await readLocalTcgaRawCaptureFile(options.inputPath);
  const artifact = buildLocalTcgaPreviewArtifact(input);

  await mkdir(outputDirectory, { recursive: true });
  const outputPath = localTcgaReplayPath(fixtureId, outputDirectory);
  const nextBytes = Buffer.from(artifact.json, "utf8");
  const existing = await readExistingFile(outputPath);
  if (existing?.equals(nextBytes)) {
    return reportForArtifact(fixtureId, outputPath, artifact, true);
  }
  if (existing && !options.force) {
    throw new LocalTcgaPreviewBuildError(
      "output_exists",
      "A different fixture already exists at the output path; pass --force to replace it.",
    );
  }

  const temporaryPath = resolve(
    outputDirectory,
    `.${fixtureId}.${process.pid}.${Date.now().toString(36)}.tmp`,
  );
  try {
    await writeFile(temporaryPath, nextBytes, { flag: "wx", mode: 0o600 });
    if (options.force) {
      await rename(temporaryPath, outputPath);
    } else {
      try {
        await copyFile(temporaryPath, outputPath, fileConstants.COPYFILE_EXCL);
      } catch (error) {
        if (isNodeError(error) && error.code === "EEXIST") {
          throw new LocalTcgaPreviewBuildError(
            "output_exists",
            "A fixture was created at the output path while this build was running.",
          );
        }
        throw error;
      }
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }

  return reportForArtifact(fixtureId, outputPath, artifact, false);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function resolveRequiredPath(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new LocalTcgaPreviewBuildError("invalid_arguments", `An explicit ${label} is required.`);
  }
  return resolve(trimmed);
}

async function readExistingFile(path: string): Promise<Buffer | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_CANONICAL_JSON_BYTES) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}

function reportForArtifact(
  fixtureId: string,
  outputPath: string,
  artifact: LocalTcgaPreviewArtifact,
  unchanged: boolean,
): LocalTcgaPreviewBuildReport {
  return {
    fixtureId,
    previewPath: `/replays/tcga/${encodeURIComponent(fixtureId)}`,
    outputPath,
    replayId: artifact.replay.id,
    canonicalBytes: artifact.canonicalBytes,
    canonicalGzipBytes: artifact.canonicalGzipBytes,
    events: artifact.replay.events.length,
    checkpoints: artifact.replay.checkpoints.length,
    unchanged,
  };
}

export function defaultFixtureIdForInput(inputPath: string): string {
  return basename(inputPath)
    .replace(/\.json(?:\.gz)?$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}
