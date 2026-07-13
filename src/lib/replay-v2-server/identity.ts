type ReplayDecodedToken = {
  uid?: unknown;
  firebase?: {
    identities?: unknown;
    sign_in_provider?: unknown;
  };
} | null | undefined;

export function linkedReplayUid(decoded: ReplayDecodedToken): string {
  const uid = typeof decoded?.uid === "string" ? decoded.uid.trim() : "";
  return uid && hasDurableLinkedIdentity(decoded?.firebase?.identities) ? uid : "";
}

function hasDurableLinkedIdentity(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).some(([provider, identities]) => {
    const normalizedProvider = provider.trim().toLowerCase();
    if (!normalizedProvider || normalizedProvider === "anonymous" || !Array.isArray(identities)) {
      return false;
    }
    return identities.some((identity) => typeof identity === "string" && Boolean(identity.trim()));
  });
}
