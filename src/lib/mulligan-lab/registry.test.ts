import { describe, expect, it } from "vitest";

import {
  mulliganDeckFingerprint,
  type ObservedMulliganCandidate,
} from "@/lib/mulligan-lab/aggregate";
import { canonicalizeCandidateWithPackagedRegistry } from "@/lib/mulligan-lab/registry";

describe("Mulligan Lab packaged card registry", () => {
  it("uses an exact known code while normalizing Atlas display-name aliases", () => {
    const candidate = observedCandidate();
    candidate.matchup.playerLegend.name = "Master Yi, Wuju Bladesman";
    candidate.hand[0].name = "Atlas display alias";
    candidate.deck.mainDeck[0].name = "Atlas display alias";

    const canonical = canonicalizeCandidateWithPackagedRegistry(candidate);

    expect(canonical?.matchup.playerLegend).toEqual({
      cardCode: "OGS-019",
      name: "Master Yi, Wuju Bladesman (Starter)",
    });
    expect(canonical?.hand[0]).toEqual({ cardCode: "OGN-001", name: "Blazing Scorcher" });
    expect(canonical?.deck.mainDeck[0]).toMatchObject({
      cardCode: "OGN-001",
      name: "Blazing Scorcher",
    });
  });

  it("fails closed for an unknown print code", () => {
    const candidate = observedCandidate();
    candidate.hand[0].cardCode = "BAD-999";
    expect(canonicalizeCandidateWithPackagedRegistry(candidate)).toBeNull();
  });
});

function observedCandidate(): ObservedMulliganCandidate {
  const codes = [
    "OGN-001", "OGN-002", "OGN-003", "OGN-004", "OGN-005", "OGN-006", "OGN-008",
    "OGN-009", "OGN-010", "OGN-011", "OGN-012", "OGN-013", "OGN-014", "OGN-015",
  ];
  const mainDeck = codes.map((cardCode, index) => ({
    cardCode,
    name: `Observed alias ${index + 1}`,
    count: index < 12 ? 3 : 2,
  }));
  return {
    observedHandId: `mh1_${"1".repeat(32)}`,
    contributorKey: "internal-contributor",
    observation: {
      provider: "atlas",
      matchKey: `mm1_${"2".repeat(32)}`,
      gameNumber: 1,
      eventKey: `me1_${"3".repeat(32)}`,
      observedOn: "2026-08-12",
    },
    matchup: {
      playerLegend: { cardCode: "OGS-019", name: "Master Yi, Wuju Bladesman (Starter)" },
      opponentLegend: { cardCode: "VEN-145", name: "Nasus, Curator of the Sands" },
    },
    initiative: "first",
    hand: mainDeck.slice(0, 4).map(({ cardCode, name }) => ({ cardCode, name })),
    redrawnCardIndexes: [1],
    wonGame: true,
    deck: {
      fingerprint: mulliganDeckFingerprint(mainDeck),
      mainDeck,
    },
  };
}
