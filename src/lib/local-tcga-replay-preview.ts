import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

export const MAX_LOCAL_TCGA_CANONICAL_BYTES = 32 * 1024 * 1024;
export const LOCAL_TCGA_FIXTURE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

type LocalTcgaReplayPreviewEnvironment = {
  NODE_ENV?: string;
  RIFTLITE_LOCAL_TCGA_REPLAY_DIR?: string;
};

export function localTcgaReplayPreviewEnabled(
  environment: LocalTcgaReplayPreviewEnvironment = process.env,
): boolean {
  return environment.NODE_ENV !== "production" && Boolean(environment.RIFTLITE_LOCAL_TCGA_REPLAY_DIR?.trim());
}

export function localTcgaReplayPath(fixtureId: string, directory: string): string {
  if (!LOCAL_TCGA_FIXTURE_ID_PATTERN.test(fixtureId)) {
    throw new Error("Invalid local TCGA replay fixture id.");
  }
  const root = resolve(directory);
  const candidate = resolve(root, `${fixtureId}.json`);
  const child = relative(root, candidate);
  if (!child || child.startsWith("..") || child.includes(":")) {
    throw new Error("Local TCGA replay fixture escaped its configured directory.");
  }
  return candidate;
}

export async function readLocalTcgaCanonicalReplay(
  fixtureId: string,
  directory: string,
): Promise<Uint8Array> {
  const path = localTcgaReplayPath(fixtureId, directory);
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > MAX_LOCAL_TCGA_CANONICAL_BYTES) {
    throw new Error("Local TCGA replay fixture has an invalid size.");
  }
  const bytes = await readFile(path);
  const parsed = JSON.parse(bytes.toString("utf8")) as { schema?: unknown; version?: unknown };
  if (parsed.schema !== "riftlite-canonical-replay" || parsed.version !== 2) {
    throw new Error("Local TCGA replay fixture is not Canonical Replay V2.");
  }
  return bytes;
}
