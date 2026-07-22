import { createHash } from "node:crypto";
import { type NextRequest } from "next/server";

import { linkedAccountUidFromCanonicalizedAuth } from "@/lib/account-link";
import { linkedReplayUid } from "@/lib/replay-v2-server/identity";
import { primaryOwnerUid } from "@/lib/social/hub-lifecycle";
import { bestProfileDisplayName, ensureUserProfile, findMembershipDocuments, hubIdFromName, identityUidsFor, profileIsComplete, repairHistoricalDesktopIdentityAssociations, requireUser, socialJson, type AccountProfile } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  if (!linkedAccountUidFromCanonicalizedAuth(
    auth.authenticatedUid,
    auth.decoded.uid,
    linkedReplayUid(auth.decoded),
  )) return socialJson({ error: "Create or sign in to a recoverable RiftLite account first." }, 401);
  const profile = await ensureUserProfile(auth.decoded.uid, auth.decoded.name ?? "", auth.decoded.email ?? "");
  if (!profileIsComplete(profile)) {
    return socialJson({ error: "Finish your RiftLite profile to open My Hubs.", code: "profile_incomplete" }, 409);
  }
  await repairHistoricalDesktopIdentityAssociations(auth.decoded.uid);
  const uids = await identityUidsFor(auth.decoded.uid);
  const identityUidSet = new Set([...uids, auth.decoded.uid]);
  const memberDocs = await findMembershipDocuments(auth.db, uids, "hubs");
  const byHub = new Map<string, { ref: FirebaseFirestore.DocumentReference; role: string; joinedAt: number }>();
  for (const member of memberDocs) {
    const hubRef = member.ref.parent.parent;
    if (!hubRef || hubRef.parent.id !== "hubs") continue;
    const data = member.data() ?? {};
    const existing = byHub.get(hubRef.id);
    const role = strongerHubRole(String(existing?.role ?? ""), String(data.role ?? "member"));
    byHub.set(hubRef.id, { ref: hubRef, role, joinedAt: Math.min(existing?.joinedAt || Date.now(), Number(data.joinedAt ?? Date.now())) });
  }
  // Legacy hubs did not have membership documents. Recover hubs created by a
  // linked desktop identity so their owner can still see and claim them after
  // moving to a recoverable account.
  const legacyOwnerQueries = await Promise.all(uids.map((uid) => (
    auth.db.collection("hubs").where("created_by", "==", uid).get()
  )));
  for (const hub of legacyOwnerQueries.flatMap((snapshot) => snapshot.docs)) {
    const data = hub.data() ?? {};
    if (!identityUidSet.has(primaryOwnerUid(data))) continue;
    const existing = byHub.get(hub.id);
    byHub.set(hub.id, {
      ref: hub.ref,
      role: strongerHubRole(String(existing?.role ?? ""), "owner"),
      joinedAt: existing?.joinedAt ?? (Number(data.createdAt ?? Number(data.created_at ?? 0) * 1_000) || Date.now()),
    });
  }
  const hubRows = Array.from(byHub.values());
  const hubSnaps = hubRows.length ? await auth.db.getAll(...hubRows.map((item) => item.ref)) : [];
  return socialJson({
    ok: true,
    profile,
    hubs: hubSnaps
      .filter((item) => item.exists && String(item.data()?.lifecycle_state ?? "") !== "deleting")
      .map((item) => {
        const membership = byHub.get(item.id);
        const data = item.data() ?? {};
        return {
          id: item.id,
          name: String(data.name ?? item.id),
          role: membership?.role ?? "member",
          claimed: String(data.role_mode ?? data.roleMode ?? "") === "account",
          joinedAt: membership?.joinedAt ? new Date(membership.joinedAt).toISOString() : "",
        };
      }),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  if (!linkedAccountUidFromCanonicalizedAuth(
    auth.authenticatedUid,
    auth.decoded.uid,
    linkedReplayUid(auth.decoded),
  )) return socialJson({ error: "Create or sign in to a recoverable RiftLite account first." }, 401);
  const body = await readBody(req);
  const action = String(body.action ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const password = String(body.password ?? "");
  const hubId = hubIdFromName(name);
  const passwordHash = hashPassword(password);

  if (!hubId || !name || !passwordHash) {
    return socialJson({ error: "Hub name and password are required" }, 400);
  }
  if (action !== "create" && action !== "join") {
    return socialJson({ error: "Hub action must be create or join" }, 400);
  }

  const hubRef = auth.db.collection("hubs").doc(hubId);
  const memberRef = hubRef.collection("members").doc(auth.decoded.uid);
  const now = Date.now();
  const profile = await ensureUserProfile(
    auth.decoded.uid,
    auth.decoded.name ?? auth.decoded.email ?? "",
    auth.decoded.email ?? "",
  );
  try {
    if (action === "create") {
      await auth.db.runTransaction(async (tx) => {
        const existing = await tx.get(hubRef);
        if (existing.exists) {
          throw new Error("A private hub with that exact name already exists");
        }
        tx.set(hubRef, {
          id: hubId,
          name,
          password_hash: passwordHash,
          created_by: auth.decoded.uid,
          owner_uid: auth.decoded.uid,
          role_mode: "account",
          invite_policy: "admins",
          created_at: Math.floor(now / 1000),
          createdAt: now,
          hidden: true,
          updated_at: now,
        }, { merge: true });
        tx.set(memberRef, hubMemberPayload(auth.decoded.uid, profile, "owner", now), { merge: true });
      });
      return socialJson({ ok: true, hub: hubPayload(hubId, name, "owner", now, true) });
    }

    const joined = await auth.db.runTransaction(async (tx) => {
      const [snap, memberSnap] = await Promise.all([tx.get(hubRef), tx.get(memberRef)]);
      if (!snap.exists) throw new Error("Private hub name or password did not match");
      const data = snap.data() ?? {};
      if (String(data.lifecycle_state ?? "") === "deleting") {
        throw new Error("This private hub is being deleted");
      }
      const remoteHash = String(data.password_hash ?? data.passwordHash ?? "");
      if (!remoteHash || remoteHash !== passwordHash) {
        throw new Error("Private hub name or password did not match");
      }
      const existingRole = String(memberSnap.data()?.role ?? "").trim();
      const role: "owner" | "admin" | "member" =
        existingRole === "owner" || existingRole === "admin" || existingRole === "member"
          ? existingRole
          : "member";
      tx.set(memberRef, {
        ...hubMemberPayload(auth.decoded.uid, profile, role, now),
        joinedAt: Number(memberSnap.data()?.joinedAt ?? now) || now,
      }, { merge: true });
      return {
        hubName: String(data.name ?? name),
        role,
        claimed: String(data.role_mode ?? data.roleMode ?? "") === "account",
      };
    });
    return socialJson({ ok: true, hub: hubPayload(hubId, joined.hubName, joined.role, now, joined.claimed) });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Hub action failed" }, action === "create" ? 409 : 400);
  }
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function hashPassword(password: string) {
  return password ? createHash("sha256").update(password).digest("hex") : "";
}

function strongerHubRole(left: string, right: string) {
  const rank: Record<string, number> = { member: 1, admin: 2, owner: 3 };
  return (rank[left] ?? 0) >= (rank[right] ?? 0) ? left || "member" : right || "member";
}

function hubPayload(id: string, name: string, role: "owner" | "admin" | "member", now: number, claimed: boolean) {
  return {
    id,
    name,
    sync: true,
    role,
    claimed,
    joinedAt: new Date(now).toISOString(),
  };
}

function hubMemberPayload(uid: string, profile: AccountProfile, role: "owner" | "admin" | "member", now: number) {
  return {
    uid,
    role,
    handle: profile.handle,
    displayName: bestProfileDisplayName(uid, profile.displayName, profile.handle),
    joinedAt: now,
    updatedAt: now,
  };
}
