const CASTER_REPLAY_ID_PATTERN = /^rl2_[a-f0-9]{32}$/;

/**
 * Accepts a canonical replay id or a RiftLite link containing one. Keeping
 * this parser client-safe lets the library validate pasted links before it
 * changes route while the API remains the final authorization boundary.
 */
export function parseCasterReplayReference(value: string): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;

  const decoded = safeDecodeURIComponent(trimmed);
  if (CASTER_REPLAY_ID_PATTERN.test(decoded.toLowerCase())) {
    return decoded.toLowerCase();
  }

  const match = decoded.match(/(?:^|[^a-z0-9_])(rl2_[a-f0-9]{32})(?=$|[^a-z0-9_])/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function isCasterReplayId(value: string): boolean {
  return CASTER_REPLAY_ID_PATTERN.test(value);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
