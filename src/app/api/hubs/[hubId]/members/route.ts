import { type NextRequest } from "next/server";

import { assertHubCapability, bestProfileDisplayName, normalizeAccountProfile, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ hubId: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { hubId } = await params;
  try {
    await assertHubCapability(hubId, auth.decoded.uid, "view");
    const snap = await auth.db.collection("hubs").doc(hubId).collection("members").orderBy("joinedAt", "asc").limit(200).get();
    const sourceUids = Array.from(new Set(snap.docs.map((doc) => String(doc.data().uid ?? doc.id))));
    const sourceRefs = sourceUids.map((uid) => auth.db.collection("users").doc(uid));
    const sourceSnaps = sourceRefs.length ? await auth.db.getAll(...sourceRefs) : [];
    const sourceUsers = new Map(sourceSnaps.filter((item) => item.exists).map((item) => [item.id, item.data() ?? {}]));
    const canonicalUids = Array.from(new Set(sourceUids.map((uid) => String(sourceUsers.get(uid)?.canonicalUid ?? uid)).filter(Boolean)));
    const canonicalRefs = canonicalUids.map((uid) => auth.db.collection("users").doc(uid));
    const canonicalSnaps = canonicalRefs.length ? await auth.db.getAll(...canonicalRefs) : [];
    const profiles = new Map(canonicalSnaps.filter((item) => item.exists).map((item) => [item.id, normalizeAccountProfile(item.id, item.data() ?? {})]));
    const members = new Map<string, Record<string, unknown>>();
    for (const doc of snap.docs) {
      const data = doc.data();
      const sourceUid = String(data.uid ?? doc.id);
      const canonicalUid = String(data.migratedToUid ?? data.canonicalUid ?? sourceUsers.get(sourceUid)?.canonicalUid ?? sourceUid);
      const profile = profiles.get(canonicalUid);
      const handle = profile?.handle || String(data.handle ?? "").trim();
      const candidate: Record<string, unknown> = {
        ...data,
        id: canonicalUid,
        uid: canonicalUid,
        handle,
        displayName: bestProfileDisplayName(canonicalUid, profile?.displayName, profile?.handle, data.displayName, handle),
      };
      const existing = members.get(canonicalUid);
      if (!existing) {
        members.set(canonicalUid, candidate);
        continue;
      }
      members.set(canonicalUid, {
        ...existing,
        ...candidate,
        role: strongerMemberRole(String(existing.role ?? ""), String(candidate.role ?? "")),
        joinedAt: Math.min(Number(existing.joinedAt ?? Date.now()), Number(candidate.joinedAt ?? Date.now())),
      });
    }
    return socialJson({
      members: Array.from(members.values()),
    });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Could not load hub members" }, 403);
  }
}

function strongerMemberRole(left: string, right: string) {
  const rank: Record<string, number> = { member: 1, admin: 2, owner: 3 };
  return (rank[left] ?? 0) >= (rank[right] ?? 0) ? left || "member" : right || "member";
}
