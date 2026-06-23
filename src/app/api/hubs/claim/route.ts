import { createHash } from "node:crypto";
import { type NextRequest } from "next/server";

import { bestProfileDisplayName, cleanDisplayName, ensureUserProfile, hubIdFromName, requireUser, saveAccountProfile, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const body = await readBody(req);
  const hubId = String(body.hubId ?? "").trim() || hubIdFromName(String(body.name ?? ""));
  if (String(body.passwordHash ?? "").trim()) {
    return socialJson({ error: "Hub ownership must be claimed with the hub password, not a stored hash." }, 400);
  }
  const passwordHash = hashPassword(String(body.password ?? ""));
  if (!hubId || !passwordHash) return socialJson({ error: "Hub and password are required" }, 400);

  const hubRef = auth.db.collection("hubs").doc(hubId);
  const memberRef = hubRef.collection("members").doc(auth.decoded.uid);
  const ensuredProfile = await ensureUserProfile(
    auth.decoded.uid,
    cleanDisplayName(body.displayName, auth.decoded.name ?? auth.decoded.email ?? ""),
    auth.decoded.email ?? "",
  );
  const profile = await saveAccountProfile(auth.decoded.uid, {
    displayName: bestProfileDisplayName(auth.decoded.uid, body.displayName, ensuredProfile.displayName, ensuredProfile.handle),
  }, {
    email: auth.decoded.email ?? "",
  });

  try {
    await auth.db.runTransaction(async (tx) => {
      const hubSnap = await tx.get(hubRef);
      if (!hubSnap.exists) throw new Error("Hub not found");
      const data = hubSnap.data() ?? {};
      const remoteHash = String(data.password_hash ?? data.passwordHash ?? "");
      if (!remoteHash || remoteHash !== passwordHash) throw new Error("Private hub password did not match");
      const ownerUid = String(data.owner_uid ?? data.ownerUid ?? data.created_by ?? "");
      if (ownerUid && ownerUid !== auth.decoded.uid && String(data.role_mode ?? "") === "account") {
        throw new Error("This hub has already been claimed by another account.");
      }
      tx.set(hubRef, {
        owner_uid: auth.decoded.uid,
        role_mode: "account",
        invite_policy: "admins",
        name: String(data.name ?? body.name ?? hubId),
        updated_at: Date.now(),
      }, { merge: true });
      tx.set(memberRef, {
        uid: auth.decoded.uid,
        role: "owner",
        handle: profile.handle,
        displayName: bestProfileDisplayName(auth.decoded.uid, profile.displayName, profile.handle),
        joinedAt: Date.now(),
        updatedAt: Date.now(),
      }, { merge: true });
    });
    return socialJson({ ok: true });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Hub claim failed" }, 400);
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
