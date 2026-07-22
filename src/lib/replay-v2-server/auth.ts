import "server-only";

import { getFirestoreAdmin, verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { canonicalIdentityUid } from "@/lib/identity-server";
import { ReplayV2Error } from "@/lib/replay-v2-server/errors";
import { linkedReplayUid, serverAssociatedReplayUid } from "@/lib/replay-v2-server/identity";
import { replayEmbedUidFromCookie } from "@/lib/replay-v2-server/session";

export async function requireReplayUser(request: Request): Promise<string> {
  return requireFirebaseBearerUser(request);
}

export async function requireReplayViewerUser(request: Request): Promise<string> {
  const uid = await optionalReplayUser(request);
  if (!uid) {
    throw new ReplayV2Error(401, "authentication_required", "A linked RiftLite account session is required.");
  }
  return uid;
}

export async function optionalReplayUser(request: Request): Promise<string> {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  const token = match?.[1]?.trim() ?? "";
  if (token) {
    const decoded = await verifyFirebaseIdToken(token);
    const uid = await verifiedRecoverableAccountUid(decoded);
    if (uid) return uid;
  }
  const cookieUid = replayEmbedUidFromCookie(request);
  return cookieUid ? canonicalIdentityUid(cookieUid) : "";
}

export async function requireFirebaseBearerUser(request: Request): Promise<string> {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  const token = match?.[1]?.trim() ?? "";
  if (!token) {
    throw new ReplayV2Error(401, "authentication_required", "A linked RiftLite account token is required.");
  }
  const decoded = await verifyFirebaseIdToken(token);
  if (!decoded) {
    throw new ReplayV2Error(401, "authentication_required", "The linked RiftLite account token is invalid or expired. Reconnect this device and retry.");
  }
  const uid = await verifiedRecoverableAccountUid(decoded);
  if (!uid) {
    throw new ReplayV2Error(401, "authentication_required", "This device credential is not linked to a recoverable RiftLite account. Finish account verification and retry.");
  }
  return uid;
}

export async function verifiedRecoverableAccountUid(
  decoded: Awaited<ReturnType<typeof verifyFirebaseIdToken>>,
): Promise<string> {
  const directlyLinkedUid = linkedReplayUid(decoded);
  if (directlyLinkedUid) return canonicalIdentityUid(directlyLinkedUid);

  const authenticatedUid = String(decoded?.uid ?? "").trim();
  const db = authenticatedUid ? getFirestoreAdmin() : null;
  if (!authenticatedUid || !db) return "";
  const association = await db.collection("identityAliases").doc(authenticatedUid).get().catch(() => null);
  const associatedUid = serverAssociatedReplayUid(decoded, association?.data() ?? null);
  return associatedUid ? canonicalIdentityUid(associatedUid, db) : "";
}
