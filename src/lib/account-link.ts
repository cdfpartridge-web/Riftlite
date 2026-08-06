export type DesktopLinkIdentity = {
  uid: string;
  email: string;
  displayName: string;
  handle: string;
};

export function shouldAutomaticallyFinishAccountAction(
  desktopLink: boolean,
  profileComplete: boolean,
  activeUid: string,
  completedUid: string,
): boolean {
  return !desktopLink && profileComplete && Boolean(activeUid) && activeUid !== completedUid;
}

export function accountIdentityLabel(identity: DesktopLinkIdentity): string {
  const handle = identity.handle.trim();
  const displayName = identity.displayName.trim();
  if (displayName && handle) return `${displayName} (@${handle})`;
  if (handle) return `@${handle}`;
  return displayName || identity.email.trim() || "this RiftLite account";
}

export function accountIdHint(uid: string): string {
  const clean = uid.trim();
  if (clean.length <= 10) return clean;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

export function discordAccountRecoveryUrl(sessionId: string, code: string): string {
  const query = new URLSearchParams({ session: sessionId, code });
  return `/api/auth/discord/start?${query}`;
}

export function desktopLinkAllowsIdentity(expectedUid: string, selectedUid: string): boolean {
  const expected = expectedUid.trim();
  const selected = selectedUid.trim();
  return Boolean(selected && (!expected || expected === selected));
}

export function desktopLinkSignInIsVerified(decoded: {
  email_verified?: unknown;
  firebase?: { sign_in_provider?: unknown };
} | null | undefined): boolean {
  const provider = String(decoded?.firebase?.sign_in_provider ?? "").trim().toLowerCase();
  return provider !== "password" || decoded?.email_verified === true;
}

/**
 * Selects the account a new desktop-link session must reconnect to. A raw
 * anonymous token can already resolve to a durable account through an identity
 * alias, even though its provider claims still look anonymous. In that case the
 * canonicalized authenticated UID is the strongest pin available.
 */
export function desktopLinkPinnedExpectedUid(
  authenticatedUid: unknown,
  canonicalAuthenticatedUid: unknown,
  durableUid: unknown,
  requestedUid: unknown,
): string {
  const authenticated = String(authenticatedUid ?? "").trim();
  const canonical = String(canonicalAuthenticatedUid ?? "").trim();
  const durable = String(durableUid ?? "").trim();
  const requested = String(requestedUid ?? "").trim();
  if (durable) return durable;
  if (authenticated && canonical && authenticated !== canonical) return canonical;
  return requested;
}

/**
 * Identifies the one legacy shape that is an account upgrade rather than an
 * account switch. Older desktop builds could copy their anonymous Firebase UID
 * into `accountUid`, so they later sent that same UID as a reconnect pin. Only
 * the verified anonymous token itself may release that self-pin; durable
 * identities and server-canonicalized aliases remain pinned above this layer.
 */
export function desktopLinkAnonymousAdoptionSourceUid(
  authenticatedUid: unknown,
  canonicalAuthenticatedUid: unknown,
  durableUid: unknown,
  requestedUid: unknown,
  signInProvider: unknown,
): string {
  const authenticated = String(authenticatedUid ?? "").trim();
  const canonical = String(canonicalAuthenticatedUid ?? "").trim();
  const durable = String(durableUid ?? "").trim();
  const requested = String(requestedUid ?? "").trim();
  const provider = String(signInProvider ?? "").trim().toLowerCase();
  if (provider !== "anonymous" || durable) return "";
  return authenticated && authenticated === canonical && requested === authenticated
    ? authenticated
    : "";
}

/**
 * Resolve whether an already-verified request represents a recoverable
 * RiftLite account. Provider claims are the normal proof. A raw Firebase UID
 * that the server canonicalized to a different UID is also valid because that
 * redirect can only come from RiftLite's server-owned immutable identity
 * records. An unassociated anonymous UID still returns an empty string.
 */
export function linkedAccountUidFromCanonicalizedAuth(
  authenticatedUid: unknown,
  canonicalUid: unknown,
  durableUid: unknown,
): string {
  const authenticated = String(authenticatedUid ?? "").trim();
  const canonical = String(canonicalUid ?? "").trim();
  const durable = String(durableUid ?? "").trim();
  if (durable) return durable;
  return authenticated && canonical && authenticated !== canonical ? canonical : "";
}

/**
 * Returns the existing canonical UID that would make a source-identity bind
 * unsafe. Both records are considered because older releases could have only
 * one of them. An empty result means the requested bind is new or idempotent.
 */
export function conflictingLinkedIdentityCanonicalUid(
  requestedCanonicalUid: unknown,
  aliasCanonicalUid: unknown,
  userCanonicalUid: unknown,
): string {
  const requested = String(requestedCanonicalUid ?? "").trim();
  const existing = [aliasCanonicalUid, userCanonicalUid]
    .map((value) => String(value ?? "").trim())
    .find((value) => Boolean(value) && value !== requested);
  return existing ?? "";
}

/**
 * A link session belongs to the Firebase identity that created it. New
 * sessions store that raw authenticated UID so another device alias cannot
 * take over its token. The canonical form is accepted only for sessions
 * written by older website versions, which stored the canonical UID instead.
 */
export function desktopLinkSessionOwnedBy(
  storedDesktopUid: unknown,
  authenticatedUid: unknown,
  canonicalAuthenticatedUid: unknown,
  bindingVersion?: unknown,
): boolean {
  const owner = String(storedDesktopUid ?? "").trim();
  const authenticated = String(authenticatedUid ?? "").trim();
  const canonical = String(canonicalAuthenticatedUid ?? "").trim();
  if (Number(bindingVersion ?? 0) >= 2) {
    return Boolean(owner && authenticated && owner === authenticated);
  }
  return Boolean(owner && authenticated && (owner === authenticated || owner === canonical));
}

export function desktopLinkCanReissueToken(
  status: unknown,
  linkedUid: unknown,
  expiresAt: unknown,
  now = Date.now(),
): boolean {
  const expiry = Number(expiresAt ?? 0);
  return status === "complete" &&
    Boolean(String(linkedUid ?? "").trim()) &&
    Number.isFinite(expiry) &&
    expiry >= now;
}
