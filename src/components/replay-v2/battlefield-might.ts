import atlasMightData from "@/lib/cards/atlas-might.json";
import type { ReplayCardState } from "@/lib/replay-v2";

type CatalogCard = { name: string; type: string; might?: number; text?: string };
type MightCatalog = {
  cards: Record<string, CatalogCard>;
  names: Record<string, string>;
  codeAliases: Record<string, string>;
};

const catalog = atlasMightData as MightCatalog;
const cardTypes = new Set(["battlefield", "card", "champion", "gear", "legend", "rune", "spell", "token", "unit"]);
const tokenMight: ReadonlyArray<readonly [string, number]> = [
  ["sandsoldier", 2], ["shadowclone", 0], ["reflection", 0], ["recruit", 1],
  ["sprite", 3], ["tentacle", 1], ["bird", 1], ["birb", 1], ["mech", 3],
];
const equipmentMight = /(?:^|[\n,.])\s*([+-]\d+)\s*(?:\[Might\]|Might)\s*[.!]?\s*$/i;
const flavorText = /^[\t ]*flavou?r text[\t \r]*$/imu;

export type BattlefieldMight = {
  total: number;
  unitCount: number;
  unknownCount: number;
};

/**
 * Matches Atlas's battlefield counter, checked 11 October 2026. Use the entire
 * current projected lane, before presentation grouping or truncation. White
 * counters already replace printed might and equipment; status labels and the
 * separate temporary buff indicator are not added by Atlas's total.
 */
export function totalBattlefieldMight(cards: readonly ReplayCardState[]): BattlefieldMight {
  const result: BattlefieldMight = { total: 0, unitCount: 0, unknownCount: 0 };
  const attachments = new Map<string, ReplayCardState[]>();
  for (const card of cards) {
    const hostId = card.fields.attachedToCardId;
    if (typeof hostId !== "string" || !hostId) continue;
    const children = attachments.get(hostId) ?? [];
    children.push(card);
    attachments.set(hostId, children);
  }
  for (const card of cards) {
    if (isHidden(card) || card.fields.attachedToCardId || !hasType(card, "unit")) continue;
    result.unitCount += 1;
    const whiteCounter = finiteNumber(card.fields.whiteCounter);
    const baseMight = whiteCounter === undefined ? printedMight(card) : Math.trunc(whiteCounter);
    if (baseMight === undefined) {
      result.unknownCount += 1;
      continue;
    }
    result.total += baseMight + (whiteCounter === undefined ? attachedMight(card, attachments.get(card.id) ?? []) : 0);
  }
  return result;
}

function isHidden(card: ReplayCardState): boolean {
  // Gameplay-hidden cards stay excluded even when their owner or a combined
  // replay knows their identity. Never resolve catalog data for placeholders.
  return Boolean(card.isPlaceholder || card.fields.isPlaceholder || card.fields.hidden);
}

function attachedMight(host: ReplayCardState, cards: readonly ReplayCardState[]): number {
  let total = 0;
  for (const card of cards) {
    if (card.fields.attachedToCardId !== host.id || isHidden(card) || !hasType(card, "gear")) continue;
    const capturedText = typeof card.fields.text === "string" ? card.fields.text.trim() : "";
    const text = capturedText || lookupCard(card)?.text || "";
    const rules = text.split(flavorText, 1)[0]?.trim() ?? "";
    const match = equipmentMight.exec(rules);
    if (match) total += Number(match[1]);
  }
  return total;
}

function printedMight(card: ReplayCardState): number | undefined {
  const captured = finiteNumber(card.fields.might);
  if (captured !== undefined) return captured;
  if (card.source === "token" || card.fields.source === "token") {
    const name = normalizedTokenName(card.name);
    return !name || name.includes("gold") ? undefined : tokenMight.find(([token]) => name.includes(token))?.[1];
  }
  return finiteNumber(lookupCard(card)?.might);
}

function hasType(card: ReplayCardState, type: "unit" | "gear"): boolean {
  const captured = typeof card.fields.type === "string" ? card.fields.type.trim() : "";
  if (card.source === "token" || card.fields.source === "token") {
    const name = normalizedTokenName(card.name);
    const fallback = !name ? "" : name === "bomb" || name === "bombtoken" || name.includes("gold") ? "Gear" : "Unit";
    return types(captured || fallback).includes(type);
  }
  return types(captured).includes(type) || types(lookupCard(card)?.type ?? "").includes(type);
}

function types(value: string): string[] {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return [];
  const words = normalized.split(/\s+/);
  return words.length > 1 && words.every((word) => cardTypes.has(word)) ? words : [normalized];
}

function lookupCard(card: ReplayCardState): CatalogCard | undefined {
  if (card.source === "token" || card.fields.source === "token") return undefined;
  const code = card.cardCode?.trim() ?? "";
  const direct = catalog.cards[code] ?? catalog.cards[catalog.codeAliases[code] ?? ""];
  if (direct) return direct;
  // Atlas permits a signature print suffix when only its base is in the catalog.
  const signatureBase = /^([A-Z]{2,4}-[A-Z]*\d+)S$/i.exec(code)?.[1]?.toUpperCase();
  const signature = signatureBase ? catalog.cards[signatureBase] ?? catalog.cards[catalog.codeAliases[signatureBase] ?? ""] : undefined;
  if (signature) return signature;
  const name = card.name.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return catalog.cards[catalog.names[name] ?? ""];
}

function normalizedTokenName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
