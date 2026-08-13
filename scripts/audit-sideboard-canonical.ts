import { readFile } from "node:fs/promises";

import { auditObservedSideboardDecisions } from "../src/lib/sideboard-lab/extract";
import type { CanonicalReplayV2 } from "../src/lib/replay-v2";

async function main() {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.error("Usage: npm run sideboard:audit -- <canonical-replay.json> [...]");
    process.exitCode = 1;
    return;
  }

  let eligibleReplays = 0;
  let eligibleDecisions = 0;
  let rejected = 0;
  let unreadable = 0;
  const rejectionReasons = new Map<string, number>();

  for (const [index, path] of paths.entries()) {
    try {
      const replay = JSON.parse(await readFile(path, "utf8")) as CanonicalReplayV2;
      // This audit-only key is local and never emitted. Production uses a
      // private owner-derived contributor key for balanced aggregation.
      const audit = auditObservedSideboardDecisions(replay, `local-audit-${index}`);
      const decisions = audit.candidates;
      if (!decisions.length) {
        rejected += 1;
        const reason = audit.rejection?.code ?? "unknown_rejection";
        rejectionReasons.set(reason, (rejectionReasons.get(reason) ?? 0) + 1);
        const details = audit.rejection?.details
          ? ` ${JSON.stringify(audit.rejection.details)}`
          : "";
        console.log(`${path}: rejected (${reason})${details}`);
        continue;
      }

      eligibleReplays += 1;
      eligibleDecisions += decisions.length;
      for (const decision of decisions) {
        const priorResult = decision.observation.priorGameWon ? "won" : "lost";
        const movedIn = decision.cardsIn.reduce((sum, card) => sum + card.count, 0);
        const movedOut = decision.cardsOut.reduce((sum, card) => sum + card.count, 0);
        console.log(
          `${path}: eligible (${decision.matchup.playerLegend.cardCode} vs ${decision.matchup.opponentLegend.cardCode}, ` +
          `Game 1 ${priorResult}, Game 2, ${movedIn} in/${movedOut} out)`,
        );
      }
    } catch (error) {
      unreadable += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${path}: unreadable (${message})`);
    }
  }

  console.log(JSON.stringify({
    scanned: paths.length,
    eligibleReplays,
    eligibleDecisions,
    rejected,
    unreadable,
    rejectionReasons: Object.fromEntries([...rejectionReasons].sort(([left], [right]) => (
      left.localeCompare(right)
    ))),
  }));
}

void main();
