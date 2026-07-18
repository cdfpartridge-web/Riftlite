type ReplayDecodedToken = {
  uid?: unknown;
  email_verified?: unknown;
  riftlite_linked_account?: unknown;
  firebase?: {
    identities?: unknown;
    sign_in_provider?: unknown;
  };
} | null | undefined;

export function linkedReplayUid(decoded: ReplayDecodedToken): string {
  const uid = typeof decoded?.uid === "string" ? decoded.uid.trim() : "";
  if (uid && decoded?.riftlite_linked_account === true) return uid;
  return uid && hasDurableLinkedIdentity(decoded?.firebase?.identities, decoded?.email_verified === true) ? uid : "";
}

function hasDurableLinkedIdentity(value: unknown, emailVerified: boolean): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).some(([provider, identities]) => {
    const normalizedProvider = provider.trim().toLowerCase();
    if (!normalizedProvider || normalizedProvider === "anonymous" || !Array.isArray(identities)) {
      return false;
    }
    if ((normalizedProvider === "email" || normalizedProvider === "password") && !emailVerified) {
      return false;
    }
    return identities.some((identity) => typeof identity === "string" && Boolean(identity.trim()));
  });
}
