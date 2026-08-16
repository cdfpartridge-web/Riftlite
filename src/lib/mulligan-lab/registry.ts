import registryData from "@/lib/mulligan-lab/card-registry-v1.json";
import type { ObservedMulliganCandidate } from "@/lib/mulligan-lab/aggregate";

export type MulliganRegistryCard = {
  basePrintId: string;
  name: string;
  type: string;
  supertype: string | null;
  costEnergy: number | null;
  costPower: number | null;
};

const registry = registryData.cards as Record<string, MulliganRegistryCard>;
const FORBIDDEN_DECK_TYPES = new Set(["legend", "battlefield", "rune"]);

export function mulliganCardIdentity(cardCode: string): string | null {
  return registry[cardCode]?.basePrintId ?? null;
}

export function mulliganCardMetadata(cardCode: string): MulliganRegistryCard | null {
  return registry[cardCode] ?? null;
}

/** Resolves only a unique packaged name/type match; ambiguous names fail closed. */
export function mulliganCardByName(name: string, requiredType?: string): { cardCode: string; card: MulliganRegistryCard } | null {
  const normalized = name.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
  if (!normalized) return null;
  const matches = Object.entries(registry).filter(([, card]) => (
    card.name.trim().toLocaleLowerCase("en").replace(/\s+/g, " ") === normalized &&
    (!requiredType || card.type.toLocaleLowerCase("en") === requiredType.toLocaleLowerCase("en"))
  ));
  if (matches.length !== 1) return null;
  return { cardCode: matches[0]![0], card: matches[0]![1] };
}

export const MULLIGAN_CARD_REGISTRY_METADATA = Object.freeze({
  generatedAt: registryData.generatedAt,
  prints: registryData.sourceRegistryPrints,
});

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
  const playerBattlefield = candidate.battlefields?.player
    ? canonicalRegistryCard(candidate.battlefields.player.cardCode, "battlefield")
    : null;
  const opponentBattlefield = candidate.battlefields?.opponent
    ? canonicalRegistryCard(candidate.battlefields.opponent.cardCode, "battlefield")
    : null;
  const mainDeck = candidate.deck.mainDeck.map((card) => {
    const registered = registry[card.cardCode];
    return registered && !FORBIDDEN_DECK_TYPES.has(registered.type.toLowerCase())
      ? { cardCode: card.cardCode, name: registered.name, count: card.count }
      : null;
  });
  if (
    !playerLegend ||
    !opponentLegend ||
    hand.some((card) => !card) ||
    mainDeck.some((card) => !card) ||
    (candidate.battlefields?.player && !playerBattlefield) ||
    (candidate.battlefields?.opponent && !opponentBattlefield)
  ) {
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
    battlefields: candidate.battlefields
      ? { player: playerBattlefield, opponent: opponentBattlefield }
      : undefined,
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
