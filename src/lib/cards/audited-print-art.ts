import catalog from "./audited-print-art.json";

interface AuditedPrintArt {
  imageUrl: string;
}

const cards = catalog.cards as Record<string, AuditedPrintArt>;
const imageUrlAliasesByPrintId = catalog.imageUrlAliasesByPrintId as Record<string, string[]>;

export function auditedPrintImageUrl(code: string | undefined): string | undefined {
  return code ? cards[code.toUpperCase().replace(/\*$/, "S")]?.imageUrl : undefined;
}

/** Event artwork can share a printed collector ID with a regular card. */
export function auditedCapturedImageUrl(code: string | undefined, captured: string | undefined): string | undefined {
  if (!code || !captured) return undefined;
  const aliases = imageUrlAliasesByPrintId[code.toUpperCase().replace(/\*$/, "S")];
  const capturedIdentity = imageIdentity(captured);
  if (!aliases || !capturedIdentity) return undefined;
  return aliases.find((alias) => imageIdentity(alias) === capturedIdentity);
}

function imageIdentity(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}
