import { type NextRequest } from "next/server";

import { lfgFromDoc, requireLinkedProfile, socialJson } from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ listingId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;

  const { listingId } = await params;
  const ref = auth.db.collection("lfgListings").doc(listingId);
  const snap = await ref.get();
  if (!snap.exists) return socialJson({ error: "LFG post not found." }, 404);

  const data = snap.data() ?? {};
  const listing = lfgFromDoc(snap.id, data);
  const now = Date.now();
  if (listing.uid === auth.decoded.uid) {
    return socialJson({ error: "You cannot accept your own LFG post." }, 400);
  }
  if (listing.status !== "active" || listing.expiresAt <= now) {
    return socialJson({ error: "This LFG post is no longer active." }, 409);
  }

  const patch = {
    status: "matched",
    acceptedByUid: auth.decoded.uid,
    acceptedByHandle: auth.profile.handle,
    acceptedByDisplayName: auth.displayName,
    acceptedAt: now,
    updatedAt: now
  };
  await ref.set(patch, { merge: true });
  return socialJson({ ok: true, listing: lfgFromDoc(listingId, { ...data, ...patch }) });
}
