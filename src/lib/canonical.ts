export type CanonicalAliasMap = Readonly<Record<string, string>>;
export type CanonicalChoiceList = readonly string[];

export function canonicalChoice(
  value: string,
  options: CanonicalChoiceList,
  aliases: CanonicalAliasMap = {},
): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  const exact = options.find((option) => option.toLowerCase() === lower);
  if (exact) return exact;

  const slug = slugChoice(trimmed);
  const alias = aliases[slug];
  if (alias && options.includes(alias)) return alias;

  return options.find((option) => slugChoice(option) === slug) ?? "";
}

export function hasInvalidChoice(
  value: string,
  options: CanonicalChoiceList,
  aliases: CanonicalAliasMap = {},
): boolean {
  return Boolean(value.trim()) && !canonicalChoice(value, options, aliases);
}

function slugChoice(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
