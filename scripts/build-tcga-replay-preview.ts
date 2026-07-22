#!/usr/bin/env node

import {
  buildLocalTcgaPreviewFile,
  defaultFixtureIdForInput,
  LocalTcgaPreviewBuildError,
} from "../src/lib/tcga-local-preview-builder";

type CliOptions = {
  inputPath: string;
  outputDirectory: string;
  fixtureId: string;
  force: boolean;
};

function parseArguments(values: string[]): CliOptions | "help" {
  if (values.length >= 2 && values.every((value) => !value.startsWith("--"))) {
    if (values.length > 4 || (values[3] && values[3] !== "force")) {
      throw new LocalTcgaPreviewBuildError(
        "invalid_arguments",
        "Positional usage is <input> <output-dir> [fixture-id] [force].",
      );
    }
    return {
      inputPath: values[0],
      outputDirectory: values[1],
      fixtureId: values[2] || defaultFixtureIdForInput(values[0]),
      force: values[3] === "force",
    };
  }
  const parsed = new Map<string, string>();
  let force = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help" || value === "-h") return "help";
    if (value === "--force") {
      force = true;
      continue;
    }
    if (!["--input", "--output-dir", "--fixture-id"].includes(value)) {
      throw new LocalTcgaPreviewBuildError("invalid_arguments", `Unknown option: ${value}`);
    }
    const next = values[index + 1]?.trim();
    if (!next || next.startsWith("--")) {
      throw new LocalTcgaPreviewBuildError("invalid_arguments", `${value} requires a value.`);
    }
    parsed.set(value, next);
    index += 1;
  }

  const inputPath = parsed.get("--input") ?? "";
  const outputDirectory = parsed.get("--output-dir") ?? "";
  if (!inputPath || !outputDirectory) {
    throw new LocalTcgaPreviewBuildError(
      "invalid_arguments",
      "Both --input and --output-dir are required.",
    );
  }
  return {
    inputPath,
    outputDirectory,
    fixtureId: parsed.get("--fixture-id") ?? defaultFixtureIdForInput(inputPath),
    force,
  };
}

function usage(): string {
  return [
    "Build a local-only Canonical Replay V2 fixture from a decoded TCGA capture.",
    "",
    "Usage:",
    "  npm run replay:tcga:preview -- <capture.json[.gz]> <output-dir> [fixture-id] [force]",
    "  tsx scripts/build-tcga-replay-preview.ts --input <capture.json[.gz]> --output-dir <directory> [--fixture-id <slug>] [--force]",
    "",
    "The command writes only <output-dir>/<fixture-id>.json. It never uploads or deploys.",
  ].join("\n");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = await buildLocalTcgaPreviewFile(options);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof LocalTcgaPreviewBuildError
    ? error.message
    : "The local TCGA preview build failed unexpectedly.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
