import type { ReplayCardState } from "@/lib/replay-v2";

// Atlas's public label presets, checked 2026-10-08. These are recorded state,
// not keywords inferred from the card's printed rules or a player's intent.
const presets = {
  buff: "Buff",
  disarm: "Disarm",
  deflect: "Deflect",
  deathknell: "Deathknell",
  shield: "Shield",
  stunned: "Stunned",
  tank: "Tank",
  empowered: "Empowered",
  ganking: "Ganking",
  assault: "Assault",
  temporary: "Temporary",
} as const;

export type CardStatusKind = keyof typeof presets;
export type CardStatus = {
  kind: CardStatusKind | "custom";
  label: string;
  count?: number;
  /** Retained for custom-label inspection, including older replay artifacts. */
  sourceLabel?: string;
};

const counted = new Set<CardStatusKind>(["buff", "shield", "assault", "disarm", "empowered", "deflect"]);

export function cardStatuses(card: ReplayCardState | undefined): CardStatus[] {
  if (!card || card.isPlaceholder) return [];
  const result: CardStatus[] = [];
  const buff = card.fields.temporaryMightBuff;
  if (typeof buff === "number" && Number.isFinite(buff) && buff >= 1) {
    result.push({ kind: "buff", label: "Buff", count: Math.min(99, Math.trunc(buff)) });
  }
  if (!Array.isArray(card.fields.customLabels)) return result;
  for (const value of card.fields.customLabels) {
    if (typeof value !== "string" || !value.trim()) continue;
    const sourceLabel = value.trim();
    const text = sourceLabel.replace(/\s+/g, " ");
    const match = /^(.*?)(?:\s+(\d+))?$/.exec(text);
    const key = (match?.[1] ?? text).toLowerCase();
    if (Object.hasOwn(presets, key)) {
      const kind = key as CardStatusKind;
      if (counted.has(kind)) {
        result.push({ kind, label: presets[kind], count: Math.max(1, Math.min(99, Number(match?.[2] ?? 1))), sourceLabel });
        continue;
      }
      if (!match?.[2]) {
        result.push({ kind, label: presets[kind], sourceLabel });
        continue;
      }
    }
    result.push({ kind: "custom", label: sourceLabel, sourceLabel });
  }
  return result;
}

export function cardStatusText(status: CardStatus): string {
  return status.count === undefined ? status.label : `${status.label} ${status.count}`;
}
