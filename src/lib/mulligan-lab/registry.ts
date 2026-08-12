import registryData from "@/lib/mulligan-lab/card-registry-v1.json";
import type { ObservedMulliganCandidate } from "@/lib/mulligan-lab/aggregate";

type RegistryCard = { name: string; type: string };

const registry = registryData.cards as Record<string, RegistryCard>;
const FORBIDDEN_DECK_TYPES = new Set(["legend", "battlefield", "rune"]);

/**
 * Resolves observed card codes to the same canonical identities shipped in the
 * desktop registry. Atlas sometimes emits a shortened display name for a
 * valid print (for example OGS-019 omits its "(Starter)" suffix), so the exact
 * registry code is authoritative and the outbound name is normalized here.
 * Artwork remains a desktop concern: the API returns no arbitrary image URL,
 * and the client resolves the validated print id to its packaged Riot art.
 */
export function canonicalizeCandidateWithPackagedRegistry(
  candidate: ObservedMulliganCandidate,
): ObservedMulliganCandidate | null {
  const playerLegend = canonicalRegistryCard(candidate.matchup.playerLegend.cardCode, "legend");
  const opponentLegend = canonicalRegistryCard(candidate.matchup.opponentLegend.cardCode, "legend");
  const hand = candidate.hand.map((card) => canonicalRegistryCard(card.cardCode));
  const mainDeck = candidate.deck.mainDeck.map((card) => {
    const registered = registry[card.cardCode];
    return registered && !FORBIDDEN_DECK_TYPES.has(registered.type.toLowerCase())
      ? { cardCode: card.cardCode, name: registered.name, count: card.count }
      : null;
  });
  if (!playerLegend || !opponentLegend || hand.some((card) => !card) || mainDeck.some((card) => !card)) {
    return null;
  }
  return {
    ...candidate,
    matchup: { playerLegend, opponentLegend },
    hand: hand as ObservedMulliganCandidate["hand"],
    deck: {
      ...candidate.deck,
      mainDeck: mainDeck as ObservedMulliganCandidate["deck"]["mainDeck"],
    },
  };
}

function canonicalRegistryCard(
  cardCode: string,
  requiredType?: string,
): { cardCode: string; name: string } | null {
  const registered = registry[cardCode];
  if (!registered || (requiredType && registered.type.toLowerCase() !== requiredType)) return null;
  return { cardCode, name: registered.name };
}
