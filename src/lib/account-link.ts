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

export function desktopLinkAllowsIdentity(expectedUid: string, selectedUid: string): boolean {
  const expected = expectedUid.trim();
  const selected = selectedUid.trim();
  return Boolean(selected && (!expected || expected === selected));
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
