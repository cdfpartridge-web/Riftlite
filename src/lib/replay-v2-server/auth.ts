import "server-only";

import { verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { ReplayV2Error } from "@/lib/replay-v2-server/errors";
import { linkedReplayUid } from "@/lib/replay-v2-server/identity";
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
    const uid = linkedReplayUid(decoded);
    if (uid) return uid;
  }
  return replayEmbedUidFromCookie(request);
}

export async function requireFirebaseBearerUser(request: Request): Promise<string> {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  const token = match?.[1]?.trim() ?? "";
  const decoded = token ? await verifyFirebaseIdToken(token) : null;
  const uid = linkedReplayUid(decoded);
  if (!uid) {
    throw new ReplayV2Error(401, "authentication_required", "A linked RiftLite account token is required.");
  }
  return uid;
}
