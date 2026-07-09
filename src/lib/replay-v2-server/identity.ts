type ReplayDecodedToken = {
  uid?: unknown;
  firebase?: {
    sign_in_provider?: unknown;
  };
} | null | undefined;

export function linkedReplayUid(decoded: ReplayDecodedToken): string {
  const uid = typeof decoded?.uid === "string" ? decoded.uid.trim() : "";
  const provider = typeof decoded?.firebase?.sign_in_provider === "string"
    ? decoded.firebase.sign_in_provider.trim().toLowerCase()
    : "";
  if (!uid || !provider || provider === "anonymous") return "";
  return uid;
}
