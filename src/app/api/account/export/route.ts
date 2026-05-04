import { type NextRequest } from "next/server";

import { ensureUserProfile, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const profile = await ensureUserProfile(auth.decoded.uid, auth.decoded.name ?? auth.decoded.email ?? "", auth.decoded.email ?? "");
  const [publicProfileSnap, aggregateSnap, memberSnaps] = await Promise.all([
    profile.handleLower ? auth.db.collection("publicProfiles").doc(profile.handleLower).get() : Promise.resolve(null),
    auth.db.collection("userAggregates").doc(auth.decoded.uid).get(),
    auth.db.collectionGroup("members").where("uid", "==", auth.decoded.uid).limit(100).get(),
  ]);

  const hubMemberships = memberSnaps.docs.map((doc) => {
    const hubId = doc.ref.parent.parent?.id ?? "";
    const data = doc.data();
    return {
      hubId,
      role: String(data.role ?? "member"),
      handle: String(data.handle ?? ""),
      displayName: String(data.displayName ?? ""),
      joinedAt: Number(data.joinedAt ?? 0),
    };
  });

  return socialJson({
    exportedAt: new Date().toISOString(),
    uid: auth.decoded.uid,
    email: auth.decoded.email ?? "",
    profile,
    publicProfile: publicProfileSnap?.exists ? publicProfileSnap.data() : null,
    userAggregate: aggregateSnap.exists ? aggregateSnap.data() : null,
    hubMemberships,
  });
}
