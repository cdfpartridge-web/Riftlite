import { describe, expect, it } from "vitest";

import { mulliganDeckFingerprint } from "@/lib/mulligan-lab/aggregate";
import registryData from "@/lib/mulligan-lab/card-registry-v1.json";
import {
  buildStoredMulliganFact,
  ineligibleMulliganFactMarker,
  isCurrentMulliganFact,
  storedMulliganFactCandidate,
} from "@/lib/mulligan-lab/facts";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";

describe("Mulligan Lab anonymous fact documents", () => {
  it("restores only a current, legal, fingerprinted fact", () => {
    const fact = eligibleFact();
    expect(storedMulliganFactCandidate(fact)).toMatchObject({
      contributorKey: "a".repeat(64),
      matchup: { playerLegend: { cardCode: fact.matchup.playerLegend.cardCode } },
      hand: fact.hand,
    });

    expect(storedMulliganFactCandidate({ ...fact, deck: { ...fact.deck, fingerprint: "0".repeat(64) } }))
      .toBeNull();
  });

  it("recognizes a current ineligible marker without inventing a candidate", () => {
    const marker = ineligibleMulliganFactMarker();
    expect(isCurrentMulliganFact(marker)).toBe(true);
    expect(storedMulliganFactCandidate(marker)).toBeNull();
  });

  it("excludes combined dual-perspective replays so source matches are not double-counted", () => {
    const combined = {
      collaboration: {
        schema: "riftlite-dual-perspective",
        version: 1,
        mode: "dual-perspective",
      },
    } as CanonicalReplayV2;
    expect(buildStoredMulliganFact(combined, "owner-private-id")).toBeNull();
  });

  it("fails closed without breaking replay completion when a legacy replay is malformed", () => {
    const malformed = {
      schema: "riftlite-canonical-replay",
      version: 2,
    } as CanonicalReplayV2;
    expect(() => buildStoredMulliganFact(malformed, "owner-private-id")).not.toThrow();
    expect(buildStoredMulliganFact(malformed, "owner-private-id")).toBeNull();
  });
});

function eligibleFact() {
  const cards = registryData.cards as Record<string, { name: string; type: string }>;
  const playable = Object.entries(cards)
    .filter(([, card]) => !["legend", "battlefield", "rune"].includes(card.type.toLowerCase()))
    .slice(0, 14)
    .map(([cardCode, card], index) => ({ cardCode, name: card.name, count: index < 12 ? 3 : 2 }));
  const legends = Object.entries(cards)
    .filter(([, card]) => card.type.toLowerCase() === "legend")
    .slice(0, 2)
    .map(([cardCode, card]) => ({ cardCode, name: card.name }));
  return {
    schema: "riftlite-mulligan-fact" as const,
    version: 1 as const,
    status: "eligible" as const,
    contributorHash: "a".repeat(64),
    observedHandId: `mh1_${"1".repeat(32)}`,
    observation: {
      provider: "atlas" as const,
      matchKey: `mm1_${"2".repeat(32)}`,
      gameNumber: 1 as const,
      eventKey: `me1_${"3".repeat(32)}`,
      observedOn: "2026-08-12",
    },
    matchup: { playerLegend: legends[0], opponentLegend: legends[1] },
    initiative: "first" as const,
    hand: playable.slice(0, 4).map(({ cardCode, name }) => ({ cardCode, name })),
    redrawnCardIndexes: [1],
    wonGame: true,
    deck: { fingerprint: mulliganDeckFingerprint(playable), mainDeck: playable },
  };
}
