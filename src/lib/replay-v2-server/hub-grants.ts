import "server-only";

import { createHash } from "node:crypto";

import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
} from "firebase-admin/firestore";

import { identityUidsFor } from "@/lib/social/server";
import {
  REPLAY_COLLECTION,
} from "@/lib/replay-v2-server/constants";
import {
  ReplayStatusSchema,
  ReplayVisibilitySchema,
} from "@/lib/replay-v2-server/contracts";
import { ReplayV2Error } from "@/lib/replay-v2-server/errors";
import { isReplayId } from "@/lib/replay-v2-server/ids";
import type { ReplayRecord } from "@/lib/replay-v2-server/model";

export const REPLAY_HUB_GRANT_COLLECTION = "replayHubGrants";

const HUB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MATCH_ID_PATTERN = /^[^/\u0000-\u001f\u007f]{1,160}$/;
const MAX_REPLAY_HUB_GRANTS = 100;
const HUB_MEMBER_ROLES = new Set(["owner", "admin", "member"]);

type HubReplayGrant = {
  schema: "riftlite-replay-hub-grant";
  version: 1;
  hubId: string;
  matchId: string;
  replayId: string;
  replayOwnerUid: string;
  grantedByUid: string;
  createdAt: unknown;
  updatedAt: unknown;
};

export type PutHubWebReplayResult = {
  hubId: string;
  matchId: string;
  replayId: string;
};

export type DeleteHubWebReplayResult = {
  hubId: string;
  matchId: string;
  replayId: string;
  unlinked: boolean;
  alreadyUnlinked: boolean;
};

/** One server-owned grant exists for each private-hub match. */
export function replayHubGrantDocumentId(hubIdInput: string, matchIdInput: string): string {
  const hubId = cleanHubId(hubIdInput);
  const matchId = cleanMatchId(matchIdInput);
  const digest = createHash("sha256")
    .update("riftlite-replay-hub-grant-v1\0", "utf8")
    .update(hubId, "utf8")
    .update("\0", "utf8")
    .update(matchId, "utf8")
    .digest("hex");
  return `rhg_${digest}`;
}

/**
 * Attach a Replay V2 record to one hub match and create its authorization
 * grant in the same transaction. The caller must own both records and still
 * participate in a live account-managed hub.
 */
export async function putHubWebReplay(
  db: Firestore,
  input: {
    hubId: string;
    matchId: string;
    replayId: string;
    actorUid: string;
    identityUids: readonly string[];
  },
): Promise<PutHubWebReplayResult> {
  const hubId = cleanHubId(input.hubId);
  const matchId = cleanMatchId(input.matchId);
  const replayId = cleanReplayId(input.replayId);
  const actorUid = cleanUid(input.actorUid);
  const identityUids = cleanIdentityUids([actorUid, ...input.identityUids]);
  if (!actorUid || !identityUids.length) {
    throw new ReplayV2Error(401, "authentication_required", "A linked RiftLite account is required.");
  }

  const hubRef = db.collection("hubs").doc(hubId);
  const matchRef = hubRef.collection("matches").doc(matchId);
  const replayRef = db.collection(REPLAY_COLLECTION).doc(replayId);
  const grantRef = db.collection(REPLAY_HUB_GRANT_COLLECTION).doc(
    replayHubGrantDocumentId(hubId, matchId),
  );
  const memberRefs = identityUids.map((uid) => hubRef.collection("members").doc(uid));

  await db.runTransaction(async (transaction) => {
    const [hubSnap, matchSnap, replaySnap, grantSnap, ...memberSnaps] = await transaction.getAll(
      hubRef,
      matchRef,
      replayRef,
      grantRef,
      ...memberRefs,
    );
    const hub = requireLiveAccountHub(hubSnap);
    assertHubParticipation(hub, memberSnaps, identityUids);
    const match = requireOwnedHubMatch(matchSnap, identityUids);
    const replay = requireOwnedReplay(replaySnap, replayId, identityUids);
    assertReplayMatchesHubMatch(replay, matchId);

    const existingGrant = grantSnap.data() ?? {};
    const parsedExistingGrant = parseGrant(grantSnap);
    const alreadyLinked = stringValue(match.web_replay_id) === replayId &&
      !stringValue(match.webReplayId) &&
      parsedExistingGrant?.hubId === hubId &&
      parsedExistingGrant.matchId === matchId &&
      parsedExistingGrant.replayId === replayId &&
      parsedExistingGrant.replayOwnerUid === replay.ownerUid;
    if (alreadyLinked) {
      return;
    }

    const now = Timestamp.now();
    const grant: HubReplayGrant = {
      schema: "riftlite-replay-hub-grant",
      version: 1,
      hubId,
      matchId,
      replayId,
      replayOwnerUid: replay.ownerUid,
      grantedByUid: actorUid,
      createdAt: existingGrant.createdAt ?? now,
      updatedAt: now,
    };
    transaction.update(matchRef, {
      web_replay_id: replayId,
      webReplayId: FieldValue.delete(),
      web_replay_updated_at: now,
    });
    transaction.set(grantRef, grant);
  });

  return { hubId, matchId, replayId };
}

/**
 * Remove the server grant and its hub-match pointer atomically. Match owners
 * retain this privacy revocation even after leaving the hub.
 */
export async function deleteHubWebReplay(
  db: Firestore,
  input: {
    hubId: string;
    matchId: string;
    actorUid: string;
    identityUids: readonly string[];
  },
): Promise<DeleteHubWebReplayResult> {
  const hubId = cleanHubId(input.hubId);
  const matchId = cleanMatchId(input.matchId);
  const actorUid = cleanUid(input.actorUid);
  const identityUids = cleanIdentityUids([actorUid, ...input.identityUids]);
  if (!actorUid || !identityUids.length) {
    throw new ReplayV2Error(401, "authentication_required", "A linked RiftLite account is required.");
  }

  const hubRef = db.collection("hubs").doc(hubId);
  const matchRef = hubRef.collection("matches").doc(matchId);
  const grantRef = db.collection(REPLAY_HUB_GRANT_COLLECTION).doc(
    replayHubGrantDocumentId(hubId, matchId),
  );

  return db.runTransaction(async (transaction) => {
    const [hubSnap, matchSnap, grantSnap] = await transaction.getAll(
      hubRef,
      matchRef,
      grantRef,
    );
    requireLiveAccountHub(hubSnap);
    const match = requireOwnedHubMatch(matchSnap, identityUids);
    const replayId = stringValue(match.web_replay_id ?? match.webReplayId);

    if (replayId) {
      transaction.update(matchRef, {
        web_replay_id: FieldValue.delete(),
        webReplayId: FieldValue.delete(),
        web_replay_updated_at: Timestamp.now(),
      });
    }
    if (grantSnap.exists) transaction.delete(grantRef);

    return {
      hubId,
      matchId,
      replayId,
      unlinked: Boolean(replayId || grantSnap.exists),
      alreadyUnlinked: !replayId && !grantSnap.exists,
    };
  });
}

/**
 * Authorize a private replay only through a current, server-issued grant.
 * Every read re-checks the live account-managed hub, current membership, and
 * the source match pointer, so leaving a hub or deleting a match revokes access
 * even before asynchronous cleanup removes the grant document.
 */
export async function privateReplayHubAccessAllowsViewer(
  db: Firestore,
  replay: Pick<ReplayRecord, "replayId" | "ownerUid">,
  viewerUidInput: string,
): Promise<boolean> {
  const viewerUid = cleanUid(viewerUidInput);
  if (!viewerUid || !isReplayId(replay.replayId) || !replay.ownerUid) return false;

  const [viewerIdentityUids, ownerIdentityUids] = await Promise.all([
    safeIdentityUidsFor(viewerUid, db),
    safeIdentityUidsFor(replay.ownerUid, db),
  ]);
  const viewerUidSet = new Set(viewerIdentityUids);
  const ownerUidSet = new Set(ownerIdentityUids);
  if (ownerUidSet.has(viewerUid) || viewerIdentityUids.some((uid) => ownerUidSet.has(uid))) {
    return true;
  }

  let grants: DocumentSnapshot[];
  try {
    const snapshot = await db
      .collection(REPLAY_HUB_GRANT_COLLECTION)
      .where("replayId", "==", replay.replayId)
      .limit(MAX_REPLAY_HUB_GRANTS)
      .get();
    grants = snapshot.docs;
  } catch {
    return false;
  }

  for (const grantSnap of grants) {
    const grant = parseGrant(grantSnap);
    if (!grant || grant.replayId !== replay.replayId) continue;
    if (!ownerUidSet.has(grant.replayOwnerUid)) continue;

    const hubRef = db.collection("hubs").doc(grant.hubId);
    const matchRef = hubRef.collection("matches").doc(grant.matchId);
    const memberRefs = viewerIdentityUids.map((uid) => hubRef.collection("members").doc(uid));
    try {
      const [hubSnap, matchSnap, ...memberSnaps] = await db.getAll(
        hubRef,
        matchRef,
        ...memberRefs,
      );
      const hub = liveAccountHub(hubSnap);
      if (!hub || !hasHubParticipation(hub, memberSnaps, viewerUidSet)) continue;
      const match = matchSnap.exists ? matchSnap.data() ?? {} : null;
      if (!match || stringValue(match.web_replay_id ?? match.webReplayId) !== replay.replayId) continue;
      if (!ownerUidSet.has(stringValue(match.uid))) continue;
      return true;
    } catch {
      // A stale or malformed grant must never turn a failed lookup into access.
    }
  }
  return false;
}

function requireLiveAccountHub(snapshot: DocumentSnapshot): DocumentData {
  const hub = liveAccountHub(snapshot);
  if (hub) return hub;
  if (!snapshot.exists) {
    throw new ReplayV2Error(404, "hub_not_found", "Private hub not found.");
  }
  if (String(snapshot.data()?.lifecycle_state ?? "") === "deleting") {
    throw new ReplayV2Error(409, "hub_deleting", "This private hub is being deleted.");
  }
  throw new ReplayV2Error(
    409,
    "account_hub_required",
    "Web Replay links require an account-managed private hub.",
  );
}

function liveAccountHub(snapshot: DocumentSnapshot): DocumentData | null {
  if (!snapshot.exists) return null;
  const hub = snapshot.data() ?? {};
  if (String(hub.role_mode ?? hub.roleMode ?? "") !== "account") return null;
  if (String(hub.lifecycle_state ?? hub.lifecycleState ?? "") === "deleting") return null;
  return hub;
}

function assertHubParticipation(
  hub: DocumentData,
  memberSnapshots: DocumentSnapshot[],
  identityUids: readonly string[],
): void {
  if (!hasHubParticipation(hub, memberSnapshots, new Set(identityUids))) {
    throw new ReplayV2Error(403, "hub_membership_required", "You are not a member of this private hub.");
  }
}

function hasHubParticipation(
  hub: DocumentData,
  memberSnapshots: DocumentSnapshot[],
  identityUids: ReadonlySet<string>,
): boolean {
  const ownerUid = stringValue(hub.owner_uid ?? hub.ownerUid);
  const createdBy = stringValue(hub.created_by ?? hub.createdBy);
  if ((ownerUid && identityUids.has(ownerUid)) || (createdBy && identityUids.has(createdBy))) {
    return true;
  }
  return memberSnapshots.some((snapshot) => (
    snapshot.exists && HUB_MEMBER_ROLES.has(stringValue(snapshot.data()?.role))
  ));
}

function requireOwnedHubMatch(
  snapshot: DocumentSnapshot,
  identityUids: readonly string[],
): DocumentData {
  if (!snapshot.exists) {
    throw new ReplayV2Error(404, "hub_match_not_found", "Private-hub match not found.");
  }
  const match = snapshot.data() ?? {};
  if (!new Set(identityUids).has(stringValue(match.uid))) {
    throw new ReplayV2Error(403, "hub_match_owner_required", "Only the match owner can attach its Web Replay.");
  }
  return match;
}

function requireOwnedReplay(
  snapshot: DocumentSnapshot,
  replayId: string,
  identityUids: readonly string[],
): ReplayRecord {
  if (!snapshot.exists) {
    throw new ReplayV2Error(404, "replay_not_found", "Replay not found.");
  }
  const data = snapshot.data();
  if (
    !data ||
    data.schema !== "riftlite-replay-record" ||
    data.version !== 2 ||
    data.replayId !== replayId ||
    typeof data.ownerUid !== "string" ||
    typeof data.captureId !== "string" ||
    !ReplayVisibilitySchema.safeParse(data.visibility).success ||
    !ReplayStatusSchema.safeParse(data.status).success
  ) {
    throw new ReplayV2Error(500, "replay_record_invalid", "Replay metadata is invalid.");
  }
  if (!new Set(identityUids).has(data.ownerUid)) {
    throw new ReplayV2Error(403, "replay_owner_required", "Only the replay owner can attach it to a hub match.");
  }
  if (data.status !== "ready") {
    throw new ReplayV2Error(409, "replay_not_ready", "Web Replay processing must finish before it can be attached.");
  }
  return data as ReplayRecord;
}

function assertReplayMatchesHubMatch(replay: ReplayRecord, matchId: string): void {
  const replayMatchId = stringValue(replay.matchId);
  if (replayMatchId && replayMatchId !== matchId) {
    throw new ReplayV2Error(
      409,
      "replay_match_mismatch",
      "This Web Replay belongs to a different match.",
    );
  }
}

function parseGrant(snapshot: DocumentSnapshot): HubReplayGrant | null {
  const data = snapshot.data();
  if (
    !data ||
    data.schema !== "riftlite-replay-hub-grant" ||
    data.version !== 1
  ) return null;
  const hubId = stringValue(data.hubId);
  const matchId = stringValue(data.matchId);
  const replayId = stringValue(data.replayId);
  const replayOwnerUid = stringValue(data.replayOwnerUid);
  if (!HUB_ID_PATTERN.test(hubId) || !MATCH_ID_PATTERN.test(matchId) || !isReplayId(replayId) || !replayOwnerUid) {
    return null;
  }
  if (snapshot.id !== replayHubGrantDocumentId(hubId, matchId)) return null;
  return {
    schema: "riftlite-replay-hub-grant",
    version: 1,
    hubId,
    matchId,
    replayId,
    replayOwnerUid,
    grantedByUid: stringValue(data.grantedByUid),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

async function safeIdentityUidsFor(uid: string, db: Firestore): Promise<string[]> {
  try {
    const resolved = cleanIdentityUids(await identityUidsFor(uid, db));
    return resolved.length ? resolved : [uid];
  } catch {
    return [uid];
  }
}

function cleanHubId(value: string): string {
  const hubId = stringValue(value);
  if (!HUB_ID_PATTERN.test(hubId)) {
    throw new ReplayV2Error(400, "invalid_hub_id", "Private hub id is invalid.");
  }
  return hubId;
}

function cleanMatchId(value: string): string {
  const matchId = stringValue(value);
  if (!MATCH_ID_PATTERN.test(matchId)) {
    throw new ReplayV2Error(400, "invalid_match_id", "Match id is invalid.");
  }
  return matchId;
}

function cleanReplayId(value: string): string {
  const replayId = stringValue(value);
  if (!isReplayId(replayId)) {
    throw new ReplayV2Error(400, "invalid_replay_id", "Replay id is invalid.");
  }
  return replayId;
}

function cleanUid(value: unknown): string {
  return stringValue(value).slice(0, 160);
}

function cleanIdentityUids(values: readonly string[]): string[] {
  return Array.from(new Set(values.map(cleanUid).filter(Boolean))).slice(0, 100);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
