import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  localTcgaReplayPath,
  localTcgaReplayPreviewEnabled,
  readLocalTcgaCanonicalReplay,
} from "@/lib/local-tcga-replay-preview";

describe("local TCGA replay preview", () => {
  it("is disabled in production and requires an explicit fixture directory", () => {
    expect(localTcgaReplayPreviewEnabled({ NODE_ENV: "production", RIFTLITE_LOCAL_TCGA_REPLAY_DIR: "C:/fixtures" })).toBe(false);
    expect(localTcgaReplayPreviewEnabled({ NODE_ENV: "development", RIFTLITE_LOCAL_TCGA_REPLAY_DIR: "" })).toBe(false);
    expect(localTcgaReplayPreviewEnabled({ NODE_ENV: "development", RIFTLITE_LOCAL_TCGA_REPLAY_DIR: "C:/fixtures" })).toBe(true);
  });

  it("accepts only a simple fixture id beneath the configured directory", () => {
    expect(localTcgaReplayPath("akali-vs-irelia", "C:/fixtures")).toMatch(/akali-vs-irelia\.json$/);
    expect(() => localTcgaReplayPath("../private", "C:/fixtures")).toThrow(/invalid/i);
    expect(() => localTcgaReplayPath("Akali", "C:/fixtures")).toThrow(/invalid/i);
  });

  it("loads only Canonical Replay V2 JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-tcga-preview-"));
    const valid = Buffer.from(JSON.stringify({ schema: "riftlite-canonical-replay", version: 2, id: "fixture" }));
    await writeFile(join(directory, "valid.json"), valid);
    await writeFile(join(directory, "invalid.json"), JSON.stringify({ schema: "other", version: 1 }));

    await expect(readLocalTcgaCanonicalReplay("valid", directory)).resolves.toEqual(valid);
    await expect(readLocalTcgaCanonicalReplay("invalid", directory)).rejects.toThrow(/Canonical Replay V2/i);
  });
});
