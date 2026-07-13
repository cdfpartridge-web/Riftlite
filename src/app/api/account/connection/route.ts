import { type NextRequest } from "next/server";

import { summarizeAccountMigration } from "@/lib/account-connection";
import { linkedReplayUid } from "@/lib/replay-v2-server/identity";
import {
  associateLinkedIdentity,
  ensureUserProfile,
  identityUidsFor,
  repairHistoricalDesktopIdentityAssociations,
  requireUser,
  socialJson,
} from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  return connectionResponse(auth);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const uid = linkedReplayUid(auth.decoded);
  if (!uid) return socialJson({ error: "A Google or email RiftLite account is required." }, 401);

  const aliases = await identityUidsFor(uid);
  for (const alias of aliases) {
    if (alias !== uid) await associateLinkedIdentity(alias, uid);
  }
  return connectionResponse(auth);
}

async function connectionResponse(auth: Exclude<Awaited<ReturnType<typeof requireUser>>, { error: unknown }>) {
  const uid = linkedReplayUid(auth.decoded);
  if (!uid) return socialJson({ error: "A Google or email RiftLite account is required." }, 401);

  await repairHistoricalDesktopIdentityAssociations(uid);
  const profile = await ensureUserProfile(uid, auth.decoded.name ?? "", auth.decoded.email ?? "");
  const aliases = await identityUidsFor(uid);
  const sourceAliases = aliases.filter((alias) => alias !== uid);
  const [replayCountSnapshot, ...aliasSnapshots] = await Promise.all([
    auth.db.collection("replayV2Owners").doc(uid).collection("items").count().get(),
    ...sourceAliases.map((alias) => auth.db.collection("identityAliases").doc(alias).get()),
  ]);

  const migration = summarizeAccountMigration(aliasSnapshots.map((snapshot) => snapshot.data() ?? {}));

  const replayCount = Number(replayCountSnapshot.data().count ?? 0);
  return socialJson({
    connection: {
      verified: true,
      uid,
      email: profile.email || auth.decoded.email || "",
      displayName: profile.displayName,
      handle: profile.handle,
      profileComplete: profile.profileComplete,
      replayLibraryReady: true,
      replayCount,
      migrationState: migration.state,
      migrationMessage: migration.message,
      checkedAt: new Date().toISOString(),
    },
  });
}
