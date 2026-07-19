import { type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { summarizeAccountMigration } from "@/lib/account-connection";
import { createFirebaseCustomToken } from "@/lib/firebase/admin";
import { canonicalIdentityUid } from "@/lib/identity-server";
import { linkedReplayUid } from "@/lib/replay-v2-server/identity";
import {
  associateLinkedIdentity,
  ensureUserProfile,
  identityUidsFor,
  LinkedIdentityConflictError,
  repairHistoricalDesktopIdentityAssociations,
  requireUser,
  socialJson,
} from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return markConnectionPrivate(auth.error ?? socialJson({ error: "Authentication failed" }, 401));
  return connectionResponse(auth, false);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return markConnectionPrivate(auth.error ?? socialJson({ error: "Authentication failed" }, 401));
  const uid = await accountConnectionUid(auth);
  if (!uid) return connectionJson({ error: "A Google or email RiftLite account is required." }, 401);

  const body = await req.json().catch(() => ({})) as { expectedUid?: unknown };
  const requestedExpectedUid = typeof body.expectedUid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(body.expectedUid)
    ? body.expectedUid
    : "";
  const expectedUid = requestedExpectedUid
    ? await canonicalIdentityUid(requestedExpectedUid, auth.db)
    : "";
  if (expectedUid && expectedUid !== uid) {
    return connectionJson({
      error: "This device is pinned to another RiftLite account. Use Switch account before connecting a different account.",
    }, 409);
  }

  const aliases = await identityUidsFor(uid);
  for (const alias of aliases) {
    if (alias === uid) continue;
    try {
      await associateLinkedIdentity(alias, uid);
    } catch (error) {
      if (!(error instanceof LinkedIdentityConflictError)) throw error;
      await auth.db.collection("users").doc(uid).set({
        desktopIdentityBackfillConflicts: FieldValue.arrayUnion({ repairRequired: true }),
        desktopIdentityBackfilledAt: Date.now(),
      }, { merge: true });
    }
  }
  return connectionResponse(auth, true);
}

async function connectionResponse(
  auth: Exclude<Awaited<ReturnType<typeof requireUser>>, { error: unknown }>,
  allowCredentialRepair: boolean,
) {
  const uid = await accountConnectionUid(auth);
  if (!uid) return connectionJson({ error: "A Google or email RiftLite account is required." }, 401);

  await repairHistoricalDesktopIdentityAssociations(uid);
  const profile = await ensureUserProfile(uid, auth.decoded.name ?? "", auth.decoded.email ?? "");
  const aliases = await identityUidsFor(uid);
  const authenticatedUid = String(auth.authenticatedUid ?? "").trim();
  const requiresCredentialRepair = Boolean(authenticatedUid && authenticatedUid !== uid);
  if (requiresCredentialRepair && !aliases.includes(authenticatedUid)) {
    return connectionJson({ error: "This desktop identity is not linked to the requested RiftLite account." }, 403);
  }
  const sourceAliases = aliases.filter((alias) => alias !== uid);
  const [replayCountSnapshot, canonicalUserSnapshot, ...aliasSnapshots] = await Promise.all([
    auth.db.collection("replayV2Owners").doc(uid).collection("items").count().get(),
    auth.db.collection("users").doc(uid).get(),
    ...sourceAliases.map((alias) => auth.db.collection("identityAliases").doc(alias).get()),
  ]);

  const canonicalUser = canonicalUserSnapshot.data() ?? {};
  const migration = summarizeAccountMigration([
    // Only source-alias documents have an identity migration lifecycle. The
    // canonical profile still owns durable repair/conflict signals, but the
    // absence of migrationCompletedAt on a normal profile must not leave every
    // newly linked account permanently pending.
    {
      migrationCompletedAt: true,
      migrationError: canonicalUser.migrationError,
      cloudSyncConflict: canonicalUser.cloudSyncConflict,
      desktopIdentityBackfillConflicts: canonicalUser.desktopIdentityBackfillConflicts,
    },
    ...aliasSnapshots.map((snapshot) => snapshot.data() ?? {}),
  ]);
  let customToken = "";
  if (requiresCredentialRepair && allowCredentialRepair) {
    customToken = await createFirebaseCustomToken(uid) ?? "";
    if (!customToken) return connectionJson({ error: "Could not prepare the canonical desktop account credential." }, 500);
  }

  const replayCount = Number(replayCountSnapshot.data().count ?? 0);
  return connectionJson({
    connection: {
      // A raw alias token proves the historical relationship, but it cannot
      // access Firestore paths owned by the canonical UID. The desktop must
      // exchange the one-time custom token and verify again as the canonical
      // user before this connection is considered ready.
      verified: !requiresCredentialRepair,
      uid,
      authenticatedUid,
      identityUids: aliases,
      email: profile.email || auth.decoded.email || "",
      displayName: profile.displayName,
      handle: profile.handle,
      profileComplete: profile.profileComplete,
      replayLibraryReady: !requiresCredentialRepair,
      replayCount,
      migrationState: migration.state,
      migrationMessage: migration.message,
      checkedAt: new Date().toISOString(),
      credentialRepair: {
        required: requiresCredentialRepair,
        targetUid: uid,
        customToken,
        message: requiresCredentialRepair
          ? customToken
            ? "Upgrade this desktop to the canonical RiftLite account credential, then verify again."
            : "This desktop must upgrade its saved RiftLite account credential."
          : "",
      },
    },
  });
}

function connectionJson(body: Record<string, unknown>, status = 200): Response {
  return markConnectionPrivate(socialJson(body, status));
}

function markConnectionPrivate(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Authorization");
  return response;
}

async function accountConnectionUid(
  auth: Exclude<Awaited<ReturnType<typeof requireUser>>, { error: unknown }>,
): Promise<string> {
  const authenticatedUid = String(auth.authenticatedUid ?? "").trim();
  const canonicalUid = String(auth.decoded.uid ?? "").trim();
  if (!canonicalUid) return "";
  // Canonical credentials still need a durable Google/email identity. A raw
  // historical alias may be anonymous; its server-owned alias relationship is
  // validated against identityUidsFor() before any repair token is issued.
  if (authenticatedUid && authenticatedUid !== canonicalUid) return canonicalUid;
  const durableUid = linkedReplayUid(auth.decoded);
  if (durableUid) return durableUid;

  // A custom-token exchange signs the user in as the canonical Firebase user,
  // but some token shapes do not repeat that user's provider identities. Only
  // accept that narrow case when a server-owned canonical association proves
  // this UID was previously linked. Anonymous tokens never use this fallback.
  const signInProvider = String(auth.decoded.firebase?.sign_in_provider ?? "").trim().toLowerCase();
  if (signInProvider !== "custom") return "";
  const association = await auth.db.collection("identityAliases").doc(canonicalUid).get().catch(() => null);
  const data = association?.data() ?? {};
  return String(data.canonicalUid ?? "").trim() === canonicalUid &&
    String(data.sourceUid ?? "").trim() === canonicalUid
    ? canonicalUid
    : "";
}
