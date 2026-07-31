type ReplayDecodedToken = {
  uid?: unknown;
  email_verified?: unknown;
  riftlite_linked_account?: unknown;
  firebase?: {
    identities?: unknown;
    sign_in_provider?: unknown;
  };
} | null | undefined;

type ReplayIdentityAssociation = {
  sourceUid?: unknown;
  canonicalUid?: unknown;
} | null | undefined;

export function linkedReplayUid(decoded: ReplayDecodedToken): string {
  const uid = typeof decoded?.uid === "string" ? decoded.uid.trim() : "";
  if (uid && decoded?.riftlite_linked_account === true) return uid;
  return uid && hasDurableLinkedIdentity(decoded?.firebase?.identities, decoded?.email_verified === true) ? uid : "";
}

/**
 * Accepts a Firebase credential that has already been bound by RiftLite's
 * server-owned identityAliases collection. Historical desktop aliases may be
 * anonymous, while refreshed custom-token sessions may omit provider metadata;
 * neither is trusted without an exact immutable association.
 */
export function serverAssociatedReplayUid(
  decoded: ReplayDecodedToken,
  association: ReplayIdentityAssociation,
): string {
  const direct = linkedReplayUid(decoded);
  if (direct) return direct;

  const uid = typeof decoded?.uid === "string" ? decoded.uid.trim() : "";
  const sourceUid = typeof association?.sourceUid === "string" ? association.sourceUid.trim() : "";
  const canonicalUid = typeof association?.canonicalUid === "string" ? association.canonicalUid.trim() : "";
  if (!uid || sourceUid !== uid || !canonicalUid) return "";

  if (canonicalUid !== uid) {
    return canonicalUid;
  }
  const signInProvider = typeof decoded?.firebase?.sign_in_provider === "string"
    ? decoded.firebase.sign_in_provider.trim().toLowerCase()
    : "";
  return signInProvider === "custom" ? uid : "";
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
