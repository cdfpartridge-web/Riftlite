import { readFile } from "node:fs/promises";

import { extractObservedMulligan } from "../src/lib/mulligan-lab/aggregate";
import { canonicalizeCandidateWithPackagedRegistry } from "../src/lib/mulligan-lab/registry";
import type { CanonicalReplayV2 } from "../src/lib/replay-v2";

async function main() {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.error("Usage: npm run mulligan:audit -- <canonical-replay.json> [...]");
    process.exitCode = 1;
    return;
  }
  let eligible = 0;
  let rejected = 0;
  for (const [index, path] of paths.entries()) {
    try {
      const replay = JSON.parse(await readFile(path, "utf8")) as CanonicalReplayV2;
      // The audit key is deliberately local and is never emitted. Production
      // aggregation supplies the replay owner's private uid for k-anonymity.
      const observed = extractObservedMulligan(replay, `local-audit-${index}`);
      const candidate = observed ? canonicalizeCandidateWithPackagedRegistry(observed) : null;
      if (!candidate) {
        rejected += 1;
        console.log(`${path}: rejected by strict observed-data gates`);
        continue;
      }
      eligible += 1;
      console.log(`${path}: eligible (${candidate.observation.provider}, ${candidate.matchup.playerLegend.cardCode} vs ${candidate.matchup.opponentLegend.cardCode}, ${candidate.initiative}, ${candidate.redrawnCardIndexes.length} redraws)`);
    } catch (error) {
      rejected += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${path}: unreadable (${message})`);
    }
  }
  console.log(JSON.stringify({ scanned: paths.length, eligible, rejected }));
}

void main();
