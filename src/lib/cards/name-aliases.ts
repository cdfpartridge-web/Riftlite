// Explicit compatibility names from audited previews. Collector codes and
// captured artwork remain authoritative when a replay supplies either.
export const CARD_NAME_CODE_ALIASES: Record<string, string> = {
  losttothesand: "RAD-013",
  losttothesands: "RAD-013",
  sanctumconservator: "RAD-030",
  "圣所保管员": "RAD-030",
  resourceextractor: "RAD-052",
  "资源开采器": "RAD-052",
  wrathofthefreljord: "RAD-077",
  "弗雷尔卓德之怒": "RAD-077",
  bushwhacktrap: "RAD-108",
  "伏击陷阱": "RAD-108",
};

export function cardCodeFromNameAlias(name: string): string | undefined {
  const key = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return Object.hasOwn(CARD_NAME_CODE_ALIASES, key) ? CARD_NAME_CODE_ALIASES[key] : undefined;
}
