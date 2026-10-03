import type { ReplayCardState } from "@/lib/replay-v2";

/** Private identity alone is not evidence that the opponent revealed a card. */
export function isExplicitlyRevealedHandCard(card: ReplayCardState): boolean {
  return card.fields.revealedToOpponent === true &&
    !card.isPlaceholder &&
    Boolean(card.cardCode?.trim() || card.name?.trim());
}
